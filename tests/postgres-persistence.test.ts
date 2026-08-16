import assert from "node:assert/strict";
import { test } from "node:test";
import { DataType, newDb } from "pg-mem";
import type { PostgresDatabase } from "../src/persistence/postgres-client.js";
import { PostgresEventStore } from "../src/persistence/postgres-event-store.js";
import { PostgresIdempotencyStore } from "../src/persistence/postgres-idempotency-store.js";
import { migratePostgres } from "../src/persistence/postgres-schema.js";
import { PostgresSessionStore } from "../src/persistence/postgres-session-store.js";
import { PostgresOperatorAuthStore } from "../src/persistence/postgres-operator-auth-store.js";
import { createCallEvent } from "../src/events/call-event.js";
import { createCallSession, updateSession } from "../src/session/call-session.js";

test("PostgreSQL migration and stores preserve tenant isolation and durable records", async () => {
  const database = createTestDatabase();
  await migratePostgres(database);
  await migratePostgres(database);

  const sessions = new PostgresSessionStore(database);
  const events = new PostgresEventStore(database);
  const idempotency = new PostgresIdempotencyStore(database);
  const first = createCallSession({
    callId: "call-1",
    sessionId: "shared-session",
    tenantId: "tenant-a",
    now: "2026-07-28T12:00:00.000Z",
  });
  const second = createCallSession({
    callId: "call-2",
    sessionId: "shared-session",
    tenantId: "tenant-b",
    now: "2026-07-28T12:01:00.000Z",
  });

  await sessions.save(first);
  await sessions.save(second);
  await sessions.save(
    updateSession(first, { retryCount: 2 }, "2026-07-28T12:02:00.000Z"),
  );

  assert.equal((await sessions.get("tenant-a", "shared-session"))?.retryCount, 2);
  assert.equal((await sessions.get("tenant-b", "shared-session"))?.callId, "call-2");
  assert.deepEqual(
    (await sessions.listRecentByTenant("tenant-a", 10)).map((session) => session.callId),
    ["call-1"],
  );

  const firstEvent = createCallEvent({
    eventId: "event-1",
    eventType: "CALL_STARTED",
    callId: "call-1",
    sessionId: "shared-session",
    tenantId: "tenant-a",
    correlationId: "correlation-1",
    occurredAt: "2026-07-28T12:00:00.000Z",
    payload: { source: "twilio" },
  });
  const secondEvent = createCallEvent({
    eventId: "event-2",
    eventType: "CALL_ENDED",
    callId: "call-1",
    sessionId: "shared-session",
    tenantId: "tenant-a",
    correlationId: "correlation-1",
    occurredAt: "2026-07-28T12:03:00.000Z",
    payload: { reason: "completed" },
  });
  const otherTenantEvent = createCallEvent({
    eventId: "event-1",
    eventType: "CALL_STARTED",
    callId: "call-2",
    sessionId: "shared-session",
    tenantId: "tenant-b",
    correlationId: "correlation-2",
    occurredAt: "2026-07-28T12:01:00.000Z",
    payload: { source: "twilio" },
  });

  await events.append([firstEvent, secondEvent, otherTenantEvent]);
  await events.append([firstEvent]);

  assert.deepEqual(
    (await events.listBySession("tenant-a", "shared-session")).map(
      (event) => event.eventId,
    ),
    ["event-1", "event-2"],
  );
  assert.deepEqual(
    (await events.listRecentByTenant("tenant-a", 1)).map((event) => event.eventId),
    ["event-2"],
  );
  assert.deepEqual(
    (await events.listRecentByTypesSince(
      ["CALL_ENDED"],
      "2026-07-28T12:02:00.000Z",
      10,
    )).map((event) => event.eventId),
    ["event-2"],
  );
  assert.equal(
    (await events.listBySession("tenant-b", "shared-session"))[0]?.callId,
    "call-2",
  );

  const sameTimeFirst = createCallEvent({
    eventId: "event-z",
    eventType: "TOOL_EXECUTED",
    callId: "call-1",
    sessionId: "same-time-session",
    tenantId: "tenant-a",
    correlationId: "correlation-same-time",
    occurredAt: "2026-07-28T12:03:30.000Z",
    payload: { toolName: "crm.create_intake_lead" },
  });
  const sameTimeSecond = createCallEvent({
    eventId: "event-a",
    eventType: "TOOL_EXECUTED",
    callId: "call-1",
    sessionId: "same-time-session",
    tenantId: "tenant-a",
    correlationId: "correlation-same-time",
    occurredAt: "2026-07-28T12:03:30.000Z",
    payload: { toolName: "dispatch.create_removal_request" },
  });
  await events.append([sameTimeFirst, sameTimeSecond]);

  assert.deepEqual(
    (await events.listBySession("tenant-a", "same-time-session")).map(
      (event) => event.eventId,
    ),
    ["event-z", "event-a"],
  );

  await idempotency.save({
    tenantId: "tenant-a",
    key: "retry-1",
    fingerprint: "fingerprint-a",
    statusCode: 201,
    body: { sessionId: "shared-session" },
    createdAt: "2026-07-28T12:04:00.000Z",
  });
  await idempotency.save({
    tenantId: "tenant-b",
    key: "retry-1",
    fingerprint: "fingerprint-b",
    statusCode: 202,
    body: { sessionId: "shared-session" },
    createdAt: "2026-07-28T12:05:00.000Z",
  });

  assert.equal(
    (await idempotency.get("tenant-a", "retry-1"))?.fingerprint,
    "fingerprint-a",
  );
  assert.equal(
    (await idempotency.get("tenant-b", "retry-1"))?.statusCode,
    202,
  );
  assert.equal(await idempotency.get("tenant-c", "retry-1"), undefined);

  await database.end();
});

