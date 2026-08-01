import type { CallEvent } from "./call-event.js";
import type { CallEventType } from "../domain/call-types.js";

export type EventStore = {
  append: (events: CallEvent[]) => Promise<void> | void;
  listBySession: (
    tenantId: string,
    sessionId: string,
  ) => Promise<CallEvent[]> | CallEvent[];
  listRecentByTenant: (
    tenantId: string,
    limit: number,
  ) => Promise<CallEvent[]> | CallEvent[];
  listRecentByTypesSince: (
    eventTypes: CallEventType[],
    since: string,
    limit: number,
  ) => Promise<CallEvent[]> | CallEvent[];
};

export class InMemoryEventStore implements EventStore {
  private eventsBySession = new Map<string, CallEvent[]>();

  append(events: CallEvent[]): void {
    for (const event of events) {
      const key = eventKey(event.tenantId, event.sessionId);
      const existing = this.eventsBySession.get(key) ?? [];
      existing.push(event);
      this.eventsBySession.set(key, existing);
    }
  }

  listBySession(tenantId: string, sessionId: string): CallEvent[] {
    return [...(this.eventsBySession.get(eventKey(tenantId, sessionId)) ?? [])];
  }

  listRecentByTenant(tenantId: string, limit: number): CallEvent[] {
    return [...this.eventsBySession.values()]
      .flat()
      .filter((event) => event.tenantId === tenantId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);
  }

  listRecentByTypesSince(
    eventTypes: CallEventType[],
    since: string,
    limit: number,
  ): CallEvent[] {
    const includedTypes = new Set(eventTypes);
    return [...this.eventsBySession.values()]
      .flat()
      .filter(
        (event) => includedTypes.has(event.eventType) && event.occurredAt >= since,
      )
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);
  }
}

function eventKey(tenantId: string, sessionId: string): string {
  return `${tenantId}:${sessionId}`;
}
