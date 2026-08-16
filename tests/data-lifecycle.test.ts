import assert from "node:assert/strict";
import { test } from "node:test";
import { DataType, newDb } from "pg-mem";
import type { PostgresDatabase } from "../src/persistence/postgres-client.js";
import {
  DataLifecycleError,
  PostgresDataLifecycleService,
} from "../src/persistence/data-lifecycle.js";
import { migratePostgres, POSTGRES_MIGRATIONS } from "../src/persistence/postgres-schema.js";
import {
  createTwilioCallDeletionClient,
  TwilioCallDeletionError,
} from "../src/providers/telephony/twilio-call-deletion.js";

const TWILIO_CALL_A = `CA${"a".repeat(32)}`;
const TWILIO_CALL_B = `CA${"b".repeat(32)}`;
const AUDIT_SECRET = "pilot-purge-audit-secret-at-least-32-characters";

test("lifecycle migration removes transcript text from legacy durable events", async () => {
  const database = createTestDatabase();
  await database.query("CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const migration of POSTGRES_MIGRATIONS.slice(0, 3)) {
    await database.query(migration.sql);
    await database.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
  }
  await database.query(
    "INSERT INTO call_sessions (tenant_id, session_id, call_id, updated_at, payload) VALUES ('tenant-a', 'legacy-session', 'legacy-call', '2026-08-01T00:00:00.000Z', '{}'::jsonb)",
  );
  await database.query(
    `INSERT INTO call_events (tenant_id, event_id, session_id, call_id, event_type, correlation_id, schema_version, redaction_status, occurred_at, payload)
     VALUES ('tenant-a', 'legacy-event', 'legacy-session', 'legacy-call', 'TRANSCRIPT_RECEIVED', 'legacy-correlation', 1, 'redacted', '2026-08-01T00:00:00.000Z', $1::jsonb)`,
    [JSON.stringify({ transcript: "A private name and home address", redactionCategories: [] })],
  );
  await migratePostgres(database);
  const result = await database.query<{ payload: object; redaction_status: string }>(
    "SELECT payload, redaction_status FROM call_events WHERE event_id = 'legacy-event'",
  );
  assert.deepEqual(result.rows[0], {
    payload: { transcriptRetained: false, redactionCategories: [] },
    redaction_status: "not_required",
  });
  assert.equal(JSON.stringify(result.rows[0]).includes("private name"), false);
  await database.end();
});

