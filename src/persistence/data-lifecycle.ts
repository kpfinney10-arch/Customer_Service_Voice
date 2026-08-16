import crypto from "node:crypto";
import type { PostgresConnection, PostgresDatabase, PostgresQueryable } from "./postgres-client.js";

const TWILIO_CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;
const DATA_LIFECYCLE_LOCK_ID = 1_902_024_002;

export const PILOT_RETENTION_DAYS = {
  callData: 30,
  idempotency: 7,
  operatorSessions: 30,
  operatorAccessAudit: 365,
  inactiveOperatorUsers: 30,
} as const;

export type DataPurgeReason =
  | "customer_request"
  | "tenant_offboarding"
  | "test_data_cleanup";

export type DatabaseDeletionCounts = {
  callSessions: number;
  callEvents: number;
  idempotencyRecords: number;
  operatorSessions: number;
  operatorAccessAudits: number;
  operatorUsers: number;
};

export type ProviderDeletionCounts = {
  twilioCalls: number;
};

export type TenantPurgePreview = {
  mode: "dry_run";
  counts: DatabaseDeletionCounts;
  providerCounts: ProviderDeletionCounts;
};

export type TenantPurgeReceipt = {
  mode: "executed";
  purgeId: string;
  requestId: string;
  tenantFingerprint: string;
  requestedBy: string;
  reason: DataPurgeReason;
  executedAt: string;
  deletedCounts: DatabaseDeletionCounts;
  providerCounts: ProviderDeletionCounts;
  duplicate: boolean;
};

export type RetentionCutoffs = {
  callDataBefore: string;
  idempotencyBefore: string;
  operatorSessionsBefore: string;
  operatorAccessAuditBefore: string;
  inactiveOperatorUsersBefore: string;
};

export type RetentionPreview = {
  mode: "dry_run";
  cutoffs: RetentionCutoffs;
  counts: DatabaseDeletionCounts;
  providerCounts: ProviderDeletionCounts;
};

export type RetentionReceipt = {
  mode: "executed";
  runId: string;
  executedAt: string;
  cutoffs: RetentionCutoffs;
  deletedCounts: DatabaseDeletionCounts;
  providerCounts: ProviderDeletionCounts;
  duplicate: boolean;
};

export type CallRecordDeletionClient = {
  deleteCall: (callSid: string) => Promise<void>;
};

type CallSessionKeyRow = {
  tenant_id: string;
  session_id: string;
  call_id: string;
};

type CountRow = { count: string | number };

type PurgeAuditRow = {
  purge_id: string;
  request_id: string;
  tenant_fingerprint: string;
  requested_by: string;
  reason: DataPurgeReason;
  executed_at: Date | string;
  deleted_counts: DatabaseDeletionCounts | string;
  provider_counts: ProviderDeletionCounts | string;
};

type RetentionRunRow = {
  run_id: string;
  executed_at: Date | string;
  cutoffs: RetentionCutoffs | string;
  deleted_counts: DatabaseDeletionCounts | string;
  provider_counts: ProviderDeletionCounts | string;
};

export class DataLifecycleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DataLifecycleError";
  }
}

export class PostgresDataLifecycleService {
  constructor(
    private readonly database: PostgresDatabase,
    private readonly callDeletionClient?: CallRecordDeletionClient,
  ) {}

  async previewTenantPurge(tenantId: string): Promise<TenantPurgePreview> {
    validateIdentifier(tenantId, "tenantId");
    const plan = await this.tenantPlan(this.database, tenantId);
    return {
      mode: "dry_run",
      counts: plan.counts,
      providerCounts: { twilioCalls: plan.twilioCallIds.length },
    };
  }

