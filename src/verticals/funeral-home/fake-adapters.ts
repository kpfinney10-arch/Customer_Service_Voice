import type { ToolResult } from "../../tools/tool-registry.js";
import type {
  CreateCrmIntakeArgs,
  CreateCrmIntakeResult,
  CreateDispatchRequestArgs,
  CreateDispatchRequestResult,
  FuneralHomeIntegrationAdapters,
} from "./tools.js";

export type FakeAdapterOptions = {
  failCrm?: boolean;
  failDispatch?: boolean;
};

export function createFakeFuneralHomeAdapters(
  options: FakeAdapterOptions = {},
): FuneralHomeIntegrationAdapters {
  return {
    async createCrmIntake(request): Promise<ToolResult<CreateCrmIntakeResult>> {
      const args = request.args as CreateCrmIntakeArgs;
      if (options.failCrm) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          ok: false,
          errorCode: "CRM_UNAVAILABLE",
          callerSafeSummary: "I could not save the intake record automatically.",
        };
      }
      const result: CreateCrmIntakeResult = {
        crmLeadId: `fake-crm-${request.callId}`,
      };
      if (args.decedentName) result.caseId = `fake-case-${request.callId}`;
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        ok: true,
        result,
        callerSafeSummary: "The intake record was created for staff review.",
      };
    },

    async createDispatchRequest(request): Promise<ToolResult<CreateDispatchRequestResult>> {
      const args = request.args as CreateDispatchRequestArgs;
      if (options.failDispatch) {
        return {
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          ok: false,
          errorCode: "DISPATCH_UNAVAILABLE",
          callerSafeSummary: "I could not create the dispatch request automatically.",
        };
      }
      return {
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        ok: true,
        result: {
          dispatchRequestId: `fake-dispatch-${args.pickupAddress ?? args.facilityName ?? request.callId}`,
          status: "pending_dispatch_review",
        },
        callerSafeSummary: "The removal request was sent to dispatch for review.",
      };
    },
  };
}
