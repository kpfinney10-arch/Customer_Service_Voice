import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCallEvent } from "../src/events/call-event.js";
import { FileEventStore } from "../src/persistence/file-event-store.js";
import { FileIdempotencyStore } from "../src/persistence/file-idempotency-store.js";
import { FileSessionStore } from "../src/persistence/file-session-store.js";
import { createPersistenceStoresFromEnv, PersistenceConfigError } from "../src/persistence/storage-factory.js";
import { resolveIdempotentOperation } from "../src/security/idempotency.js";
import { createCallSession, updateSession } from "../src/session/call-session.js";

test("file session store persists sessions across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voice-ai-sessions-"));
  const firstStore = new FileSessionStore(directory);
  const session = updateSession(
    createCallSession({
      callId: "call-file-1",
      sessionId: "session-file-1",
      tenantId: "fh-demo",
      callerPhone: "555-100-2000",
      now: "2026-06-06T12:00:00.000Z",
    }),
    {
      currentState: "ESCALATE",
      escalationScore: 10,
      facts: {
        caller_name: "Sarah Miller",
      },
    },
    "2026-06-06T12:01:00.000Z",
  );

  await firstStore.save(session);

  const secondStore = new FileSessionStore(directory);
  const loaded = await secondStore.get("fh-demo", "session-file-1");

  assert.deepEqual(loaded, session);
});

test("file session store lists recent sessions by tenant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voice-ai-sessions-list-"));
  const store = new FileSessionStore(directory);
  const older = createCallSession({
    callId: "call-list-1",
    sessionId: "session-list-1",
    tenantId: "fh-demo",
    now: "2026-06-06T12:00:00.000Z",
  });
  const newer = createCallSession({
    callId: "call-list-2",
    sessionId: "session-list-2",
    tenantId: "fh-demo",
    now: "2026-06-06T12:01:00.000Z",
  });
  const otherTenant = createCallSession({
    callId: "call-list-other",
    sessionId: "session-list-other",
    tenantId: "fh-other",
    now: "2026-06-06T12:02:00.000Z",
  });

  await store.save(older);
  await store.save(newer);
  await store.save(otherTenant);

  const sessions = await store.listRecentByTenant("fh-demo", 1);

  assert.deepEqual(
    sessions.map((session) => session.sessionId),
    ["session-list-2"],
  );
});

test("file event store appends and filters events by tenant and session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voice-ai-events-"));
  const filePath = join(directory, "events.jsonl");
  const firstStore = new FileEventStore(filePath);
  const matching = createCallEvent({
    eventId: "event-1",
    eventType: "CALL_STARTED",
    callId: "call-file-1",
    sessionId: "session-file-1",
    tenantId: "fh-demo",
    correlationId: "corr-1",
    payload: {},
    occurredAt: "2026-06-06T12:00:00.000Z",
  });
  const otherSession = createCallEvent({
    eventId: "event-2",
    eventType: "CALL_STARTED",
    callId: "call-file-2",
    sessionId: "session-file-2",
    tenantId: "fh-demo",
    correlationId: "corr-2",
    payload: {},
    occurredAt: "2026-06-06T12:01:00.000Z",
  });

  await firstStore.append([matching, otherSession]);

  const secondStore = new FileEventStore(filePath);
  const loaded = await secondStore.listBySession("fh-demo", "session-file-1");

  assert.deepEqual(loaded, [matching]);
});

test("file event store lists recent events by tenant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voice-ai-events-list-"));
  const store = new FileEventStore(join(directory, "events.jsonl"));
  const older = createCallEvent({
    eventId: "event-list-1",
    eventType: "CALL_STARTED",
    callId: "call-list-1",
    sessionId: "session-list-1",
    tenantId: "fh-demo",
    correlationId: "corr-list-1",
    payload: {},
    occurredAt: "2026-06-06T12:00:00.000Z",
  });
  const newer = createCallEvent({
    eventId: "event-list-2",
    eventType: "CALL_ENDED",
    callId: "call-list-1",
    sessionId: "session-list-1",
    tenantId: "fh-demo",
    correlationId: "corr-list-2",
    payload: {},
    occurredAt: "2026-06-06T12:01:00.000Z",
  });
  const otherTenant = createCallEvent({
    eventId: "event-list-other",
    eventType: "CALL_STARTED",
    callId: "call-list-other",
    sessionId: "session-list-other",
    tenantId: "fh-other",
    correlationId: "corr-list-other",
    payload: {},
    occurredAt: "2026-06-06T12:02:00.000Z",
  });

  await store.append([older, newer, otherTenant]);

  const events = await store.listRecentByTenant("fh-demo", 1);

  assert.deepEqual(
    events.map((event) => event.eventId),
    ["event-list-2"],
  );
});

test("file idempotency store persists replay records across store instances", async () => {
  const directory = await mkdtemp(join(tmpdir(), "voice-ai-idempotency-"));
  const firstStore = new FileIdempotencyStore(directory);
  const first = await resolveIdempotentOperation({
    store: firstStore,
    tenantId: "fh-demo",
    key: "idempotency-file-1",
    method: "POST",
    path: "/v1/tenants/fh-demo/first-call/sessions",
    body: { sessionId: "session-file-idempotency-1" },
    execute: () => ({
      statusCode: 201,
      body: { session: { sessionId: "session-file-idempotency-1" } },
    }),
  });

  const secondStore = new FileIdempotencyStore(directory);
  const second = await resolveIdempotentOperation({
    store: secondStore,
    tenantId: "fh-demo",
    key: "idempotency-file-1",
    method: "POST",
    path: "/v1/tenants/fh-demo/first-call/sessions",
    body: { sessionId: "session-file-idempotency-1" },
    execute: () => ({
      statusCode: 201,
      body: { session: { sessionId: "should-not-run" } },
    }),
  });

  assert.equal(first.idempotencyStatus, "stored");
  assert.equal(second.idempotencyStatus, "replayed");
  assert.deepEqual(second.body, first.body);
});

test("persistence factory defaults to memory stores", () => {
  const stores = createPersistenceStoresFromEnv({});

  assert.equal(stores.driver, "memory");
  assert.equal(stores.dataDir, undefined);
  assert.equal(typeof stores.idempotencyStore.get, "function");
});

test("persistence factory creates file stores from environment", () => {
  const stores = createPersistenceStoresFromEnv({
    STORAGE_DRIVER: "file",
    STORAGE_DATA_DIR: "/tmp/voice-ai-data",
  });

  assert.equal(stores.driver, "file");
  assert.equal(stores.dataDir, "/tmp/voice-ai-data");
  assert.equal(typeof stores.idempotencyStore.save, "function");
});

test("persistence factory rejects unknown storage drivers", () => {
  assert.throws(
    () =>
      createPersistenceStoresFromEnv({
        STORAGE_DRIVER: "database",
      }),
    PersistenceConfigError,
  );
});
