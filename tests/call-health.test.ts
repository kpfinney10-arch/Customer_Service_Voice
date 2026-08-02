import assert from "node:assert/strict";
import { test } from "node:test";
import { createCallEvent } from "../src/events/call-event.js";
import { InMemoryEventStore } from "../src/events/in-memory-event-store.js";
import {
  callAlertWindowSecondsFromEnv,
  DEFAULT_CALL_ALERT_WINDOW_SECONDS,
  EventStoreCallHealthProbe,
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

test("call alert window parser defaults and validates configuration", () => {
  assert.equal(callAlertWindowSecondsFromEnv(undefined), DEFAULT_CALL_ALERT_WINDOW_SECONDS);
  assert.equal(callAlertWindowSecondsFromEnv("900"), 900);
  assert.throws(() => callAlertWindowSecondsFromEnv("not-a-number"), /CALL_ALERT_WINDOW_SECONDS/);
  assert.throws(() => callAlertWindowSecondsFromEnv("86401"), /CALL_ALERT_WINDOW_SECONDS/);
});

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