test("PostgreSQL event store preserves pilot call-quality signals", async () => {
  const database = createTestDatabase();
  await migratePostgres(database);
  const events = new PostgresEventStore(database);
  const turnEvent = createCallEvent({
    eventId: "quality-turn-1",
    eventType: "STATE_TRANSITIONED",
    callId: "quality-call-1",
    sessionId: "quality-session-1",
    tenantId: "fh-demo",
    correlationId: "quality-correlation-1",
    occurredAt: "2026-08-16T16:30:00.000Z",
    payload: {
      from: "IDENTIFY_INTENT",
      to: "IDENTIFY_INTENT",
      step: "collect_caller",
      missingTargetFacts: ["caller_phone"],
      turnDurationMs: 1_600,
    },
  });
  const repeatedPromptEvent = createCallEvent({
    eventId: "quality-repeat-1",
    eventType: "PROMPT_REPEATED",
    callId: "quality-call-1",
    sessionId: "quality-session-1",
    tenantId: "fh-demo",
    correlationId: "quality-correlation-2",
    occurredAt: "2026-08-16T16:31:00.000Z",
    payload: { reason: "empty_speech", repeatCount: 3 },
  });

  await events.append([turnEvent, repeatedPromptEvent]);

  const persisted = await events.listRecentByTypesSince(
    ["STATE_TRANSITIONED", "PROMPT_REPEATED"],
    "2026-08-16T16:00:00.000Z",
    10,
  );
  assert.deepEqual(
    persisted.map((event) => ({ eventType: event.eventType, payload: event.payload })),
    [
      {
        eventType: "PROMPT_REPEATED",
        payload: { reason: "empty_speech", repeatCount: 3 },
      },
      {
        eventType: "STATE_TRANSITIONED",
        payload: {
          from: "IDENTIFY_INTENT",
          to: "IDENTIFY_INTENT",
          step: "collect_caller",
          missingTargetFacts: ["caller_phone"],
          turnDurationMs: 1_600,
        },
      },
    ],
  );
  await database.end();
});

test("PostgreSQL operator identity store persists users, digested sessions, and audits", async () => {
  const database = createTestDatabase();
  await migratePostgres(database);
  const store = new PostgresOperatorAuthStore(database);
  await store.upsertUser({
    userId: "operator-user-1",
    tenantId: "fh-demo",
    email: "owner@example.com",
    displayName: "Demo Owner",
    passwordHash: "scrypt-hash-not-raw-password",
    role: "owner",
    active: true,
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
  });
  assert.equal((await store.findUserByEmail("fh-demo", "owner@example.com"))?.userId, "operator-user-1");
  assert.equal((await store.findUserById("operator-user-1"))?.role, "owner");

  await store.createSession({
    sessionId: "operator-session-1",
    tokenHash: "sha256-token-digest",
    userId: "operator-user-1",
    tenantId: "fh-demo",
    role: "owner",
    createdAt: "2026-08-02T12:00:00.000Z",
    lastSeenAt: "2026-08-02T12:00:00.000Z",
    expiresAt: "2026-08-02T20:00:00.000Z",
  });
  await store.touchSession("operator-session-1", "2026-08-02T12:05:00.000Z");
  assert.equal((await store.findSessionByTokenHash("sha256-token-digest"))?.lastSeenAt, "2026-08-02T12:05:00.000Z");
  await store.revokeSession("operator-session-1", "2026-08-02T12:06:00.000Z");
  assert.equal((await store.findSessionByTokenHash("sha256-token-digest"))?.revokedAt, "2026-08-02T12:06:00.000Z");

  await store.appendAudit({
    auditId: "audit-1",
    tenantId: "fh-demo",
    userId: "operator-user-1",
    sessionId: "operator-session-1",
    eventType: "LOGOUT_SUCCEEDED",
    outcome: "success",
    occurredAt: "2026-08-02T12:06:00.000Z",
    metadata: {},
  });
  const audit = await database.query<{ event_type: string; metadata: object }>(
    "SELECT event_type, metadata FROM operator_access_audit WHERE audit_id = $1",
    ["audit-1"],
  );
  assert.equal(audit.rows[0]?.event_type, "LOGOUT_SUCCEEDED");
  assert.deepEqual(audit.rows[0]?.metadata, {});
  await database.end();
});

function createTestDatabase(): PostgresDatabase {
  const memory = newDb({ noAstCoverageCheck: true });
  memory.public.registerFunction({
    name: "pg_advisory_xact_lock",
    args: [DataType.integer],
    returns: DataType.integer,
    implementation: () => 1,
  });
  const adapter = memory.adapters.createPg();
  return new adapter.Pool() as unknown as PostgresDatabase;
}
