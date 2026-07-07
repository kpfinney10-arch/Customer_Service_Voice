import type { CallState, EscalationReason } from "../../domain/call-types.js";
import type { FirstCallFacts } from "./first-call-facts.js";
import {
  hasMinimumCrmIntakeFacts,
  hasMinimumDispatchRequestFacts,
  missingFirstCallTargetFacts,
  requiresMedicalExaminerCaseReference,
} from "./first-call-facts.js";

export type FirstCallStep =
  | "acknowledge"
  | "collect_caller"
  | "collect_decedent"
  | "collect_case_reference"
  | "collect_location"
  | "create_crm_intake"
  | "create_dispatch_review_request"
  | "routine_follow_up"
  | "escalate";

export type FirstCallFlowDecision = {
  nextState: CallState;
  step: FirstCallStep;
  missingTargetFacts: string[];
  toolNames: string[];
  escalationReason?: EscalationReason;
};

export function decideFirstCallNextStep(facts: Partial<FirstCallFacts>): FirstCallFlowDecision {
  const missingTargetFacts = missingFirstCallFlowFacts(facts);

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

  if (requiresMedicalExaminerCaseReference(facts) && !facts.crm_existing_case_reference) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_case_reference",
      missingTargetFacts,
      toolNames: [],
    };
  }

  if (!facts.pickup_address) {
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

function missingFirstCallFlowFacts(facts: Partial<FirstCallFacts>): string[] {
  const missingFacts: string[] = [...missingFirstCallTargetFacts(facts)];
  if (requiresMedicalExaminerCaseReference(facts) && !facts.crm_existing_case_reference) {
    missingFacts.push("crm_existing_case_reference");
  }
  return missingFacts;
}

export function decideRoutineInquiryNextStep(facts: Partial<FirstCallFacts>): FirstCallFlowDecision {
  const missingTargetFacts = ["caller_name", "caller_phone"].filter(
    (fact) => facts[fact as keyof FirstCallFacts] == null || facts[fact as keyof FirstCallFacts] === "",
  );

  if (!facts.caller_name || !facts.caller_phone) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_caller",
      missingTargetFacts,
      toolNames: [],
    };
  }

  return {
    nextState: "WRAPUP",
    step: "routine_follow_up",
    missingTargetFacts: [],
    toolNames: ["crm.create_intake_lead"],
  };
}

export function firstCallPromptForStep(step: FirstCallStep): string {
  switch (step) {
    case "acknowledge":
      return "I am assisting the funeral director with gathering call information.";
    case "collect_caller":
      return "May I have your name and the best phone number in case we are disconnected?";
    case "collect_decedent":
      return "May I have the name of the person who passed away?";
    case "collect_case_reference":
      return "May I have the medical examiner case number?";
    case "collect_location":
      return "Where is your loved one located right now?";
    case "create_crm_intake":
      return "I am saving this information for our team.";
    case "create_dispatch_review_request":
      return "I am sending this to dispatch for review.";
    case "routine_follow_up":
      return "I have your question and contact information. I will have the funeral home team follow up during office hours. Thank you for calling.";
    case "escalate":
      return "I am going to connect you with a funeral home team member now.";
  }
}

export function firstCallPromptForDecision(
  decision: FirstCallFlowDecision,
  facts: Partial<FirstCallFacts>,
): string {
  if (decision.step === "collect_caller") {
    if (facts.caller_name && !facts.caller_phone) {
      return "What is the best phone number in case we are disconnected?";
    }
    if (!facts.caller_name && facts.caller_phone) {
      return "I have the callback number. May I have your name?";
    }
  }
  return firstCallPromptForStep(decision.step);
}