  async executeTenantPurge(input: {
    tenantId: string;
    confirmedTenantId: string;
    requestId: string;
    requestedBy: string;
    reason: DataPurgeReason;
    auditSecret: string;
    now?: string;
  }): Promise<TenantPurgeReceipt> {
    validateIdentifier(input.tenantId, "tenantId");
    validateIdentifier(input.requestId, "requestId");
    validateIdentifier(input.requestedBy, "requestedBy");
    validateReason(input.reason);
    if (input.confirmedTenantId !== input.tenantId) {
      throw new DataLifecycleError(
        "TENANT_CONFIRMATION_MISMATCH",
        "The confirmation tenant must exactly match the requested tenant.",
      );
    }
    if (input.auditSecret.length < 32) {
      throw new DataLifecycleError(
        "AUDIT_SECRET_TOO_SHORT",
        "The purge audit secret must contain at least 32 characters.",
      );
    }

    const tenantFingerprint = fingerprintTenant(input.tenantId, input.auditSecret);
    const existing = await findPurgeReceipt(this.database, input.requestId);
    if (existing) return receiptForExisting(existing, tenantFingerprint);

    const connection = await this.database.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock($1)", [DATA_LIFECYCLE_LOCK_ID]);
      const raced = await findPurgeReceipt(connection, input.requestId);
      if (raced) {
        await connection.query("ROLLBACK");
        return receiptForExisting(raced, tenantFingerprint);
      }

      const plan = await this.tenantPlan(connection, input.tenantId);
      await this.deleteProviderCalls(plan.twilioCallIds);
      const deletedCounts = await deleteTenantRows(connection, input.tenantId);
      const receipt: TenantPurgeReceipt = {
        mode: "executed",
        purgeId: crypto.randomUUID(),
        requestId: input.requestId,
        tenantFingerprint,
        requestedBy: input.requestedBy,
        reason: input.reason,
        executedAt: input.now ?? new Date().toISOString(),
        deletedCounts,
        providerCounts: { twilioCalls: plan.twilioCallIds.length },
        duplicate: false,
      };
      await connection.query(
        `INSERT INTO data_purge_audit (
           purge_id, request_id, tenant_fingerprint, requested_by, reason,
           executed_at, deleted_counts, provider_counts
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [
          receipt.purgeId,
          receipt.requestId,
          receipt.tenantFingerprint,
          receipt.requestedBy,
          receipt.reason,
          receipt.executedAt,
          JSON.stringify(receipt.deletedCounts),
          JSON.stringify(receipt.providerCounts),
        ],
      );
      await connection.query("COMMIT");
      return receipt;
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async previewRetention(now = new Date().toISOString()): Promise<RetentionPreview> {
    const cutoffs = retentionCutoffs(now);
    const plan = await this.retentionPlan(this.database, cutoffs);
    return {
      mode: "dry_run",
      cutoffs,
      counts: plan.counts,
      providerCounts: { twilioCalls: plan.twilioCallIds.length },
    };
  }

  async executeRetention(input: {
    runId: string;
    now?: string;
  }): Promise<RetentionReceipt> {
    validateIdentifier(input.runId, "runId");
    const existing = await findRetentionRun(this.database, input.runId);
    if (existing) return retentionReceiptForExisting(existing);

    const executedAt = input.now ?? new Date().toISOString();
    const cutoffs = retentionCutoffs(executedAt);

    const connection = await this.database.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("SELECT pg_advisory_xact_lock($1)", [DATA_LIFECYCLE_LOCK_ID]);
      const raced = await findRetentionRun(connection, input.runId);
      if (raced) {
        await connection.query("ROLLBACK");
        return retentionReceiptForExisting(raced);
      }
      const plan = await this.retentionPlan(connection, cutoffs);
      await this.deleteProviderCalls(plan.twilioCallIds);
      const deletedCounts = await deleteExpiredRows(connection, plan, cutoffs);
      const receipt: RetentionReceipt = {
        mode: "executed",
        runId: input.runId,
        executedAt,
        cutoffs,
        deletedCounts,
        providerCounts: { twilioCalls: plan.twilioCallIds.length },
        duplicate: false,
      };
      await connection.query(
        `INSERT INTO data_retention_runs (
           run_id, executed_at, cutoffs, deleted_counts, provider_counts
         ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)`,
        [
          receipt.runId,
          receipt.executedAt,
          JSON.stringify(receipt.cutoffs),
          JSON.stringify(receipt.deletedCounts),
          JSON.stringify(receipt.providerCounts),
        ],
      );
      await connection.query("COMMIT");
      return receipt;
    } catch (error) {
      await connection.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  private async tenantPlan(
    database: PostgresQueryable,
    tenantId: string,
  ): Promise<{
    counts: DatabaseDeletionCounts;
    twilioCallIds: string[];
  }> {
    const [sessions, events, idempotency, operatorSessions, audits, users, callRows] =
      await Promise.all([
        countTenantRows(database, "call_sessions", tenantId),
        countTenantRows(database, "call_events", tenantId),
        countTenantRows(database, "idempotency_records", tenantId),
        countTenantRows(database, "operator_sessions", tenantId),
        countTenantRows(database, "operator_access_audit", tenantId),
        countTenantRows(database, "operator_users", tenantId),
        database.query<Pick<CallSessionKeyRow, "call_id">>(
          "SELECT DISTINCT call_id FROM call_sessions WHERE tenant_id = $1",
          [tenantId],
        ),
      ]);
    return {
      counts: {
        callSessions: sessions,
        callEvents: events,
        idempotencyRecords: idempotency,
        operatorSessions,
        operatorAccessAudits: audits,
        operatorUsers: users,
      },
      twilioCallIds: callRows.rows
        .map((row) => row.call_id)
        .filter((callId) => TWILIO_CALL_SID_PATTERN.test(callId)),
    };
  }

  private async deleteProviderCalls(callIds: string[]): Promise<void> {
    if (callIds.length > 0 && !this.callDeletionClient) {
      throw new DataLifecycleError(
        "TWILIO_DELETION_NOT_CONFIGURED",
        "Twilio call records exist, but provider deletion credentials are not configured.",
      );
    }
    for (const callId of callIds) {
      await this.callDeletionClient?.deleteCall(callId);
    }
  }

  private async retentionPlan(
    database: PostgresQueryable,
    cutoffs: RetentionCutoffs,
  ): Promise<RetentionPlan> {
    const expiredSessions = await database.query<CallSessionKeyRow>(
      `SELECT tenant_id, session_id, call_id
       FROM call_sessions
       WHERE updated_at < $1`,
      [cutoffs.callDataBefore],
    );
    const inactiveUsers = await database.query<{ user_id: string }>(
      `SELECT user_id
       FROM operator_users
       WHERE active = false AND updated_at < $1`,
      [cutoffs.inactiveOperatorUsersBefore],
    );

    let callEventCount = 0;
    for (const session of expiredSessions.rows) {
      callEventCount += await countSessionEvents(database, session.tenant_id, session.session_id);
    }
    const expiredOperatorSessionIds = new Set<string>();
    const timeExpiredSessions = await database.query<{ session_id: string }>(
      `SELECT session_id
       FROM operator_sessions
       WHERE COALESCE(revoked_at, expires_at) < $1`,
      [cutoffs.operatorSessionsBefore],
    );
    for (const row of timeExpiredSessions.rows) expiredOperatorSessionIds.add(row.session_id);
    for (const user of inactiveUsers.rows) {
      const userSessions = await database.query<{ session_id: string }>(
        "SELECT session_id FROM operator_sessions WHERE user_id = $1",
        [user.user_id],
      );
      for (const row of userSessions.rows) expiredOperatorSessionIds.add(row.session_id);
    }

    const [idempotency, audits] = await Promise.all([
      countBefore(database, "idempotency_records", "created_at", cutoffs.idempotencyBefore),
      countBefore(database, "operator_access_audit", "occurred_at", cutoffs.operatorAccessAuditBefore),
    ]);
    return {
      counts: {
        callSessions: expiredSessions.rowCount ?? expiredSessions.rows.length,
        callEvents: callEventCount,
        idempotencyRecords: idempotency,
        operatorSessions: expiredOperatorSessionIds.size,
        operatorAccessAudits: audits,
        operatorUsers: inactiveUsers.rowCount ?? inactiveUsers.rows.length,
      },
      expiredSessions: expiredSessions.rows,
      expiredOperatorSessionIds: [...expiredOperatorSessionIds],
      inactiveOperatorUserIds: inactiveUsers.rows.map((row) => row.user_id),
      twilioCallIds: [...new Set(expiredSessions.rows
        .map((row) => row.call_id)
        .filter((callId) => TWILIO_CALL_SID_PATTERN.test(callId)))],
    };
  }
}

type RetentionPlan = {
  counts: DatabaseDeletionCounts;
  expiredSessions: CallSessionKeyRow[];
  expiredOperatorSessionIds: string[];
  inactiveOperatorUserIds: string[];
  twilioCallIds: string[];
};

async function countTenantRows(
  database: PostgresQueryable,
  table: string,
  tenantId: string,
): Promise<number> {
  const allowedTables = new Set([
    "call_sessions",
    "call_events",
    "idempotency_records",
    "operator_sessions",
    "operator_access_audit",
    "operator_users",
  ]);
  if (!allowedTables.has(table)) throw new Error("Unsupported lifecycle table.");
  const result = await database.query<CountRow>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return numberFromCount(result.rows[0]?.count);
}

async function deleteTenantRows(
  connection: PostgresConnection,
  tenantId: string,
): Promise<DatabaseDeletionCounts> {
  const operatorSessions = await connection.query(
    "DELETE FROM operator_sessions WHERE tenant_id = $1",
    [tenantId],
  );
  const audits = await connection.query(
    "DELETE FROM operator_access_audit WHERE tenant_id = $1",
    [tenantId],
  );
  const users = await connection.query(
    "DELETE FROM operator_users WHERE tenant_id = $1",
    [tenantId],
  );
  const events = await connection.query(
    "DELETE FROM call_events WHERE tenant_id = $1",
    [tenantId],
  );
  const sessions = await connection.query(
    "DELETE FROM call_sessions WHERE tenant_id = $1",
    [tenantId],
  );
  const idempotency = await connection.query(
    "DELETE FROM idempotency_records WHERE tenant_id = $1",
    [tenantId],
  );
  return {
    callSessions: sessions.rowCount ?? 0,
    callEvents: events.rowCount ?? 0,
    idempotencyRecords: idempotency.rowCount ?? 0,
    operatorSessions: operatorSessions.rowCount ?? 0,
    operatorAccessAudits: audits.rowCount ?? 0,
    operatorUsers: users.rowCount ?? 0,
  };
}

async function deleteExpiredRows(
  connection: PostgresConnection,
  plan: RetentionPlan,
  cutoffs: RetentionCutoffs,
): Promise<DatabaseDeletionCounts> {
  let eventCount = 0;
  let sessionCount = 0;
  for (const session of plan.expiredSessions) {
    const sessions = await connection.query(
      "DELETE FROM call_sessions WHERE tenant_id = $1 AND session_id = $2 AND updated_at < $3",
      [session.tenant_id, session.session_id, cutoffs.callDataBefore],
    );
    if ((sessions.rowCount ?? 0) === 0) continue;
    sessionCount += 1;
    const events = await connection.query(
      "DELETE FROM call_events WHERE tenant_id = $1 AND session_id = $2",
      [session.tenant_id, session.session_id],
    );
    eventCount += events.rowCount ?? 0;
  }

  let operatorSessionCount = 0;
  for (const sessionId of plan.expiredOperatorSessionIds) {
    const result = await connection.query(
      "DELETE FROM operator_sessions WHERE session_id = $1",
      [sessionId],
    );
    operatorSessionCount += result.rowCount ?? 0;
  }
  let operatorUserCount = 0;
  for (const userId of plan.inactiveOperatorUserIds) {
    const result = await connection.query(
      "DELETE FROM operator_users WHERE user_id = $1 AND active = false AND updated_at < $2",
      [userId, cutoffs.inactiveOperatorUsersBefore],
    );
    operatorUserCount += result.rowCount ?? 0;
  }
  const idempotency = await connection.query(
    "DELETE FROM idempotency_records WHERE created_at < $1",
    [cutoffs.idempotencyBefore],
  );
  const audits = await connection.query(
    "DELETE FROM operator_access_audit WHERE occurred_at < $1",
    [cutoffs.operatorAccessAuditBefore],
  );
  return {
    callSessions: sessionCount,
    callEvents: eventCount,
    idempotencyRecords: idempotency.rowCount ?? 0,
    operatorSessions: operatorSessionCount,
    operatorAccessAudits: audits.rowCount ?? 0,
    operatorUsers: operatorUserCount,
  };
}

async function findPurgeReceipt(
  database: PostgresQueryable,
  requestId: string,
): Promise<PurgeAuditRow | undefined> {
  const result = await database.query<PurgeAuditRow>(
    `SELECT purge_id, request_id, tenant_fingerprint, requested_by, reason,
            executed_at, deleted_counts, provider_counts
     FROM data_purge_audit
     WHERE request_id = $1`,
    [requestId],
  );
  return result.rows[0];
}

async function findRetentionRun(
  database: PostgresQueryable,
  runId: string,
): Promise<RetentionRunRow | undefined> {
  const result = await database.query<RetentionRunRow>(
    `SELECT run_id, executed_at, cutoffs, deleted_counts, provider_counts
     FROM data_retention_runs
     WHERE run_id = $1`,
    [runId],
  );
  return result.rows[0];
}

function receiptForExisting(
  row: PurgeAuditRow,
  expectedFingerprint: string,
): TenantPurgeReceipt {
  if (row.tenant_fingerprint !== expectedFingerprint) {
    throw new DataLifecycleError(
      "PURGE_REQUEST_REUSED",
      "The purge request ID was already used for a different tenant.",
    );
  }
  return {
    mode: "executed",
    purgeId: row.purge_id,
    requestId: row.request_id,
    tenantFingerprint: row.tenant_fingerprint,
    requestedBy: row.requested_by,
    reason: row.reason,
    executedAt: toIsoString(row.executed_at),
    deletedCounts: jsonObject<DatabaseDeletionCounts>(row.deleted_counts),
    providerCounts: jsonObject<ProviderDeletionCounts>(row.provider_counts),
    duplicate: true,
  };
}

function retentionReceiptForExisting(row: RetentionRunRow): RetentionReceipt {
  return {
    mode: "executed",
    runId: row.run_id,
    executedAt: toIsoString(row.executed_at),
    cutoffs: jsonObject<RetentionCutoffs>(row.cutoffs),
    deletedCounts: jsonObject<DatabaseDeletionCounts>(row.deleted_counts),
    providerCounts: jsonObject<ProviderDeletionCounts>(row.provider_counts),
    duplicate: true,
  };
}

function retentionCutoffs(now: string): RetentionCutoffs {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) {
    throw new DataLifecycleError("INVALID_RETENTION_TIME", "Retention time must be an ISO timestamp.");
  }
  return {
    callDataBefore: daysBefore(nowMs, PILOT_RETENTION_DAYS.callData),
    idempotencyBefore: daysBefore(nowMs, PILOT_RETENTION_DAYS.idempotency),
    operatorSessionsBefore: daysBefore(nowMs, PILOT_RETENTION_DAYS.operatorSessions),
    operatorAccessAuditBefore: daysBefore(nowMs, PILOT_RETENTION_DAYS.operatorAccessAudit),
    inactiveOperatorUsersBefore: daysBefore(nowMs, PILOT_RETENTION_DAYS.inactiveOperatorUsers),
  };
}

function daysBefore(nowMs: number, days: number): string {
  return new Date(nowMs - days * 24 * 60 * 60 * 1_000).toISOString();
}

async function countSessionEvents(
  database: PostgresQueryable,
  tenantId: string,
  sessionId: string,
): Promise<number> {
  const result = await database.query<CountRow>(
    "SELECT COUNT(*) AS count FROM call_events WHERE tenant_id = $1 AND session_id = $2",
    [tenantId, sessionId],
  );
  return numberFromCount(result.rows[0]?.count);
}

async function countBefore(
  database: PostgresQueryable,
  table: "idempotency_records" | "operator_access_audit",
  column: "created_at" | "occurred_at",
  cutoff: string,
): Promise<number> {
  const result = await database.query<CountRow>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${column} < $1`,
    [cutoff],
  );
  return numberFromCount(result.rows[0]?.count);
}

function fingerprintTenant(tenantId: string, auditSecret: string): string {
  return crypto.createHmac("sha256", auditSecret).update(tenantId).digest("hex");
}

function validateIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new DataLifecycleError(
      "INVALID_IDENTIFIER",
      `${name} must be a 1-128 character opaque identifier without whitespace or an email address.`,
    );
  }
}

function validateReason(reason: string): asserts reason is DataPurgeReason {
  if (!(["customer_request", "tenant_offboarding", "test_data_cleanup"] as string[]).includes(reason)) {
    throw new DataLifecycleError("INVALID_PURGE_REASON", "The purge reason is not supported.");
  }
}

function numberFromCount(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid database count.");
  return parsed;
}

function jsonObject<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
