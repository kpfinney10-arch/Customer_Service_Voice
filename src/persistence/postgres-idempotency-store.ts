import type { IdempotencyRecord, IdempotencyStore } from "../security/idempotency.js";
import type { PostgresQueryable } from "./postgres-client.js";

type IdempotencyRow = {
  tenant_id: string;
  idempotency_key: string;
  fingerprint: string;
  status_code: number;
  body: object;
  created_at: Date | string;
};

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly database: PostgresQueryable) {}

  async get(tenantId: string, key: string): Promise<IdempotencyRecord | undefined> {
    const result = await this.database.query<IdempotencyRow>(
      `SELECT tenant_id, idempotency_key, fingerprint, status_code, body, created_at
       FROM idempotency_records
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, key],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      tenantId: row.tenant_id,
      key: row.idempotency_key,
      fingerprint: row.fingerprint,
      statusCode: row.status_code,
      body: row.body,
      createdAt: toIsoString(row.created_at),
    };
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO idempotency_records (
         tenant_id, idempotency_key, fingerprint, status_code, body, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`,
      [
        record.tenantId,
        record.key,
        record.fingerprint,
        record.statusCode,
        JSON.stringify(record.body),
        record.createdAt,
      ],
    );
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
