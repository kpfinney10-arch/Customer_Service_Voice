import assert from "node:assert/strict";
import { test } from "node:test";
import { createCallEvent } from "../src/events/call-event.js";
import { InMemoryEventStore } from "../src/events/in-memory-event-store.js";
import {
  callAlertWindowSecondsFromEnv,
  DEFAULT_LONG_TURN_ALERT_MS,
  DEFAULT_REPEATED_PROMPT_ALERT_COUNT,
  DEFAULT_CALL_ALERT_WINDOW_SECONDS,
  EventStoreCallHealthProbe,
  longTurnAlertMsFromEnv,
  repeatedPromptAlertCountFromEnv,
} from "../src/observability/call-health.js";

const now = () => new Date("2026-08-01T15:00:00.000Z");

test("call health probe reports healthy when there are no recent failures", async () => {
  const probe = new EventStoreCallHealthProbe(new InMemoryEventStore(), {
    windowSeconds: 1_800,
    now,
  });

  assert.deepEqual(await probe.snapshot(), {
    ok: true,
    windowSeconds: 1_800,
    failureCount: 0,
    failureKinds: [],
  });
});

test("call health probe classifies recent persisted failures", async () => {
  const store = new InMemoryEventStore();
  store.append([
    event("tool-failed", "TOOL_FAILED", { toolName: "crm.create_intake_lead" }),
    event("provider-failed", "PROVIDER_COMMANDS_EXECUTED", { allSucceeded: false }),
    event("handoff-failed", "HANDOFF_OUTCOME_RECORDED", {
      phase: "dial",
      outcome: "no_answer",
      succeeded: false,
      terminal: true,
    }),
    event("screening-rejected", "HANDOFF_OUTCOME_RECORDED", {
      phase: "screening",
      outcome: "rejected",
      succeeded: false,
      terminal: false,
    }),
    event("call-failed", "CALL_ENDED", { reason: "provider_failed" }),
    event("provider-succeeded", "PROVIDER_COMMANDS_EXECUTED", { allSucceeded: true }),
  ]);
  const probe = new EventStoreCallHealthProbe(store, { windowSeconds: 1_800, now });

  assert.deepEqual(await probe.snapshot(), {
    ok: false,
    windowSeconds: 1_800,
    failureCount: 4,
    failureKinds: [
      "abnormal_call_end",
      "handoff_failure",
      "provider_command_failure",
      "tool_failure",
    ],
    lastFailureAt: "2026-08-01T14:55:00.000Z",
  });
});

test("call health probe ignores normal disconnects and expired failures", async () => {
  const store = new InMemoryEventStore();
  store.append([
    event("completed", "CALL_ENDED", { reason: "completed" }),
    event("canceled", "CALL_ENDED", { reason: "canceled" }),
    event("handoff-canceled", "HANDOFF_OUTCOME_RECORDED", {
      phase: "dial",
      outcome: "canceled",
      succeeded: false,
      terminal: true,
    }),
    event("expired", "TOOL_FAILED", {}, "2026-08-01T14:29:59.000Z"),
  ]);
  const probe = new EventStoreCallHealthProbe(store, { windowSeconds: 1_800, now });

  assert.equal((await probe.snapshot()).ok, true);
});

test("call health probe classifies long turns and explicit prompt repetitions", async () => {
  const store = new InMemoryEventStore();
  store.append([
    event("slow-turn", "STATE_TRANSITIONED", {
      from: "IDENTIFY_INTENT",
      to: "IDENTIFY_INTENT",
      step: "collect_caller",
      missingTargetFacts: ["caller_phone"],
      turnDurationMs: 1_500,
    }),
    event("repeat-empty", "PROMPT_REPEATED", {
      reason: "empty_speech",
      repeatCount: 3,
    }),
  ]);
  const probe = new EventStoreCallHealthProbe(store, { windowSeconds: 1_800, now });

  assert.deepEqual(await probe.snapshot(), {
    ok: false,
    windowSeconds: 1_800,
    failureCount: 2,
    failureKinds: ["long_turn_latency", "repeated_prompt"],
    lastFailureAt: "2026-08-01T14:55:00.000Z",
  });
});

test("call health probe detects three consecutive no-progress prompt decisions", async () => {
  const store = new InMemoryEventStore();
  store.append([
    repeatedDecisionEvent("decision-1", "2026-08-01T14:53:00.000Z"),
    repeatedDecisionEvent("decision-2", "2026-08-01T14:54:00.000Z"),
    repeatedDecisionEvent("decision-3", "2026-08-01T14:55:00.000Z"),
  ]);
  const probe = new EventStoreCallHealthProbe(store, { windowSeconds: 1_800, now });

  assert.deepEqual(await probe.snapshot(), {
    ok: false,
    windowSeconds: 1_800,
    failureCount: 1,
    failureKinds: ["repeated_prompt"],
    lastFailureAt: "2026-08-01T14:55:00.000Z",
  });
});

test("call alert window parser defaults and validates configuration", () => {
  assert.equal(callAlertWindowSecondsFromEnv(undefined), DEFAULT_CALL_ALERT_WINDOW_SECONDS);
  assert.equal(callAlertWindowSecondsFromEnv("900"), 900);
  assert.throws(() => callAlertWindowSecondsFromEnv("not-a-number"), /CALL_ALERT_WINDOW_SECONDS/);
  assert.throws(() => callAlertWindowSecondsFromEnv("86401"), /CALL_ALERT_WINDOW_SECONDS/);
  assert.equal(longTurnAlertMsFromEnv(undefined), DEFAULT_LONG_TURN_ALERT_MS);
  assert.equal(longTurnAlertMsFromEnv("2500"), 2_500);
  assert.throws(() => longTurnAlertMsFromEnv("499"), /CALL_ALERT_LONG_TURN_MS/);
  assert.equal(repeatedPromptAlertCountFromEnv(undefined), DEFAULT_REPEATED_PROMPT_ALERT_COUNT);
  assert.equal(repeatedPromptAlertCountFromEnv("4"), 4);
  assert.throws(
    () => repeatedPromptAlertCountFromEnv("11"),
    /CALL_ALERT_REPEATED_PROMPT_COUNT/,
  );
});

function repeatedDecisionEvent(eventId: string, occurredAt: string) {
  return createCallEvent({
    eventId,
    eventType: "STATE_TRANSITIONED",
    callId: "call-repeat-decision",
    sessionId: "session-repeat-decision",
    tenantId: "fh-demo",
    correlationId: `correlation-${eventId}`,
    occurredAt,
    payload: {
      from: "IDENTIFY_INTENT",
      to: "IDENTIFY_INTENT",
      step: "collect_caller",
      missingTargetFacts: ["caller_phone"],
      turnDurationMs: 10,
    },
  });
}

function event(
  eventId: string,
  eventType: Parameters<typeof createCallEvent>[0]["eventType"],
  payload: Record<string, unknown>,
  occurredAt = "2026-08-01T14:55:00.000Z",
) {
  return createCallEvent({
    eventId,
    eventType,
    callId: `call-${eventId}`,
    sessionId: `session-${eventId}`,
    tenantId: "fh-demo",
    correlationId: `correlation-${eventId}`,
    occurredAt,
    payload,
  });
}
