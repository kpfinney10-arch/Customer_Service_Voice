import assert from "node:assert/strict";
import test from "node:test";
import {
  createCallSession,
  createFakeFuneralHomeAdapters,
  createFuneralHomeToolDefinitions,
  decideFirstCallNextStep,
  executeFirstCallTools,
  ToolRegistry,
  updateSession,
} from "../src/index.js";

test("first-call tool execution creates CRM and dispatch audit events", async () => {
  let eventCount = 0;
  let toolCount = 0;
  const session = updateSession(
    createCallSession({
      callId: "call_123",
      sessionId: "session_123",
      tenantId: "tenant_123",
      now: "2026-06-04T00:00:00.000Z",
    }),
    {
      currentState: "ESCALATE",
      facts: {
        reasonForCall: "first_call_death_report",
        pickupAddress: "124 Oak Street",
      },
    },
  );
  const facts = {
    caller_name: "Sarah Miller",
    caller_phone: "555-010-2300",
    decedent_name: "Robert Miller",
    pickup_address: "124 Oak Street",
    urgency: "urgent" as const,
  };
  const decision = decideFirstCallNextStep(facts);
  const registry = new ToolRegistry();
  for (const definition of createFuneralHomeToolDefinitions(createFakeFuneralHomeAdapters())) {
    registry.registerAny(definition);
  }

  const output = await executeFirstCallTools({
    eventIdFactory: () => `event_${++eventCount}`,
    toolCallIdFactory: () => `tool_${++toolCount}`,
    correlationId: "corr_123",
    session,
    facts,
    decision,
    registry,
  });

  assert.deepEqual(output.results.map((result) => result.ok), [true, true]);
  assert.deepEqual(output.events.map((event) => event.eventType), [
    "TOOL_REQUESTED",
    "TOOL_EXECUTED",
    "TOOL_REQUESTED",
    "TOOL_EXECUTED",
  ]);
});

test("first-call tool execution emits failed event when dispatch adapter fails", async () => {
  let eventCount = 0;
  let toolCount = 0;
  const session = updateSession(
    createCallSession({
      callId: "call_456",
      sessionId: "session_456",
      tenantId: "tenant_456",
    }),
    { currentState: "ESCALATE", facts: { reasonForCall: "first_call_death_report" } },
  );
  const facts = {
    caller_name: "Sarah Miller",
    caller_phone: "555-010-2300",
    decedent_name: "Robert Miller",
    pickup_address: "124 Oak Street",
    urgency: "urgent" as const,
  };
  const registry = new ToolRegistry();
  for (const definition of createFuneralHomeToolDefinitions(
    createFakeFuneralHomeAdapters({ failDispatch: true }),
  )) {
    registry.registerAny(definition);
  }

  const output = await executeFirstCallTools({
    eventIdFactory: () => `event_${++eventCount}`,
    toolCallIdFactory: () => `tool_${++toolCount}`,
    correlationId: "corr_456",
    session,
    facts,
    decision: decideFirstCallNextStep(facts),
    registry,
  });

  assert.equal(output.results[1]?.ok, false);
  assert.equal(output.results[1]?.errorCode, "DISPATCH_UNAVAILABLE");
  assert.equal(output.events.at(-1)?.eventType, "TOOL_FAILED");
});