test("tenant purge previews safely, isolates tenants, and is idempotently audited", async () => {
  const database = createTestDatabase();
  await migratePostgres(database);
  await seedTenant(database, "tenant-a", "session-a", TWILIO_CALL_A, "user-a");
  await seedTenant(database, "tenant-b", "session-b", TWILIO_CALL_B, "user-b");
  const deletedCallIds: string[] = [];
  const service = new PostgresDataLifecycleService(database, {
    async deleteCall(callSid) {
      deletedCallIds.push(callSid);
    },
  });

  assert.deepEqual(await service.previewTenantPurge("tenant-a"), {
    mode: "dry_run",
    counts: {
      callSessions: 1,
      callEvents: 1,
      idempotencyRecords: 1,
      operatorSessions: 1,
      operatorAccessAudits: 1,
      operatorUsers: 1,
    },
    providerCounts: { twilioCalls: 1 },
  });
  assert.equal(await tableCount(database, "call_sessions", "tenant-a"), 1);

  await assert.rejects(
    service.executeTenantPurge({
      tenantId: "tenant-a",
      confirmedTenantId: "tenant-b",
      requestId: "purge-request-1",
      requestedBy: "owner-user-id",
      reason: "test_data_cleanup",
      auditSecret: AUDIT_SECRET,
    }),
    (error: unknown) => error instanceof DataLifecycleError && error.code === "TENANT_CONFIRMATION_MISMATCH",
  );
  assert.equal(deletedCallIds.length, 0);

  const unconfiguredService = new PostgresDataLifecycleService(database);
  await assert.rejects(
    unconfiguredService.executeTenantPurge({
      tenantId: "tenant-a",
      confirmedTenantId: "tenant-a",
      requestId: "purge-provider-not-configured",
      requestedBy: "owner-user-id",
      reason: "test_data_cleanup",
      auditSecret: AUDIT_SECRET,
    }),
    (error: unknown) => error instanceof DataLifecycleError && error.code === "TWILIO_DELETION_NOT_CONFIGURED",
  );
  assert.equal(await tableCount(database, "call_sessions", "tenant-a"), 1);

  const receipt = await service.executeTenantPurge({
    tenantId: "tenant-a",
    confirmedTenantId: "tenant-a",
    requestId: "purge-request-1",
    requestedBy: "owner-user-id",
    reason: "test_data_cleanup",
    auditSecret: AUDIT_SECRET,
    now: "2026-08-16T18:00:00.000Z",
  });
  assert.equal(receipt.duplicate, false);
  assert.equal(receipt.providerCounts.twilioCalls, 1);
  assert.equal(receipt.tenantFingerprint.includes("tenant-a"), false);
  assert.deepEqual(deletedCallIds, [TWILIO_CALL_A]);
  for (const table of tenantTables) {
    assert.equal(await tableCount(database, table, "tenant-a"), 0, table);
    assert.equal(await tableCount(database, table, "tenant-b"), 1, table);
  }

  const duplicate = await service.executeTenantPurge({
    tenantId: "tenant-a",
    confirmedTenantId: "tenant-a",
    requestId: "purge-request-1",
    requestedBy: "owner-user-id",
    reason: "test_data_cleanup",
    auditSecret: AUDIT_SECRET,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.purgeId, receipt.purgeId);
  assert.deepEqual(deletedCallIds, [TWILIO_CALL_A]);

  await assert.rejects(
    service.executeTenantPurge({
      tenantId: "tenant-b",
      confirmedTenantId: "tenant-b",
      requestId: "purge-request-1",
      requestedBy: "owner-user-id",
      reason: "tenant_offboarding",
      auditSecret: AUDIT_SECRET,
    }),
    (error: unknown) => error instanceof DataLifecycleError && error.code === "PURGE_REQUEST_REUSED",
  );
  assert.equal((await database.query("SELECT * FROM data_purge_audit")).rowCount, 1);
  await database.end();
});

test("retention removes only expired records and keeps a reusable aggregate receipt", async () => {
  const database = createTestDatabase();
  await migratePostgres(database);
  await seedLifecycleAgeFixture(database);
  const deletedCallIds: string[] = [];
  const service = new PostgresDataLifecycleService(database, {
    async deleteCall(callSid) {
      deletedCallIds.push(callSid);
    },
  });
  const now = "2026-08-16T18:00:00.000Z";
  const preview = await service.previewRetention(now);
  assert.equal(preview.counts.callSessions, 1);
  assert.equal(preview.counts.callEvents, 1);
  assert.equal(preview.counts.idempotencyRecords, 1);
  assert.equal(preview.counts.operatorSessions, 1);
  assert.equal(preview.counts.operatorAccessAudits, 1);
  assert.equal(preview.counts.operatorUsers, 1);
  assert.equal(preview.providerCounts.twilioCalls, 1);

  const receipt = await service.executeRetention({ runId: "retention-2026-08-16", now });
  assert.equal(receipt.duplicate, false);
  assert.deepEqual(deletedCallIds, [TWILIO_CALL_A]);
  assert.equal(await recordExists(database, "call_sessions", "session_id", "old-session"), false);
  assert.equal(await recordExists(database, "call_sessions", "session_id", "new-session"), true);
  assert.equal(await recordExists(database, "idempotency_records", "idempotency_key", "old-key"), false);
  assert.equal(await recordExists(database, "idempotency_records", "idempotency_key", "new-key"), true);
  assert.equal(await recordExists(database, "operator_users", "user_id", "inactive-user"), false);
  assert.equal(await recordExists(database, "operator_users", "user_id", "active-user"), true);

  const duplicate = await service.executeRetention({ runId: "retention-2026-08-16", now });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(deletedCallIds, [TWILIO_CALL_A]);
  assert.equal((await database.query("SELECT * FROM data_retention_runs")).rowCount, 1);
  await database.end();
});

test("Twilio call deletion validates identifiers and treats an absent record as deleted", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const client = createTwilioCallDeletionClient({
    accountSid: `AC${"c".repeat(32)}`,
    authToken: "secret-token",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 404 });
    },
  });
  await client.deleteCall(TWILIO_CALL_A);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.init?.method, "DELETE");
  assert.match(requests[0]?.url ?? "", new RegExp(`${TWILIO_CALL_A}\\.json$`));
  assert.match(String(new Headers(requests[0]?.init?.headers).get("Authorization")), /^Basic /);
  await assert.rejects(
    client.deleteCall("not-a-call-sid"),
    (error: unknown) => error instanceof TwilioCallDeletionError && error.code === "TWILIO_CALL_SID_INVALID",
  );
});

const tenantTables = [
  "call_sessions",
  "call_events",
  "idempotency_records",
  "operator_sessions",
  "operator_access_audit",
  "operator_users",
] as const;

