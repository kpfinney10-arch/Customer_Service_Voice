import type { CallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";

export const DEFAULT_CALL_ALERT_WINDOW_SECONDS = 1_800;
const MAX_FAILURE_EVENTS = 100;
const MONITORED_EVENT_TYPES = [
  "TOOL_FAILED",
  "PROVIDER_COMMANDS_EXECUTED",
  "CALL_ENDED",
] as const;

export type CallFailureKind =
  | "tool_failure"
  | "provider_command_failure"
  | "abnormal_call_end";

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
  private readonly now: () => Date;

  constructor(
    private readonly eventStore: EventStore,
    options: { windowSeconds?: number; now?: () => Date } = {},
  ) {
    this.windowSeconds = normalizeWindowSeconds(options.windowSeconds);
    this.now = options.now ?? (() => new Date());
  }

  async snapshot(): Promise<CallHealthSnapshot> {
    const since = new Date(
      this.now().getTime() - this.windowSeconds * 1_000,
    ).toISOString();
    const candidates = await this.eventStore.listRecentByTypesSince(
      [...MONITORED_EVENT_TYPES],
      since,
      MAX_FAILURE_EVENTS,
    );
    const failures = candidates
      .map((event) => ({ event, kind: failureKind(event) }))
      .filter(
        (item): item is { event: CallEvent; kind: CallFailureKind } =>
          item.kind !== undefined,
      );
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

function normalizeWindowSeconds(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CALL_ALERT_WINDOW_SECONDS;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Call health window must be a positive integer.");
  }
  return value;
}

function failureKind(event: CallEvent): CallFailureKind | undefined {
  if (event.eventType === "TOOL_FAILED") return "tool_failure";
  if (
    event.eventType === "PROVIDER_COMMANDS_EXECUTED" &&
    event.payload.allSucceeded === false
  ) {
    return "provider_command_failure";
  }
  if (
    event.eventType === "CALL_ENDED" &&
    isAbnormalCallEndReason(event.payload.reason)
  ) {
    return "abnormal_call_end";
  }
  return undefined;
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
