import type { CallEvent } from "../events/call-event.js";
import type { CallSession } from "../session/call-session.js";
import type { FirstCallHandoffSummary } from "../verticals/funeral-home/first-call-handoff.js";

export type SessionReplaySnapshot = {
  tenantId: string;
  callId: string;
  sessionId: string;
  currentState: string;
  intent: string | null;
  sentiment: string;
  eventCount: number;
  latestEventType?: string;
  latestEventAt?: string;
  escalated: boolean;
  failedToolNames: string[];
  completedToolNames: string[];
  redactedTranscriptCount: number;
  handoff?: FirstCallHandoffSummary;
};

export function createSessionReplaySnapshot(input: {
  session: CallSession;
  events: CallEvent[];
  handoff?: FirstCallHandoffSummary;
}): SessionReplaySnapshot {
  const latestEvent = input.events.at(-1);
  const failedToolNames = toolNamesByStatus(input.events, false);
  const completedToolNames = toolNamesByStatus(input.events, true);
  const snapshot: SessionReplaySnapshot = {
    tenantId: input.session.tenantId,
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    currentState: input.session.currentState,
    intent: input.session.intent,
    sentiment: input.session.sentiment,
    eventCount: input.events.length,
    escalated: input.events.some((event) => event.eventType === "ESCALATION_TRIGGERED"),
    failedToolNames,
    completedToolNames,
    redactedTranscriptCount: input.events.filter(
      (event) => event.eventType === "TRANSCRIPT_RECEIVED" && event.redactionStatus === "redacted",
    ).length,
  };
  addIfPresent(snapshot, "latestEventType", latestEvent?.eventType);
  addIfPresent(snapshot, "latestEventAt", latestEvent?.occurredAt);
  addIfPresent(snapshot, "handoff", input.handoff);
  return snapshot;
}

function toolNamesByStatus(events: CallEvent[], ok: boolean): string[] {
  return events
    .filter((event) => event.eventType === (ok ? "TOOL_EXECUTED" : "TOOL_FAILED"))
    .map((event) => event.payload.toolName)
    .filter((value): value is string => typeof value === "string");
}

function addIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}
