import type { CallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";

export const DEFAULT_CALL_ALERT_WINDOW_SECONDS = 1_800;
export const DEFAULT_LONG_TURN_ALERT_MS = 1_500;
export const DEFAULT_REPEATED_PROMPT_ALERT_COUNT = 3;
const MAX_MONITORED_EVENTS = 500;
const MONITORED_EVENT_TYPES = [
  "TOOL_FAILED",
  "PROVIDER_COMMANDS_EXECUTED",
  "HANDOFF_OUTCOME_RECORDED",
  "CALL_ENDED",
  "STATE_TRANSITIONED",
  "ESCALATION_TRIGGERED",
  "PROMPT_REPEATED",
] as const;

export type CallFailureKind =
  | "tool_failure"
  | "provider_command_failure"
  | "handoff_failure"
  | "abnormal_call_end"
  | "long_turn_latency"
  | "repeated_prompt";

export type CallHealthSnapshot = {
  ok: boolean;
  windowSeconds: number;
  failureCount: number;
  failureKinds: CallFailureKind[];
  lastFailureAt?: string;
};

export type CallHealthProbe = {
  snapshot: () => Promise<CallHealthSnapshot>;
};

export class EventStoreCallHealthProbe implements CallHealthProbe {
  private readonly windowSeconds: number;
  private readonly longTurnThresholdMs: number;
  private readonly repeatedPromptThreshold: number;
  private readonly now: () => Date;

  constructor(
    private readonly eventStore: EventStore,
    options: {
      windowSeconds?: number;
      longTurnThresholdMs?: number;
      repeatedPromptThreshold?: number;
      now?: () => Date;
    } = {},
  ) {
    this.windowSeconds = normalizeWindowSeconds(options.windowSeconds);
    this.longTurnThresholdMs = normalizeLongTurnThresholdMs(options.longTurnThresholdMs);
    this.repeatedPromptThreshold = normalizeRepeatedPromptThreshold(options.repeatedPromptThreshold);
    this.now = options.now ?? (() => new Date());
  }

  async snapshot(): Promise<CallHealthSnapshot> {
    const since = new Date(
      this.now().getTime() - this.windowSeconds * 1_000,
    ).toISOString();
    const candidates = await this.eventStore.listRecentByTypesSince(
      [...MONITORED_EVENT_TYPES],
      since,
      MAX_MONITORED_EVENTS,
    );
    const failures = [
      ...candidates.flatMap((event) =>
        classifyFailureKinds(event, this.longTurnThresholdMs, this.repeatedPromptThreshold).map((kind) => ({
          event,
          kind,
        })),
      ),
      ...repeatedDecisionFailures(candidates, this.repeatedPromptThreshold),
    ].sort((left, right) => right.event.occurredAt.localeCompare(left.event.occurredAt));
    const failureKinds = [...new Set(failures.map((item) => item.kind))].sort();
    const snapshot: CallHealthSnapshot = {
      ok: failures.length === 0,
      windowSeconds: this.windowSeconds,
      failureCount: failures.length,
      failureKinds,
    };
    const lastFailureAt = failures[0]?.event.occurredAt;
    if (lastFailureAt) snapshot.lastFailureAt = lastFailureAt;
    return snapshot;
  }
}

export function createHealthyCallHealthProbe(
  windowSeconds = DEFAULT_CALL_ALERT_WINDOW_SECONDS,
): CallHealthProbe {
  return {
    async snapshot() {
      return {
        ok: true,
        windowSeconds,
        failureCount: 0,
        failureKinds: [],
      };
    },
  };
}

export function callAlertWindowSecondsFromEnv(
  value: string | undefined,
): number {
  if (!value?.trim()) return DEFAULT_CALL_ALERT_WINDOW_SECONDS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 86_400) {
    throw new Error(
      "CALL_ALERT_WINDOW_SECONDS must be an integer between 300 and 86400.",
    );
  }
  return parsed;
}

export function longTurnAlertMsFromEnv(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_LONG_TURN_ALERT_MS;
  return normalizeLongTurnThresholdMs(Number(value), "CALL_ALERT_LONG_TURN_MS");
}

