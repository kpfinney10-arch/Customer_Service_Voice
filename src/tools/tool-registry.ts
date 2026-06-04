import type { CallState, StructuredFacts } from "../domain/call-types.js";
import type { CallSession } from "../session/call-session.js";

export type ToolRequest<TArgs extends object = Record<string, unknown>> = {
  toolCallId: string;
  toolName: string;
  tenantId: string;
  callId: string;
  sessionId: string;
  requestedBy: "orchestrator" | "state_handler" | "llm";
  args: TArgs;
  idempotencyKey: string;
};

export type ToolResult<TResult extends object = Record<string, unknown>> = {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  result?: TResult;
  errorCode?: string;
  callerSafeSummary?: string;
};

export type ToolDefinition<TArgs extends object, TResult extends object> = {
  name: string;
  allowedStates: CallState[];
  requiredFacts: string[];
  execute: (request: ToolRequest<TArgs>, session: CallSession) => Promise<ToolResult<TResult>>;
};

type RegisteredToolDefinition = {
  name: string;
  allowedStates: CallState[];
  requiredFacts: string[];
  execute: (request: ToolRequest<object>, session: CallSession) => Promise<ToolResult<object>>;
};

export class ToolRegistry {
  private tools = new Map<string, RegisteredToolDefinition>();

  register<TArgs extends object, TResult extends object>(
    definition: ToolDefinition<TArgs, TResult>,
  ): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool already registered: ${definition.name}`);
    }
    this.tools.set(
      definition.name,
      definition as unknown as RegisteredToolDefinition,
    );
  }

  registerAny(definition: unknown): void {
    this.register(definition as ToolDefinition<object, object>);
  }

  get(name: string): RegisteredToolDefinition | undefined {
    return this.tools.get(name);
  }

  async execute(request: ToolRequest<object>, session: CallSession): Promise<ToolResult<object>> {
    const tool = this.get(request.toolName);
    if (!tool) {
      return failure(request, "TOOL_NOT_FOUND", "The requested action is not available.");
    }
    if (!tool.allowedStates.includes(session.currentState)) {
      return failure(request, "TOOL_NOT_ALLOWED_IN_STATE", "That action is not available at this point in the call.");
    }
    const missingFacts = missingRequiredFacts(tool.requiredFacts, session.facts);
    if (missingFacts.length > 0) {
      return failure(request, "TOOL_MISSING_FACTS", "More information is needed before that action can be completed.");
    }
    return tool.execute(request, session);
  }
}

function missingRequiredFacts(requiredFacts: string[], facts: StructuredFacts): string[] {
  return requiredFacts.filter((key) => facts[key] == null);
}

function failure(
  request: ToolRequest<object>,
  errorCode: string,
  callerSafeSummary: string,
): ToolResult<object> {
  return {
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    ok: false,
    errorCode,
    callerSafeSummary,
  };
}
