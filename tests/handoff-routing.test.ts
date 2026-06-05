import assert from "node:assert/strict";
import { test } from "node:test";
import type { TenantConfig } from "../src/tenants/tenant-config.js";
import type { FirstCallHandoffSummary } from "../src/verticals/funeral-home/first-call-handoff.js";
import { routeFirstCallHandoff } from "../src/verticals/funeral-home/handoff-routing.js";

test("urgent first-call handoffs route to tenant on-call phone", () => {
  const routing = routeFirstCallHandoff({
    handoff: handoffSummary({ priority: "urgent" }),
    tenantConfig: tenantConfig(),
  });

  assert.equal(routing.destinationType, "on_call_phone");
  assert.equal(routing.destination, "+15555550100");
  assert.equal(routing.queue, "first-call-after-hours");
  assert.equal(routing.priority, "urgent");
});

test("routine first-call handoffs route to dispatch desk when available", () => {
  const routing = routeFirstCallHandoff({
    handoff: handoffSummary({ priority: "routine" }),
    tenantConfig: tenantConfig(),
  });

  assert.equal(routing.destinationType, "dispatch_desk_phone");
  assert.equal(routing.destination, "+15555550101");
  assert.equal(routing.queue, "first-call-dispatch");
  assert.equal(routing.priority, "routine");
});

test("unconfigured tenant handoffs route to manual review", () => {
  const routing = routeFirstCallHandoff({
    handoff: handoffSummary({ priority: "emergency" }),
  });

  assert.equal(routing.destinationType, "manual_review");
  assert.equal(routing.destination, "unconfigured-tenant");
  assert.equal(routing.queue, "manual-review");
  assert.equal(routing.priority, "emergency");
});

function tenantConfig(): TenantConfig {
  return {
    tenantId: "fh-demo",
    displayName: "Demo Funeral Home",
    timezone: "America/Chicago",
    handoff: {
      defaultQueue: "first-call-dispatch",
      onCallPhone: "+15555550100",
      dispatchDeskPhone: "+15555550101",
      afterHoursQueue: "first-call-after-hours",
    },
    features: {
      crmHandoff: true,
      dispatchHandoff: true,
      voiceIntake: true,
    },
  };
}

function handoffSummary(input: { priority: FirstCallHandoffSummary["priority"] }): FirstCallHandoffSummary {
  return {
    handoffType: "human_escalation",
    priority: input.priority,
    reason: "urgent_death_report",
    callId: "call-1",
    sessionId: "session-1",
    tenantId: "fh-demo",
    caller: {},
    decedent: {},
    location: {},
    missingFacts: [],
    completedToolNames: [],
    failedToolNames: [],
    recommendedActions: [],
  };
}
