import { resolve, join } from "node:path";
import { InMemoryEventStore } from "../events/in-memory-event-store.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import { InMemorySessionStore } from "../session/in-memory-session-store.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import { FileEventStore } from "./file-event-store.js";
import { FileSessionStore } from "./file-session-store.js";

export type StorageDriver = "memory" | "file";

export type PersistenceStores = {
  driver: StorageDriver;
  sessionStore: SessionStore;
  eventStore: EventStore;
  dataDir?: string;
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
    };
  }

  const dataDir = resolve(env.STORAGE_DATA_DIR?.trim() || ".voice-ai-data");
  return {
    driver,
    dataDir,
    sessionStore: new FileSessionStore(join(dataDir, "sessions")),
    eventStore: new FileEventStore(join(dataDir, "events.jsonl")),
  };
}

function parseStorageDriver(value: string | undefined): StorageDriver {
  const normalized = value?.trim().toLowerCase() || "memory";
  if (normalized === "memory" || normalized === "file") return normalized;
  throw new PersistenceConfigError("STORAGE_DRIVER must be either memory or file.");
}
