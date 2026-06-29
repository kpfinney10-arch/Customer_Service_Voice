import type { EscalationReason } from "../../domain/call-types.js";
import type { CallSession } from "../../session/call-session.js";
import type { ToolResult } from "../../tools/tool-registry.js";
import type { FirstCallFacts, FirstCallUrgency } from "./first-call-facts.js";
import type { FirstCallFlowDecision } from "./first-call-flow.js";

export type FirstCallHandoffSummary = {
  handoffType: "human_escalation";
  priority: "routine" | "urgent" | "emergency";
  reason: EscalationReason;
  callId: string;
  sessionId: string;
  tenantId: string;
  caller: {
    name?: string;
    phone?: string;
    relationshipToDecedent?: string;
    emotionalState?: string;
  };
  decedent: {
    name?: string;
    existingCaseReference?: string;
  };
  location: {
    placeOfDeathType?: string;
    pickupAddress?: string;
    facilityName?: string;
    pickupContactName?: string;
    pickupContactPhone?: string;
  };
  requestedFuneralHome?: string;
  missingFacts: string[];
  completedToolNames: string[];
  failedToolNames: string[];
  recommendedActions: string[];
};

export function createFirstCallHandoffSummary(input: {
  session: CallSession;
  facts: Partial<FirstCallFacts>;
  decision: FirstCallFlowDecision;
  toolResults: ToolResult<object>[];
}): FirstCallHandoffSummary | undefined {
  if (!input.decision.escalationReason) return undefined;

  const summary: FirstCallHandoffSummary = {
    handoffType: "human_escalation",
    priority: normalizePriority(input.facts.urgency),
    reason: input.decision.escalationReason,
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    tenantId: input.session.tenantId,
    caller: {},
    decedent: {},
    location: {},
    missingFacts: input.decision.missingTargetFacts,
    completedToolNames: input.toolResults.filter((result) => result.ok).map((result) => result.toolName),
    failedToolNames: input.toolResults.filter((result) => !result.ok).map((result) => result.toolName),
    recommendedActions: recommendedActions(input.decision.missingTargetFacts, input.toolResults),
  };

  addIfPresent(summary.caller, "name", input.facts.caller_name);
  addIfPresent(summary.caller, "phone", input.facts.caller_phone);
  addIfPresent(summary.caller, "relationshipToDecedent", input.facts.caller_relationship_to_decedent);
  addIfPresent(summary.caller, "emotionalState", input.facts.caller_emotional_state);
  addIfPresent(summary.decedent, "name", input.facts.decedent_name);
  addIfPresent(summary.decedent, "existingCaseReference", input.facts.crm_existing_case_reference);
  addIfPresent(summary.location, "placeOfDeathType", input.facts.place_of_death_type);
  addIfPresent(summary.location, "pickupAddress", input.facts.pickup_address);
  addIfPresent(summary.location, "facilityName", input.facts.facility_name);
  addIfPresent(summary.location, "pickupContactName", input.facts.pickup_contact_name);
  addIfPresent(summary.location, "pickupContactPhone", input.facts.pickup_contact_phone);
  addIfPresent(summary, "requestedFuneralHome", input.facts.requested_funeral_home);

  return summary;
}

function normalizePriority(urgency: FirstCallUrgency | undefined): FirstCallHandoffSummary["priority"] {
  if (urgency === "emergency") return "emergency";
  if (urgency === "routine") return "routine";
  return "urgent";
}

function recommendedActions(missingFacts: string[], toolResults: ToolResult<object>[]): string[] {
  const actions = ["Connect caller to an on-call funeral home team member."];
  if (missingFacts.length > 0) {
    actions.push("Confirm missing first-call details before dispatch finalization.");
  }
  if (toolResults.some((result) => !result.ok)) {
    actions.push("Review failed tool handoffs and complete any required CRM or dispatch work manually.");
  }
  return actions;
}

function addIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}
