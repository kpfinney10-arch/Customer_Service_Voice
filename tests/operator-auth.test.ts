import assert from "node:assert/strict";
import { test } from "node:test";
import { OperatorAuthenticationError, OperatorAuthService, hashOperatorPassword, verifyOperatorPassword } from "../src/security/operator-auth.js";
import { InMemoryOperatorAuthStore } from "../src/security/operator-auth-store.js";

test("operator passwords are memory-hard hashed and verified", async () => {
  const hash = await hashOperatorPassword("correct horse lantern bell");
  assert.match(hash, /^scrypt-v1\$32768\$8\$3\$/);
  assert.equal(hash.includes("correct horse"), false);
  assert.equal(await verifyOperatorPassword("correct horse lantern bell", hash), true);
  assert.equal(await verifyOperatorPassword("incorrect password", hash), false);
});

test("operator login stores only a token digest and enforces expiry and logout", async () => {
  const store = new InMemoryOperatorAuthStore();
  let now = new Date("2026-08-02T12:00:00.000Z");
  await store.upsertUser({
    userId: "user-1",
    tenantId: "fh-demo",
    email: "owner@example.com",
    displayName: "Demo Owner",
    passwordHash: await hashOperatorPassword("correct horse lantern bell"),
    role: "owner",
    active: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const service = new OperatorAuthService(store, {
    now: () => now,
    idleTtlMs: 30 * 60_000,
    absoluteTtlMs: 8 * 60 * 60_000,
    secureCookie: true,
  });

  const login = await service.login({
    tenantId: "fh-demo",
    email: "OWNER@example.com",
    password: "correct horse lantern bell",
    requestId: "request-login",
  });
  assert.match(login.setCookie, /^lb_operator_session=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.equal(login.setCookie.includes("correct horse"), false);
  const cookie = login.setCookie.split(";")[0] ?? "";
  assert.deepEqual(await service.currentSession(cookie), {
    userId: "user-1",
    tenantId: "fh-demo",
    role: "owner",
    sessionId: login.session.sessionId,
  });

  now = new Date("2026-08-02T12:31:00.000Z");
  await assert.rejects(() => service.currentSession(cookie), (error: unknown) => {
    assert.equal(error instanceof OperatorAuthenticationError && error.code, "SESSION_EXPIRED");
    return true;
  });
  assert.deepEqual(store.auditEvents.map((event) => event.eventType), [
    "LOGIN_SUCCEEDED",
    "SESSION_EXPIRED",
  ]);
});

test("operator roles are enforced and failed sign-ins are generically audited", async () => {
  const store = new InMemoryOperatorAuthStore();
  const passwordHash = await hashOperatorPassword("viewer password lantern bell");
  await store.upsertUser({
    userId: "viewer-1",
    tenantId: "fh-demo",
    email: "viewer@example.com",
    displayName: "Viewer",
    passwordHash,
    role: "viewer",
    active: true,
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
  });
  const service = new OperatorAuthService(store, { secureCookie: false });

  await assert.rejects(
    () => service.login({ tenantId: "fh-demo", email: "missing@example.com", password: "wrong password value" }),
    /not valid/,
  );
  const login = await service.login({
    tenantId: "fh-demo",
    email: "viewer@example.com",
    password: "viewer password lantern bell",
  });
  const cookie = login.setCookie.split(";")[0] ?? "";
  assert.equal((await service.requirePermission(cookie, "calls:read")).role, "viewer");
  await assert.rejects(() => service.requirePermission(cookie, "access_audit:read"), (error: unknown) => {
    assert.equal(error instanceof OperatorAuthenticationError && error.code, "ACCESS_FORBIDDEN");
    return true;
  });
  assert.equal(store.auditEvents.some((event) => event.eventType === "LOGIN_FAILED" && !event.metadata.email), true);
  assert.equal(store.auditEvents.some((event) => event.eventType === "ACCESS_DENIED"), true);
});
