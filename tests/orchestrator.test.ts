import assert from "node:assert/strict";
import test from "node:test";
import { createCallSession, funeralHomeRules, handleTranscriptTurn } from "../src/index.js";

test("first-call funeral home transcript escalates to a human", () => {
  let counter = 0;
  const session = createCallSession({
    callId: "call_1",
    sessionId: "session_1",
    tenantId: "tenant_1",
    now: "2026-06-03T00:00:00.000Z",
  });

  const output = handleTranscriptTurn({
    eventIdFactory: () => `event_${++counter}`,
    correlationId: "corr_1",
    transcript: "My father passed away and we need a pickup.",
    session,
    rules: funeralHomeRules,
  });

  assert.equal(output.session.intent, "first_call_intake");
  assert.equal(output.session.currentState, "ESCALATE");
  assert.equal(output.events.at(-1)?.eventType, "ESCALATION_TRIGGERED");
});

