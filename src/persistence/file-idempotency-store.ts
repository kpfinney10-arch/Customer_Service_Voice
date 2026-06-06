import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IdempotencyRecord, IdempotencyStore } from "../security/idempotency.js";

export class FileIdempotencyStore implements IdempotencyStore {
  constructor(private readonly directory: string) {}

  async get(tenantId: string, key: string): Promise<IdempotencyRecord | undefined> {
    try {
      const raw = await readFile(this.pathFor(tenantId, key), "utf8");
      return JSON.parse(raw) as IdempotencyRecord;
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  async save(record: IdempotencyRecord): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.pathFor(record.tenantId, record.key), JSON.stringify(record, null, 2), "utf8");
  }

  private pathFor(tenantId: string, key: string): string {
    return join(this.directory, `${safePathPart(tenantId)}__${safePathPart(key)}.json`);
  }
}

function safePathPart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
