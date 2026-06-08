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
  interruptionCount: number;
  providerCommandBatches?: ProviderCommandBatchSummary[];
  handoff?: FirstCallHandoffSummary;
};

export type ProviderCommandBatchSummary = {
  provider: string;
  providerEventType: string;
  occurredAt: string;
  commandCount: number;
  commandNames: string[];
  allSucceeded: boolean;
  failedCommandNames: string[];
  commandResults: ReplayProviderCommandResultSummary[];
};

export type ReplayProviderCommandResultSummary = {
  command: string;
  ok: boolean;
  statusCode: number;
  dryRun?: boolean;
  failureSummary?: string;
};

export function createSessionReplaySnapshot(input: {
  session: CallSession;
  events: CallEvent[];
  handoff?: FirstCallHandoffSummary;
}): SessionReplaySnapshot {
  const latestEvent = input.events.at(-1);
  const failedToolNames = toolNamesByStatus(input.events, false);
  const completedToolNames = toolNamesByStatus(input.events, true);
  const providerCommandBatches = summarizeProviderCommandBatches(input.events);
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
    interruptionCount: input.events.filter((event) => event.eventType === "CALL_INTERRUPTED").length,
  };
  addIfPresent(snapshot, "latestEventType", latestEvent?.eventType);
  addIfPresent(snapshot, "latestEventAt", latestEvent?.occurredAt);
  if (providerCommandBatches.length > 0) {
    snapshot.providerCommandBatches = providerCommandBatches;
  }
  addIfPresent(snapshot, "handoff", input.handoff);
  return snapshot;
}

function toolNamesByStatus(events: CallEvent[], ok: boolean): string[] {
  return events
    .filter((event) => event.eventType === (ok ? "TOOL_EXECUTED" : "TOOL_FAILED"))
    .map((event) => event.payload.toolName)
    .filter((value): value is string => typeof value === "string");
}

function summarizeProviderCommandBatches(events: CallEvent[]): ProviderCommandBatchSummary[] {
  return events
    .filter((event) => event.eventType === "PROVIDER_COMMANDS_EXECUTED")
    .map((event) => {
      const summary: ProviderCommandBatchSummary = {
        provider: stringFromPayload(event.payload.provider, "unknown"),
        providerEventType: stringFromPayload(event.payload.providerEventType, "unknown"),
        occurredAt: event.occurredAt,
        commandCount: numberFromPayload(event.payload.commandCount),
        commandNames: stringArrayFromPayload(event.payload.commandNames),
        allSucceeded: booleanFromPayload(event.payload.allSucceeded),
        failedCommandNames: stringArrayFromPayload(event.payload.failedCommandNames),
        commandResults: commandResultsFromPayload(event.payload.commandResults),
      };
      return summary;
    });
}

function commandResultsFromPayload(value: unknown): ReplayProviderCommandResultSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const result: ReplayProviderCommandResultSummary = {
        command: stringFromPayload(item.command, "unknown"),
        ok: booleanFromPayload(item.ok),
        statusCode: numberFromPayload(item.statusCode),
      };
      const dryRun = item.dryRun;
      if (typeof dryRun === "boolean") result.dryRun = dryRun;
      const failureSummary = item.failureSummary;
      if (typeof failureSummary === "string" && failureSummary.trim()) {
        result.failureSummary = failureSummary;
      }
      return result;
    });
}

function stringArrayFromPayload(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function stringFromPayload(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberFromPayload(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanFromPayload(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function addIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}
