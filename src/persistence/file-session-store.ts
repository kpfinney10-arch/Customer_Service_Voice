import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallSession } from "../session/call-session.js";
import type { SessionStore } from "../session/in-memory-session-store.js";

export class FileSessionStore implements SessionStore {
  constructor(private readonly directory: string) {}

  async save(session: CallSession): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.pathFor(session.tenantId, session.sessionId), JSON.stringify(session, null, 2), "utf8");
  }

  async get(tenantId: string, sessionId: string): Promise<CallSession | undefined> {
    try {
      const raw = await readFile(this.pathFor(tenantId, sessionId), "utf8");
      return JSON.parse(raw) as CallSession;
    } catch (error) {
      if (isMissingFileError(error)) return undefined;
      throw error;
    }
  }

  private pathFor(tenantId: string, sessionId: string): string {
    return join(this.directory, `${safePathPart(tenantId)}__${safePathPart(sessionId)}.json`);
  }
}

function safePathPart(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
