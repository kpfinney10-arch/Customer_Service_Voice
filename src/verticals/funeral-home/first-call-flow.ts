import type { CallState, EscalationReason } from "../../domain/call-types.js";
import type { FirstCallFacts } from "./first-call-facts.js";
import {
  hasMinimumCrmIntakeFacts,
  hasMinimumDispatchRequestFacts,
  missingFirstCallTargetFacts,
} from "./first-call-facts.js";

export type FirstCallStep =
  | "acknowledge"
  | "collect_caller"
  | "collect_decedent"
  | "collect_location"
  | "create_crm_intake"
  | "create_dispatch_review_request"
  | "escalate";

export type FirstCallFlowDecision = {
  nextState: CallState;
  step: FirstCallStep;
  missingTargetFacts: string[];
  toolNames: string[];
  escalationReason?: EscalationReason;
};

export function decideFirstCallNextStep(facts: Partial<FirstCallFacts>): FirstCallFlowDecision {
  const missingTargetFacts = missingFirstCallTargetFacts(facts);

  if (!facts.caller_name || !facts.caller_phone) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_caller",
      missingTargetFacts,
      toolNames: [],
    };
  }

  if (!facts.decedent_name) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_decedent",
      missingTargetFacts,
      toolNames: [],
    };
  }

  if (!facts.pickup_address && !facts.facility_name) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_location",
      missingTargetFacts,
      toolNames: hasMinimumCrmIntakeFacts(facts) ? ["crm.create_intake_lead"] : [],
    };
  }

  const toolNames = ["crm.create_intake_lead"];
  if (hasMinimumDispatchRequestFacts(facts)) {
    toolNames.push("dispatch.create_removal_request");
  }

  return {
    nextState: "ESCALATE",
    step: "escalate",
    missingTargetFacts,
    toolNames,
    escalationReason: "urgent_death_report",
  };
}

export function firstCallPromptForStep(step: FirstCallStep): string {
  switch (step) {
    case "acknowledge":
      return "I am sorry. I will help get this to the right person.";
    case "collect_caller":
      return "May I have your name and the best phone number in case we are disconnected?";
    case "collect_decedent":
      return "May I have the name of the person who passed away?";
    case "collect_location":
      return "Where is your loved one located right now?";
    case "create_crm_intake":
      return "I am saving this information for our team.";
    case "create_dispatch_review_request":
      return "I am sending this to dispatch for review.";
    case "escalate":
      return "I am going to connect you with a funeral home team member now.";
  }
}
