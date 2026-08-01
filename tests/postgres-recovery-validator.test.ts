import assert from "node:assert/strict";
import { test } from "node:test";
import type { PostgresQueryable } from "../src/persistence/postgres-client.js";
import { validatePostgresRecovery } from "../src/persistence/postgres-recovery-validator.js";

test("PostgreSQL recovery validator reports aggregate health without returning record data", async () => {
  const database = createValidationDatabase({
    migrations: ["001_initial_voice_persistence", "002_stable_event_sequence"],
    tenants: 1,
    sessions: 12,
    events: 87,
    idempotencyRecords: 31,
  });

  assert.deepEqual(await validatePostgresRecovery(database), {
    ok: true,
    migrationVersions: [
      "001_initial_voice_persistence",
      "002_stable_event_sequence",
    ],
    counts: {
      tenants: 1,
      sessions: 12,
      events: 87,
      idempotencyRecords: 31,
    },
    integrity: {
      missingEventSequences: 0,
      duplicateEventSequences: 0,
      orphanedEvents: 0,
    },
  });
});

test("PostgreSQL recovery validator fails incomplete or inconsistent restores", async () => {
  const database = createValidationDatabase({
    migrations: ["001_initial_voice_persistence"],
    tenants: 1,
    sessions: 12,
    events: 87,
    idempotencyRecords: 31,
    missingEventSequences: 2,
    duplicateEventSequences: 1,
    orphanedEvents: 3,
  });

  assert.equal((await validatePostgresRecovery(database)).ok, false);
});

type ValidationFixture = {
  migrations: string[];
  tenants: number;
  sessions: number;
  events: number;
  idempotencyRecords: number;
  missingEventSequences?: number;
  duplicateEventSequences?: number;
  orphanedEvents?: number;
};

function createValidationDatabase(fixture: ValidationFixture): PostgresQueryable {
  return {
    async query(sql: string) {
      if (sql.includes("SELECT version FROM schema_migrations")) {
        return queryResult(fixture.migrations.map((version) => ({ version })));
      }
      if (sql.includes("COUNT(DISTINCT tenant_id)")) {
        return countResult(fixture.tenants);
      }
      if (sql.includes("FROM call_sessions")) return countResult(fixture.sessions);
      if (sql.includes("WHERE event_sequence IS NULL")) {
        return countResult(fixture.missingEventSequences ?? 0);
      }
      if (sql.includes("duplicate_sequences")) {
        return countResult(fixture.duplicateEventSequences ?? 0);
      }
      if (sql.includes("LEFT JOIN call_sessions")) {
        return countResult(fixture.orphanedEvents ?? 0);
      }
      if (sql.includes("FROM call_events")) return countResult(fixture.events);
      if (sql.includes("FROM idempotency_records")) {
        return countResult(fixture.idempotencyRecords);
      }
      throw new Error(`Unexpected recovery validation query: ${sql}`);
    },
  } as PostgresQueryable;
}

function countResult(count: number) {
  return queryResult([{ count: String(count) }]);
}

function queryResult<T extends object>(rows: T[]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}
