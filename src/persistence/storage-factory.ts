import { resolve, join } from "node:path";
import { Pool } from "pg";
import { InMemoryEventStore } from "../events/in-memory-event-store.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import { InMemoryIdempotencyStore } from "../security/idempotency.js";
import type { IdempotencyStore } from "../security/idempotency.js";
import { InMemorySessionStore } from "../session/in-memory-session-store.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import { FileEventStore } from "./file-event-store.js";
import { FileIdempotencyStore } from "./file-idempotency-store.js";
import { FileSessionStore } from "./file-session-store.js";
import { PostgresEventStore } from "./postgres-event-store.js";
import { PostgresIdempotencyStore } from "./postgres-idempotency-store.js";
import { migratePostgres } from "./postgres-schema.js";
import { PostgresSessionStore } from "./postgres-session-store.js";

export type StorageDriver = "memory" | "file" | "postgres";

export type PersistenceStores = {
  driver: StorageDriver;
  sessionStore: SessionStore;
  eventStore: EventStore;
  idempotencyStore: IdempotencyStore;
  dataDir?: string;
  initialize: () => Promise<void>;
  close: () => Promise<void>;
};

export class PersistenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceConfigError";
  }
}

export function createPersistenceStoresFromEnv(
  env: Record<string, string | undefined> = process.env,
): PersistenceStores {
  const driver = parseStorageDriver(env.STORAGE_DRIVER);
  if (driver === "memory") {
    return {
      driver,
      sessionStore: new InMemorySessionStore(),
      eventStore: new InMemoryEventStore(),
      idempotencyStore: new InMemoryIdempotencyStore(),
      initialize: async () => {},
      close: async () => {},
    };
  }

  if (driver === "file") {
    const dataDir = resolve(env.STORAGE_DATA_DIR?.trim() || ".voice-ai-data");
    return {
      driver,
      dataDir,
      sessionStore: new FileSessionStore(join(dataDir, "sessions")),
      eventStore: new FileEventStore(join(dataDir, "events.jsonl")),
      idempotencyStore: new FileIdempotencyStore(join(dataDir, "idempotency")),
      initialize: async () => {},
      close: async () => {},
    };
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new PersistenceConfigError(
      "DATABASE_URL is required when STORAGE_DRIVER=postgres.",
    );
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: parsePoolSize(env.POSTGRES_POOL_MAX),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  return {
    driver,
    sessionStore: new PostgresSessionStore(pool),
    eventStore: new PostgresEventStore(pool),
    idempotencyStore: new PostgresIdempotencyStore(pool),
    initialize: async () => migratePostgres(pool),
    close: async () => pool.end(),
  };
}

function parseStorageDriver(value: string | undefined): StorageDriver {
  const normalized = value?.trim().toLowerCase() || "memory";
  if (normalized === "memory" || normalized === "file" || normalized === "postgres") {
    return normalized;
  }
  throw new PersistenceConfigError(
    "STORAGE_DRIVER must be memory, file, or postgres.",
  );
}

function parsePoolSize(value: string | undefined): number {
  if (!value?.trim()) return 10;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new PersistenceConfigError(
      "POSTGRES_POOL_MAX must be an integer between 1 and 100.",
    );
  }
  return parsed;
}
