import type { SessionReplaySnapshot } from "./session-replay.js";
import type { CallEvent } from "../events/call-event.js";
import type { CallSession } from "../session/call-session.js";

export type TenantCallDetailToolEvent = {
  name: string;
  outcome: "requested" | "completed" | "failed" | "skipped";
  reason?: string;
};

export type TenantCallDetailEvent = {
  eventType: string;
  occurredAt: string;
  redactionStatus: string;
  tool?: TenantCallDetailToolEvent;
};

export type TenantCallDetail = {
  tenantId: string;
  session: {
    sessionId: string;
    currentState: string;
    intent: string | null;
    sentiment: string;
    retryCount: number;
    escalationScore: number;
    createdAt: string;
    updatedAt: string;
  };
  escalated: boolean;
  eventCount: number;
  redactedTranscriptCount: number;
  interruptionCount: number;
  collectedFactNames: string[];
  missingFactNames: string[];
  completedToolNames: string[];
  failedToolNames: string[];
  handoffPriority?: string;
  handoffReason?: string;
  timeline: TenantCallDetailEvent[];
};

export function createTenantCallDetail(input: {
  session: CallSession;
  events: CallEvent[];
  snapshot: SessionReplaySnapshot;
}): TenantCallDetail {
  const detail: TenantCallDetail = {
    tenantId: input.session.tenantId,
    session: {
      sessionId: input.session.sessionId,
      currentState: input.session.currentState,
      intent: input.session.intent,
      sentiment: input.session.sentiment,
      retryCount: input.session.retryCount,
      escalationScore: input.session.escalationScore,
      createdAt: input.session.createdAt,
      updatedAt: input.session.updatedAt,
    },
    escalated: input.snapshot.escalated,
    eventCount: input.snapshot.eventCount,
    redactedTranscriptCount: input.snapshot.redactedTranscriptCount,
    interruptionCount: input.snapshot.interruptionCount,
    collectedFactNames: Object.keys(input.session.facts).sort(),
    missingFactNames: [...(input.snapshot.handoff?.missingFacts ?? [])],
    completedToolNames: [...input.snapshot.completedToolNames],
    failedToolNames: [...input.snapshot.failedToolNames],
    timeline: input.events.map(summarizeTimelineEvent),
  };
  addIfPresent(detail, "handoffPriority", input.snapshot.handoff?.priority);
  addIfPresent(detail, "handoffReason", input.snapshot.handoff?.reason);
  return detail;
}

function summarizeTimelineEvent(event: CallEvent): TenantCallDetailEvent {
  const summary: TenantCallDetailEvent = {
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    redactionStatus: event.redactionStatus,
  };
  const tool = summarizeToolEvent(event);
  if (tool) summary.tool = tool;
  return summary;
}

function summarizeToolEvent(event: CallEvent): TenantCallDetailToolEvent | undefined {
  const outcomeByType: Partial<Record<string, TenantCallDetailToolEvent["outcome"]>> = {
    TOOL_REQUESTED: "requested",
    TOOL_EXECUTED: "completed",
    TOOL_FAILED: "failed",
    TOOL_SKIPPED: "skipped",
  };
  const outcome = outcomeByType[event.eventType];
  const toolName = event.payload.toolName;
  if (!outcome || typeof toolName !== "string" || !toolName.trim()) return undefined;
  const tool: TenantCallDetailToolEvent = { name: toolName, outcome };
  if (outcome === "skipped") {
    const reason = safeSkipReason(event.payload.reason);
    if (reason) tool.reason = reason;
  }
  return tool;
}

function safeSkipReason(value: unknown): string | undefined {
  if (value === "already_completed" || value === "tenant_feature_disabled") return value;
  return undefined;
}

function addIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}
