import { mkdir, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";

export class FileEventStore implements EventStore {
  constructor(private readonly filePath: string) {}

  async append(events: CallEvent[]): Promise<void> {
    if (events.length === 0) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    const lines = events.map((event) => JSON.stringify(event)).join("\n");
    await appendFile(this.filePath, `${lines}\n`, "utf8");
  }

  async listBySession(tenantId: string, sessionId: string): Promise<CallEvent[]> {
    const events = await this.readEvents();
    return events.filter((event) => event.tenantId === tenantId && event.sessionId === sessionId);
  }

  private async readEvents(): Promise<CallEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CallEvent);
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
