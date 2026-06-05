import type { CallSession } from "./call-session.js";

export type SessionStore = {
  save: (session: CallSession) => Promise<void> | void;
  get: (tenantId: string, sessionId: string) => Promise<CallSession | undefined> | CallSession | undefined;
};

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, CallSession>();

  save(session: CallSession): void {
    this.sessions.set(sessionKey(session.tenantId, session.sessionId), session);
  }

  get(tenantId: string, sessionId: string): CallSession | undefined {
    return this.sessions.get(sessionKey(tenantId, sessionId));
  }
}

function sessionKey(tenantId: string, sessionId: string): string {
  return `${tenantId}:${sessionId}`;
}
