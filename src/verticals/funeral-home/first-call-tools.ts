import { createCallEvent } from "../../events/call-event.js";
import type { CallEvent } from "../../events/call-event.js";
import type { CallSession } from "../../session/call-session.js";
import type { ToolRegistry, ToolRequest, ToolResult } from "../../tools/tool-registry.js";
import type { FirstCallFacts } from "./first-call-facts.js";
import type { FirstCallFlowDecision } from "./first-call-flow.js";
import type { CreateCrmIntakeArgs, CreateDispatchRequestArgs } from "./tools.js";

export type FirstCallToolExecutionInput = {
  eventIdFactory: () => string;
  toolCallIdFactory: () => string;
  correlationId: string;
  session: CallSession;
  facts: Partial<FirstCallFacts>;
  decision: FirstCallFlowDecision;
  registry: ToolRegistry;
  enabledToolNames?: Set<string>;
  completedToolNames?: Set<string>;
};

export type FirstCallToolExecutionOutput = {
  events: CallEvent[];
  results: ToolResult<object>[];
};

export async function executeFirstCallTools(
  input: FirstCallToolExecutionInput,
): Promise<FirstCallToolExecutionOutput> {
  const events: CallEvent[] = [];
  const results: ToolResult<object>[] = [];

  for (const toolName of input.decision.toolNames) {
    if (input.completedToolNames?.has(toolName)) {
      events.push(createToolSkippedEvent(input, toolName, "already_completed"));
      continue;
    }
    if (input.enabledToolNames && !input.enabledToolNames.has(toolName)) {
      events.push(createToolSkippedEvent(input, toolName, "tenant_feature_disabled"));
      continue;
    }

    const request = createToolRequestForFirstCall(input, toolName);
    if (!request) continue;

    events.push(createToolRequestedEvent(input, request));
    const result = await input.registry.execute(request, input.session);
    results.push(result);
    events.push(createToolResultEvent(input, result));
  }

  return { events, results };
}

function createToolSkippedEvent(
  input: FirstCallToolExecutionInput,
  toolName: string,
  reason: "already_completed" | "tenant_feature_disabled",
): CallEvent {
  return createCallEvent({
    eventId: input.eventIdFactory(),
    eventType: "TOOL_SKIPPED",
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    tenantId: input.session.tenantId,
    correlationId: input.correlationId,
    payload: {
      toolName,
      reason,
    },
  });
}

function createToolRequestForFirstCall(
  input: FirstCallToolExecutionInput,
  toolName: string,
): ToolRequest<object> | null {
  const base = {
    toolCallId: input.toolCallIdFactory(),
    toolName,
    tenantId: input.session.tenantId,
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    requestedBy: "orchestrator" as const,
    idempotencyKey: `${input.session.tenantId}:${input.session.callId}:${toolName}`,
  };

  if (toolName === "crm.create_intake_lead") {
    const args: CreateCrmIntakeArgs = {
      reasonForCall: input.facts.reasonForCall ?? "first_call_death_report",
      urgency: normalizeCrmUrgency(input.facts.urgency),
    };
    addIfPresent(args, "callerName", input.facts.caller_name);
    addIfPresent(args, "callerPhone", input.facts.caller_phone);
    addIfPresent(args, "relationshipToDecedent", input.facts.caller_relationship_to_decedent);
    addIfPresent(args, "decedentName", input.facts.decedent_name);
    addIfPresent(args, "existingCaseReference", input.facts.crm_existing_case_reference);
    addIfPresent(args, "placeOfDeathType", input.facts.place_of_death_type);
    addIfPresent(args, "preferredCallbackNumber", input.facts.preferred_callback_number);
    return { ...base, args };
  }

  if (toolName === "dispatch.create_removal_request") {
    const args: CreateDispatchRequestArgs = {};
    addIfPresent(args, "decedentName", input.facts.decedent_name);
    addIfPresent(args, "pickupAddress", input.facts.pickup_address);
    addIfPresent(args, "facilityName", input.facts.facility_name);
    addIfPresent(args, "pickupContactName", input.facts.pickup_contact_name);
    addIfPresent(args, "pickupContactPhone", input.facts.pickup_contact_phone);
    addIfPresent(args, "dropoffPreference", input.facts.dropoff_preference);
    addIfPresent(args, "notes", input.facts.special_handling_notes);
    return { ...base, args };
  }

  return null;
}

function addIfPresent<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function normalizeCrmUrgency(urgency: FirstCallFacts["urgency"]): CreateCrmIntakeArgs["urgency"] {
  if (urgency === "emergency") return "emergency";
  if (urgency === "routine") return "routine";
  return "urgent";
}

function createToolRequestedEvent(
  input: FirstCallToolExecutionInput,
  request: ToolRequest<object>,
): CallEvent {
  return createCallEvent({
    eventId: input.eventIdFactory(),
    eventType: "TOOL_REQUESTED",
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    tenantId: input.session.tenantId,
    correlationId: input.correlationId,
    payload: {
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      requestedBy: request.requestedBy,
      idempotencyKey: request.idempotencyKey,
    },
  });
}

function createToolResultEvent(
  input: FirstCallToolExecutionInput,
  result: ToolResult<object>,
): CallEvent {
  return createCallEvent({
    eventId: input.eventIdFactory(),
    eventType: result.ok ? "TOOL_EXECUTED" : "TOOL_FAILED",
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    tenantId: input.session.tenantId,
    correlationId: input.correlationId,
    payload: {
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      ok: result.ok,
      errorCode: result.errorCode,
      callerSafeSummary: result.callerSafeSummary,
    },
  });
}