async function seedTenant(
  database: PostgresDatabase,
  tenantId: string,
  sessionId: string,
  callId: string,
  userId: string,
): Promise<void> {
  const at = "2026-08-16T12:00:00.000Z";
  await database.query(
    "INSERT INTO call_sessions (tenant_id, session_id, call_id, updated_at, payload) VALUES ($1, $2, $3, $4, $5::jsonb)",
    [tenantId, sessionId, callId, at, JSON.stringify({ tenantId, sessionId, callId })],
  );
  await database.query(
    `INSERT INTO call_events (tenant_id, event_id, session_id, call_id, event_type, correlation_id, schema_version, redaction_status, occurred_at, payload)
     VALUES ($1, $2, $3, $4, 'CALL_STARTED', $5, 1, 'not_required', $6, '{}'::jsonb)`,
    [tenantId, `event-${tenantId}`, sessionId, callId, `correlation-${tenantId}`, at],
  );
  await database.query(
    "INSERT INTO idempotency_records (tenant_id, idempotency_key, fingerprint, status_code, body, created_at) VALUES ($1, $2, 'fingerprint', 201, '{}'::jsonb, $3)",
    [tenantId, `key-${tenantId}`, at],
  );
  await database.query(
    `INSERT INTO operator_users (user_id, tenant_id, email, display_name, password_hash, role, active, created_at, updated_at)
     VALUES ($1, $2, $3, 'Owner', 'hash', 'owner', true, $4, $4)`,
    [userId, tenantId, `${tenantId}@example.com`, at],
  );
  await database.query(
    `INSERT INTO operator_sessions (session_id, token_hash, user_id, tenant_id, role, created_at, last_seen_at, expires_at)
     VALUES ($1, $2, $3, $4, 'owner', $5, $5, $5)`,
    [`operator-${tenantId}`, `token-${tenantId}`, userId, tenantId, at],
  );
  await database.query(
    `INSERT INTO operator_access_audit (audit_id, tenant_id, user_id, event_type, outcome, occurred_at, metadata)
     VALUES ($1, $2, $3, 'LOGIN_SUCCEEDED', 'success', $4, '{}'::jsonb)`,
    [`audit-${tenantId}`, tenantId, userId, at],
  );
}

async function seedLifecycleAgeFixture(database: PostgresDatabase): Promise<void> {
  await database.query(
    `INSERT INTO call_sessions (tenant_id, session_id, call_id, updated_at, payload) VALUES
      ('tenant-a', 'old-session', $1, '2026-07-01T00:00:00.000Z', '{}'::jsonb),
      ('tenant-b', 'new-session', $2, '2026-08-10T00:00:00.000Z', '{}'::jsonb)`,
    [TWILIO_CALL_A, TWILIO_CALL_B],
  );
  await database.query(
    `INSERT INTO call_events (tenant_id, event_id, session_id, call_id, event_type, correlation_id, schema_version, redaction_status, occurred_at, payload) VALUES
      ('tenant-a', 'old-event', 'old-session', $1, 'CALL_STARTED', 'old-correlation', 1, 'not_required', '2026-07-01T00:00:00.000Z', '{}'::jsonb),
      ('tenant-b', 'new-event', 'new-session', $2, 'CALL_STARTED', 'new-correlation', 1, 'not_required', '2026-08-10T00:00:00.000Z', '{}'::jsonb)`,
    [TWILIO_CALL_A, TWILIO_CALL_B],
  );
  await database.query(
    `INSERT INTO idempotency_records (tenant_id, idempotency_key, fingerprint, status_code, body, created_at) VALUES
      ('tenant-a', 'old-key', 'old', 200, '{}'::jsonb, '2026-08-01T00:00:00.000Z'),
      ('tenant-b', 'new-key', 'new', 200, '{}'::jsonb, '2026-08-15T00:00:00.000Z')`,
  );
  await database.query(
    `INSERT INTO operator_users (user_id, tenant_id, email, display_name, password_hash, role, active, created_at, updated_at) VALUES
      ('inactive-user', 'tenant-a', 'inactive@example.com', 'Inactive', 'hash', 'owner', false, '2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z'),
      ('active-user', 'tenant-b', 'active@example.com', 'Active', 'hash', 'owner', true, '2026-01-01T00:00:00.000Z', '2026-08-10T00:00:00.000Z')`,
  );
  await database.query(
    `INSERT INTO operator_sessions (session_id, token_hash, user_id, tenant_id, role, created_at, last_seen_at, expires_at, revoked_at) VALUES
      ('old-operator-session', 'old-token', 'inactive-user', 'tenant-a', 'owner', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T08:00:00.000Z', '2026-01-01T01:00:00.000Z'),
      ('new-operator-session', 'new-token', 'active-user', 'tenant-b', 'owner', '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z', '2026-08-15T08:00:00.000Z', NULL)`,
  );
  await database.query(
    `INSERT INTO operator_access_audit (audit_id, tenant_id, event_type, outcome, occurred_at, metadata) VALUES
      ('old-audit', 'tenant-a', 'LOGIN_SUCCEEDED', 'success', '2025-01-01T00:00:00.000Z', '{}'::jsonb),
      ('new-audit', 'tenant-b', 'LOGIN_SUCCEEDED', 'success', '2026-08-15T00:00:00.000Z', '{}'::jsonb)`,
  );
}

async function tableCount(database: PostgresDatabase, table: string, tenantId: string): Promise<number> {
  const result = await database.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function recordExists(
  database: PostgresDatabase,
  table: string,
  column: string,
  value: string,
): Promise<boolean> {
  const result = await database.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [value]);
  return result.rowCount !== 0;
}

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
