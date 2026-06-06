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