export function repeatedPromptAlertCountFromEnv(value: string | undefined): number {
  if (!value?.trim()) return DEFAULT_REPEATED_PROMPT_ALERT_COUNT;
  return normalizeRepeatedPromptThreshold(Number(value), "CALL_ALERT_REPEATED_PROMPT_COUNT");
}

function normalizeWindowSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CALL_ALERT_WINDOW_SECONDS;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Call health window must be a positive integer.");
  }
  return value;
}

function normalizeLongTurnThresholdMs(
  value: number | undefined,
  name = "Long-turn alert threshold",
): number {
  if (value === undefined) return DEFAULT_LONG_TURN_ALERT_MS;
  if (!Number.isInteger(value) || value < 500 || value > 60_000) {
    throw new Error(`${name} must be an integer between 500 and 60000.`);
  }
  return value;
}

function normalizeRepeatedPromptThreshold(
  value: number | undefined,
  name = "Repeated-prompt alert threshold",
): number {
  if (value === undefined) return DEFAULT_REPEATED_PROMPT_ALERT_COUNT;
  if (!Number.isInteger(value) || value < 2 || value > 10) {
    throw new Error(`${name} must be an integer between 2 and 10.`);
  }
  return value;
}

function classifyFailureKinds(
  event: CallEvent,
  longTurnThresholdMs: number,
  repeatedPromptThreshold: number,
): CallFailureKind[] {
  const kinds: CallFailureKind[] = [];
  if (event.eventType === "TOOL_FAILED") kinds.push("tool_failure");
  if (
    event.eventType === "PROVIDER_COMMANDS_EXECUTED" &&
    event.payload.allSucceeded === false
  ) {
    kinds.push("provider_command_failure");
  }
  if (
    event.eventType === "HANDOFF_OUTCOME_RECORDED" &&
    event.payload.terminal === true &&
    event.payload.succeeded === false &&
    event.payload.outcome !== "canceled"
  ) {
    kinds.push("handoff_failure");
  }
  if (
    event.eventType === "CALL_ENDED" &&
    isAbnormalCallEndReason(event.payload.reason)
  ) {
    kinds.push("abnormal_call_end");
  }
  if (turnDurationMs(event.payload.turnDurationMs) >= longTurnThresholdMs) {
    kinds.push("long_turn_latency");
  }
  if (
    event.eventType === "PROMPT_REPEATED" &&
    positiveInteger(event.payload.repeatCount) >= repeatedPromptThreshold
  ) {
    kinds.push("repeated_prompt");
  }
  return kinds;
}

function repeatedDecisionFailures(
  events: CallEvent[],
  threshold: number,
): Array<{ event: CallEvent; kind: CallFailureKind }> {
  const stateBySession = new Map<string, { signature: string; count: number }>();
  const failures: Array<{ event: CallEvent; kind: CallFailureKind }> = [];
  const transitions = events
    .filter(
      (event) => event.eventType === "STATE_TRANSITIONED" || event.eventType === "ESCALATION_TRIGGERED",
    )
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));

  for (const event of transitions) {
    const signature = promptDecisionSignature(event);
    if (!signature) continue;
    const sessionKey = `${event.tenantId}:${event.sessionId}`;
    const previous = stateBySession.get(sessionKey);
    const count = previous?.signature === signature ? previous.count + 1 : 1;
    stateBySession.set(sessionKey, { signature, count });
    if (count === threshold) failures.push({ event, kind: "repeated_prompt" });
  }
  return failures;
}

function promptDecisionSignature(event: CallEvent): string | undefined {
  const step = event.payload.step;
  const targetState = event.payload.to;
  const missingTargetFacts = event.payload.missingTargetFacts;
  if (typeof step !== "string" || typeof targetState !== "string" || !Array.isArray(missingTargetFacts)) {
    return undefined;
  }
  const safeFacts = missingTargetFacts.filter((value): value is string => typeof value === "string").sort();
  if (safeFacts.length === 0) return undefined;
  return JSON.stringify([targetState, step, safeFacts]);
}

function turnDurationMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

function isAbnormalCallEndReason(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  return [
    "failed",
    "busy",
    "no_answer",
    "timeout",
    "timed_out",
    "rejected",
    "call_rejected",
    "network_error",
    "service_unavailable",
  ].some((reason) => normalized === reason || normalized.includes(`_${reason}`));
}
