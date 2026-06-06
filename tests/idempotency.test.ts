import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IdempotencyConflictError,
  InMemoryIdempotencyStore,
  resolveIdempotentOperation,
} from "../src/security/idempotency.js";

test("idempotent operation stores first successful response", async () => {
  const store = new InMemoryIdempotencyStore();
  let executions = 0;

  const first = await resolveIdempotentOperation({
    store,
    tenantId: "fh-demo",
    key: "key-1",
    method: "POST",
    path: "/v1/tenants/fh-demo/first-call/sessions",
    body: { sessionId: "session-1" },
    execute: () => {
      executions += 1;
      return { statusCode: 201, body: { sessionId: "session-1" } };
    },
  });
  const second = await resolveIdempotentOperation({
    store,
    tenantId: "fh-demo",
    key: "key-1",
    method: "POST",
    path: "/v1/tenants/fh-demo/first-call/sessions",
    body: { sessionId: "session-1" },
    execute: () => {
      executions += 1;
      return { statusCode: 201, body: { sessionId: "session-duplicate" } };
    },
  });

  assert.equal(executions, 1);
  assert.equal(first.idempotencyStatus, "stored");
  assert.equal(second.idempotencyStatus, "replayed");
  assert.deepEqual(second.body, { sessionId: "session-1" });
});

test("idempotent operation rejects key reuse with different request body", async () => {
  const store = new InMemoryIdempotencyStore();

  await resolveIdempotentOperation({
    store,
    tenantId: "fh-demo",
    key: "key-1",
    method: "POST",
    path: "/v1/tenants/fh-demo/first-call/sessions",
    body: { sessionId: "session-1" },
    execute: () => ({ statusCode: 201, body: { sessionId: "session-1" } }),
  });

  assert.rejects(
    () =>
      resolveIdempotentOperation({
        store,
        tenantId: "fh-demo",
        key: "key-1",
        method: "POST",
        path: "/v1/tenants/fh-demo/first-call/sessions",
        body: { sessionId: "session-2" },
        execute: () => ({ statusCode: 201, body: { sessionId: "session-2" } }),
      }),
    IdempotencyConflictError,
  );
});
