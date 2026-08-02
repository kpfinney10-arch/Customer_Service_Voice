import type { PostgresDatabase } from "./postgres-client.js";

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
    for (const migration of MIGRATIONS) {
      const existing = await connection.query<{ version: string }>(
        "SELECT version FROM schema_migrations WHERE version = $1",
        [migration.version],
      );
      if (existing.rowCount !== 0) continue;
      await connection.query(migration.sql);
      await connection.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [migration.version],
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

const MIGRATIONS = [
  {
    version: "001_initial_voice_persistence",
    sql: INITIAL_SCHEMA_SQL,
  },
  {
    version: "002_stable_event_sequence",
    sql: `
      ALTER TABLE call_events
        ADD COLUMN event_sequence bigserial;

      CREATE UNIQUE INDEX call_events_event_sequence_idx
        ON call_events (event_sequence);
    `,
  },
  {
    version: "003_operator_identity_and_access",
    sql: `
      CREATE TABLE operator_users (
        user_id text PRIMARY KEY,
        tenant_id text NOT NULL,
        email text NOT NULL,
        display_name text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE (tenant_id, email)
      );

      CREATE INDEX operator_users_tenant_active_idx
        ON operator_users (tenant_id, active);

      CREATE TABLE operator_sessions (
        session_id text PRIMARY KEY,
        token_hash text NOT NULL UNIQUE,
        user_id text NOT NULL REFERENCES operator_users(user_id),
        tenant_id text NOT NULL,
        role text NOT NULL CHECK (role IN ('owner', 'operator', 'viewer')),
        created_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz
      );

      CREATE INDEX operator_sessions_user_active_idx
        ON operator_sessions (user_id, expires_at DESC)
        WHERE revoked_at IS NULL;

      CREATE TABLE operator_access_audit (
        audit_id text PRIMARY KEY,
        tenant_id text,
        user_id text,
        session_id text,
        event_type text NOT NULL,
        outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
        occurred_at timestamptz NOT NULL,
        request_id text,
        target_id text,
        metadata jsonb NOT NULL
      );

      CREATE INDEX operator_access_audit_tenant_occurred_idx
        ON operator_access_audit (tenant_id, occurred_at DESC);
    `,
  },
] as const;
