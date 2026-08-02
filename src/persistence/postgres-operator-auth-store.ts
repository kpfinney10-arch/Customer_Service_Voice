import type {
  OperatorAuditEvent,
  OperatorAuthStore,
  OperatorRole,
  OperatorSession,
  OperatorUser,
} from "../security/operator-auth-store.js";
import type { PostgresQueryable } from "./postgres-client.js";

type UserRow = {
  user_id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: OperatorRole;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

type SessionRow = {
  session_id: string;
  token_hash: string;
  user_id: string;
  tenant_id: string;
  role: OperatorRole;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
};

export class PostgresOperatorAuthStore implements OperatorAuthStore {
  constructor(private readonly database: PostgresQueryable) {}

  async upsertUser(user: OperatorUser): Promise<void> {
    await this.database.query(
      `INSERT INTO operator_users (
         user_id, tenant_id, email, display_name, password_hash, role, active, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (tenant_id, email) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         password_hash = EXCLUDED.password_hash,
         role = EXCLUDED.role,
         active = EXCLUDED.active,
         updated_at = EXCLUDED.updated_at`,
      [user.userId, user.tenantId, user.email, user.displayName, user.passwordHash, user.role, user.active, user.createdAt, user.updatedAt],
    );
  }

  async findUserByEmail(tenantId: string, email: string): Promise<OperatorUser | undefined> {
    const result = await this.database.query<UserRow>(
      `SELECT user_id, tenant_id, email, display_name, password_hash, role, active, created_at, updated_at
       FROM operator_users
       WHERE tenant_id = $1 AND email = $2`,
      [tenantId, email],
    );
    const row = result.rows[0];
    return row ? userFromRow(row) : undefined;
  }

  async findUserById(userId: string): Promise<OperatorUser | undefined> {
    const result = await this.database.query<UserRow>(
      `SELECT user_id, tenant_id, email, display_name, password_hash, role, active, created_at, updated_at
       FROM operator_users
       WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? userFromRow(row) : undefined;
  }

  async createSession(session: OperatorSession): Promise<void> {
    await this.database.query(
      `INSERT INTO operator_sessions (
         session_id, token_hash, user_id, tenant_id, role, created_at, last_seen_at, expires_at, revoked_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [session.sessionId, session.tokenHash, session.userId, session.tenantId, session.role, session.createdAt, session.lastSeenAt, session.expiresAt],
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<OperatorSession | undefined> {
    const result = await this.database.query<SessionRow>(
      `SELECT session_id, token_hash, user_id, tenant_id, role, created_at, last_seen_at, expires_at, revoked_at
       FROM operator_sessions
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? sessionFromRow(row) : undefined;
  }

  async touchSession(sessionId: string, lastSeenAt: string): Promise<void> {
    await this.database.query(
      `UPDATE operator_sessions SET last_seen_at = $2 WHERE session_id = $1 AND revoked_at IS NULL`,
      [sessionId, lastSeenAt],
    );
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.database.query(
      `UPDATE operator_sessions SET revoked_at = COALESCE(revoked_at, $2) WHERE session_id = $1`,
      [sessionId, revokedAt],
    );
  }

  async appendAudit(event: OperatorAuditEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO operator_access_audit (
         audit_id, tenant_id, user_id, session_id, event_type, outcome, occurred_at, request_id, target_id, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
      [
        event.auditId,
        event.tenantId ?? null,
        event.userId ?? null,
        event.sessionId ?? null,
        event.eventType,
        event.outcome,
        event.occurredAt,
        event.requestId ?? null,
        event.targetId ?? null,
        JSON.stringify(event.metadata),
      ],
    );
  }
}

function userFromRow(row: UserRow): OperatorUser {
  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    active: row.active,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function sessionFromRow(row: SessionRow): OperatorSession {
  const session: OperatorSession = {
    sessionId: row.session_id,
    tokenHash: row.token_hash,
    userId: row.user_id,
    tenantId: row.tenant_id,
    role: row.role,
    createdAt: toIsoString(row.created_at),
    lastSeenAt: toIsoString(row.last_seen_at),
    expiresAt: toIsoString(row.expires_at),
  };
  if (row.revoked_at) session.revokedAt = toIsoString(row.revoked_at);
  return session;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
