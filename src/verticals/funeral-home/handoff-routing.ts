import type { TenantConfig } from "../../tenants/tenant-config.js";
import type { FirstCallHandoffSummary } from "./first-call-handoff.js";

export type HandoffRoutingDecision = {
  destinationType: "on_call_phone" | "dispatch_desk_phone" | "dispatch_queue" | "manual_review";
  destination: string;
  queue: string;
  priority: FirstCallHandoffSummary["priority"];
  reason: string;
};

export function routeFirstCallHandoff(input: {
  handoff: FirstCallHandoffSummary;
  tenantConfig?: TenantConfig | undefined;
}): HandoffRoutingDecision {
  const config = input.tenantConfig;
  if (!config) {
    return {
      destinationType: "manual_review",
      destination: "unconfigured-tenant",
      queue: "manual-review",
      priority: input.handoff.priority,
      reason: "No tenant handoff configuration was found.",
    };
  }

  if ((input.handoff.priority === "urgent" || input.handoff.priority === "emergency") && config.handoff.onCallPhone) {
    return {
      destinationType: "on_call_phone",
      destination: config.handoff.onCallPhone,
      queue: config.handoff.afterHoursQueue ?? config.handoff.defaultQueue,
      priority: input.handoff.priority,
      reason: "Urgent first-call death reports route to the configured on-call phone.",
    };
  }

  if (config.handoff.dispatchDeskPhone) {
    return {
      destinationType: "dispatch_desk_phone",
      destination: config.handoff.dispatchDeskPhone,
      queue: config.handoff.defaultQueue,
      priority: input.handoff.priority,
      reason: "Routine first-call handoffs route to the configured dispatch desk phone.",
    };
  }

  return {
    destinationType: "dispatch_queue",
    destination: config.handoff.defaultQueue,
    queue: config.handoff.defaultQueue,
    priority: input.handoff.priority,
    reason: "First-call handoff is queued for dispatch review.",
  };
}
