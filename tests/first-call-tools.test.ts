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

test("first-call tool execution emits skipped event when tenant disables a tool", async () => {
  let eventCount = 0;
  let toolCount = 0;
  const session = updateSession(
    createCallSession({
      callId: "call_789",
      sessionId: "session_789",
      tenantId: "tenant_789",
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
  for (const definition of createFuneralHomeToolDefinitions(createFakeFuneralHomeAdapters())) {
    registry.registerAny(definition);
  }

  const output = await executeFirstCallTools({
    eventIdFactory: () => `event_${++eventCount}`,
    toolCallIdFactory: () => `tool_${++toolCount}`,
    correlationId: "corr_789",
    session,
    facts,
    decision: decideFirstCallNextStep(facts),
    registry,
    enabledToolNames: new Set(["crm.create_intake_lead"]),
  });

  assert.deepEqual(output.results.map((result) => result.toolName), ["crm.create_intake_lead"]);
  assert.deepEqual(output.events.map((event) => event.eventType), [
    "TOOL_REQUESTED",
    "TOOL_EXECUTED",
    "TOOL_SKIPPED",
  ]);
  assert.equal(output.events.at(-1)?.payload.toolName, "dispatch.create_removal_request");
  assert.equal(output.events.at(-1)?.payload.reason, "tenant_feature_disabled");
});

test("first-call tool execution skips already completed tools", async () => {
  let eventCount = 0;
  let toolCount = 0;
  const session = updateSession(
    createCallSession({
      callId: "call_completed_tool",
      sessionId: "session_completed_tool",
      tenantId: "tenant_completed_tool",
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
  for (const definition of createFuneralHomeToolDefinitions(createFakeFuneralHomeAdapters())) {
    registry.registerAny(definition);
  }

  const output = await executeFirstCallTools({
    eventIdFactory: () => `event_${++eventCount}`,
    toolCallIdFactory: () => `tool_${++toolCount}`,
    correlationId: "corr_completed_tool",
    session,
    facts,
    decision: decideFirstCallNextStep(facts),
    registry,
    completedToolNames: new Set(["crm.create_intake_lead"]),
  });

  assert.deepEqual(output.results.map((result) => result.toolName), ["dispatch.create_removal_request"]);
  assert.equal(output.events[0]?.eventType, "TOOL_SKIPPED");
  assert.equal(output.events[0]?.payload.toolName, "crm.create_intake_lead");
  assert.equal(output.events[0]?.payload.reason, "already_completed");
  assert.equal(output.events[1]?.eventType, "TOOL_REQUESTED");
  assert.equal(output.events[2]?.eventType, "TOOL_EXECUTED");
});
