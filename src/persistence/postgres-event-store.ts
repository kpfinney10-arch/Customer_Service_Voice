import type { CallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import type { PostgresDatabase, PostgresQueryable } from "./postgres-client.js";

type EventRow = {
  payload: CallEvent;
};

export class PostgresEventStore implements EventStore {
  constructor(private readonly database: PostgresDatabase) {}

  async append(events: CallEvent[]): Promise<void> {
    if (events.length === 0) return;
    const connection = await this.database.connect();
    try {
      await connection.query("BEGIN");
      for (const event of events) {
        await insertEvent(connection, event);
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  async listBySession(tenantId: string, sessionId: string): Promise<CallEvent[]> {
    const result = await this.database.query<EventRow>(
      `SELECT payload
       FROM call_events
       WHERE tenant_id = $1 AND session_id = $2
       ORDER BY occurred_at ASC, event_id ASC`,
      [tenantId, sessionId],
    );
    return result.rows.map((row) => row.payload);
  }

  async listRecentByTenant(tenantId: string, limit: number): Promise<CallEvent[]> {
    const result = await this.database.query<EventRow>(
      `SELECT payload
       FROM call_events
       WHERE tenant_id = $1
       ORDER BY occurred_at DESC, event_id DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    return result.rows.map((row) => row.payload);
  }
}

async function insertEvent(database: PostgresQueryable, event: CallEvent): Promise<void> {
  await database.query(
    `INSERT INTO call_events (
       tenant_id, event_id, session_id, call_id, event_type,
       correlation_id, schema_version, redaction_status, occurred_at, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (tenant_id, event_id) DO NOTHING`,
    [
      event.tenantId,
      event.eventId,
      event.sessionId,
      event.callId,
      event.eventType,
      event.correlationId,
      event.schemaVersion,
      event.redactionStatus,
      event.occurredAt,
      JSON.stringify(event),
    ],
  );
}
