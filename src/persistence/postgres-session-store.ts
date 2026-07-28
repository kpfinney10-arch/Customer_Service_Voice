import type { CallSession } from "../session/call-session.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import type { PostgresQueryable } from "./postgres-client.js";

type SessionRow = {
  payload: CallSession;
};

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly database: PostgresQueryable) {}

  async save(session: CallSession): Promise<void> {
    await this.database.query(
      `INSERT INTO call_sessions (
         tenant_id, session_id, call_id, updated_at, payload
       ) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (tenant_id, session_id) DO UPDATE SET
         call_id = EXCLUDED.call_id,
         updated_at = EXCLUDED.updated_at,
         payload = EXCLUDED.payload`,
      [
        session.tenantId,
        session.sessionId,
        session.callId,
        session.updatedAt,
        JSON.stringify(session),
      ],
    );
  }

  async get(tenantId: string, sessionId: string): Promise<CallSession | undefined> {
    const result = await this.database.query<SessionRow>(
      `SELECT payload
       FROM call_sessions
       WHERE tenant_id = $1 AND session_id = $2`,
      [tenantId, sessionId],
    );
    return result.rows[0]?.payload;
  }

  async listRecentByTenant(tenantId: string, limit: number): Promise<CallSession[]> {
    const result = await this.database.query<SessionRow>(
      `SELECT payload
       FROM call_sessions
       WHERE tenant_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map((row) => row.payload);
  }
}
