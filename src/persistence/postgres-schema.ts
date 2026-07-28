import type { PostgresDatabase } from "./postgres-client.js";

const MIGRATION_VERSION = "001_initial_voice_persistence";
const MIGRATION_LOCK_ID = 1_902_024_001;

export async function migratePostgres(database: PostgresDatabase): Promise<void> {
  const connection = await database.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_ID]);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const existing = await connection.query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [MIGRATION_VERSION],
    );
    if (existing.rowCount === 0) {
      await connection.query(INITIAL_SCHEMA_SQL);
      await connection.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [MIGRATION_VERSION],
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

const INITIAL_SCHEMA_SQL = `
  CREATE TABLE call_sessions (
    tenant_id text NOT NULL,
    session_id text NOT NULL,
    call_id text NOT NULL,
    updated_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (tenant_id, session_id)
  );

  CREATE INDEX call_sessions_tenant_updated_at_idx
    ON call_sessions (tenant_id, updated_at DESC);

  CREATE TABLE call_events (
    tenant_id text NOT NULL,
    event_id text NOT NULL,
    session_id text NOT NULL,
    call_id text NOT NULL,
    event_type text NOT NULL,
    correlation_id text NOT NULL,
    schema_version integer NOT NULL,
    redaction_status text NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (tenant_id, event_id)
  );

  CREATE INDEX call_events_tenant_session_occurred_at_idx
    ON call_events (tenant_id, session_id, occurred_at ASC);

  CREATE INDEX call_events_tenant_occurred_at_idx
    ON call_events (tenant_id, occurred_at DESC);

  CREATE TABLE idempotency_records (
    tenant_id text NOT NULL,
    idempotency_key text NOT NULL,
    fingerprint text NOT NULL,
    status_code integer NOT NULL,
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, idempotency_key)
  );

  CREATE INDEX idempotency_records_tenant_created_at_idx
    ON idempotency_records (tenant_id, created_at DESC);
`;
