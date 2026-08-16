import type { PostgresQueryable } from "./postgres-client.js";

const EXPECTED_MIGRATIONS = [
  "001_initial_voice_persistence",
  "002_stable_event_sequence",
  "003_operator_identity_and_access",
  "004_pilot_data_lifecycle",
] as const;

export type PostgresRecoveryValidation = {
  ok: boolean;
  migrationVersions: string[];
  counts: {
    tenants: number;
    sessions: number;
    events: number;
    idempotencyRecords: number;
  };
  integrity: {
    missingEventSequences: number;
    duplicateEventSequences: number;
    orphanedEvents: number;
  };
};

type CountRow = { count: string | number };
type VersionRow = { version: string };

export async function validatePostgresRecovery(
  database: PostgresQueryable,
): Promise<PostgresRecoveryValidation> {
  const [migrationResult, tenantResult, sessionResult, eventResult, idempotencyResult] =
    await Promise.all([
      database.query<VersionRow>(
        "SELECT version FROM schema_migrations ORDER BY version ASC",
      ),
      database.query<CountRow>(
        `SELECT COUNT(DISTINCT tenant_id) AS count
         FROM call_sessions`,
      ),
      database.query<CountRow>("SELECT COUNT(*) AS count FROM call_sessions"),
      database.query<CountRow>("SELECT COUNT(*) AS count FROM call_events"),
      database.query<CountRow>("SELECT COUNT(*) AS count FROM idempotency_records"),
    ]);

  const [missingSequenceResult, duplicateSequenceResult, orphanedEventResult] =
    await Promise.all([
      database.query<CountRow>(
        `SELECT COUNT(*) AS count
         FROM call_events
         WHERE event_sequence IS NULL`,
      ),
      database.query<CountRow>(
        `SELECT COUNT(*) AS count
         FROM (
           SELECT event_sequence
           FROM call_events
           GROUP BY event_sequence
           HAVING COUNT(*) > 1
         ) duplicate_sequences`,
      ),
      database.query<CountRow>(
        `SELECT COUNT(*) AS count
         FROM call_events events
         LEFT JOIN call_sessions sessions
           ON sessions.tenant_id = events.tenant_id
          AND sessions.session_id = events.session_id
         WHERE sessions.session_id IS NULL`,
      ),
    ]);

  const migrationVersions = migrationResult.rows.map((row) => row.version);
  const integrity = {
    missingEventSequences: toCount(missingSequenceResult.rows[0]),
    duplicateEventSequences: toCount(duplicateSequenceResult.rows[0]),
    orphanedEvents: toCount(orphanedEventResult.rows[0]),
  };
  const migrationsMatch =
    migrationVersions.length === EXPECTED_MIGRATIONS.length &&
    EXPECTED_MIGRATIONS.every((version, index) => migrationVersions[index] === version);

  return {
    ok:
      migrationsMatch &&
      integrity.missingEventSequences === 0 &&
      integrity.duplicateEventSequences === 0 &&
      integrity.orphanedEvents === 0,
    migrationVersions,
    counts: {
      tenants: toCount(tenantResult.rows[0]),
      sessions: toCount(sessionResult.rows[0]),
      events: toCount(eventResult.rows[0]),
      idempotencyRecords: toCount(idempotencyResult.rows[0]),
    },
    integrity,
  };
}

function toCount(row: CountRow | undefined): number {
  if (!row) return 0;
  return Number(row.count);
}
