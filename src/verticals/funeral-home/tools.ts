import type { ToolDefinition, ToolRequest, ToolResult } from "../../tools/tool-registry.js";

export type CreateCrmIntakeArgs = {
  callerName?: string;
  callerPhone?: string;
  relationshipToDecedent?: string;
  decedentName?: string;
  existingCaseReference?: string;
  placeOfDeathType?: string;
  preferredCallbackNumber?: string;
  reasonForCall: string;
  urgency: "routine" | "urgent" | "emergency";
};

export type CreateCrmIntakeResult = {
  crmLeadId: string;
  caseId?: string;
};

export type CreateDispatchRequestArgs = {
  decedentName?: string;
  pickupAddress?: string;
  facilityName?: string;
  pickupContactName?: string;
  pickupContactPhone?: string;
  dropoffPreference?: string;
  notes?: string;
};

export type CreateDispatchRequestResult = {
  dispatchRequestId: string;
  status: "pending_dispatch_review";
};

export type FuneralHomeIntegrationAdapters = {
  createCrmIntake: (
    request: ToolRequest<CreateCrmIntakeArgs>,
  ) => Promise<ToolResult<CreateCrmIntakeResult>>;
  createDispatchRequest: (
    request: ToolRequest<CreateDispatchRequestArgs>,
  ) => Promise<ToolResult<CreateDispatchRequestResult>>;
};

export function createFuneralHomeToolDefinitions(
  adapters: FuneralHomeIntegrationAdapters,
): [
  ToolDefinition<CreateCrmIntakeArgs, CreateCrmIntakeResult>,
  ToolDefinition<CreateDispatchRequestArgs, CreateDispatchRequestResult>,
] {
  return [
    {
      name: "crm.create_intake_lead",
      allowedStates: ["RESOLVE_REQUEST", "ESCALATE"],
      requiredFacts: ["reasonForCall"],
      execute: (request) => adapters.createCrmIntake(request),
    },
    {
      name: "dispatch.create_removal_request",
      allowedStates: ["RESOLVE_REQUEST", "ESCALATE"],
      requiredFacts: [],
      execute: (request) => adapters.createDispatchRequest(request),
    },
  ];
}
