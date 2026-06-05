import type { CallEvent } from "../events/call-event.js";
import type { StructuredFacts } from "../domain/call-types.js";
import { createCallSession, updateSession } from "../session/call-session.js";
import type { CallSession } from "../session/call-session.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import type { ToolResult } from "../tools/tool-registry.js";
import { createFakeFuneralHomeAdapters } from "../verticals/funeral-home/fake-adapters.js";
import { deterministicFirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import type { FirstCallExtraction, FirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import { decideFirstCallNextStep, firstCallPromptForStep } from "../verticals/funeral-home/first-call-flow.js";
import type { FirstCallFlowDecision } from "../verticals/funeral-home/first-call-flow.js";
import type { FirstCallFacts } from "../verticals/funeral-home/first-call-facts.js";
import { executeFirstCallTools } from "../verticals/funeral-home/first-call-tools.js";
import { createFuneralHomeToolDefinitions } from "../verticals/funeral-home/tools.js";

export type IdFactory = () => string;

export type FirstCallService = {
  startSession: (input: StartFirstCallSessionInput) => Promise<StartFirstCallSessionOutput>;
  handleTranscript: (input: HandleFirstCallTranscriptInput) => Promise<HandleFirstCallTranscriptOutput>;
};

export type StartFirstCallSessionInput = {
  tenantId: string;
  callId?: string;
  sessionId?: string;
  callerPhone?: string;
};

export type StartFirstCallSessionOutput = {
  session: CallSession;
};

export type HandleFirstCallTranscriptInput = {
  tenantId: string;
  sessionId: string;
  transcript: string;
  correlationId?: string;
};

export type HandleFirstCallTranscriptOutput = {
  session: CallSession;
  extraction: FirstCallExtraction;
  decision: FirstCallFlowDecision;
  responseText: string;
  events: CallEvent[];
  toolResults: ToolResult<object>[];
};

export type CreateFirstCallServiceOptions = {
  store: SessionStore;
  idFactory?: IdFactory;
  extractor?: FirstCallExtractor;
  registry?: ToolRegistry;
};

export function createFirstCallService(options: CreateFirstCallServiceOptions): FirstCallService {
  const idFactory = options.idFactory ?? randomId;
  const extractor = options.extractor ?? deterministicFirstCallExtractor;
  const registry = options.registry ?? createDefaultRegistry();

  return {
    async startSession(input) {
      const createInput: Parameters<typeof createCallSession>[0] = {
        callId: input.callId ?? idFactory(),
        sessionId: input.sessionId ?? idFactory(),
        tenantId: input.tenantId,
      };
      if (input.callerPhone !== undefined) createInput.callerPhone = input.callerPhone;
      const session = createCallSession(createInput);
      await options.store.save(session);
      return { session };
    },

    async handleTranscript(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }

      const extraction = await extractor.extract(input.transcript);
      const facts: Partial<FirstCallFacts> = {
        ...existingSession.facts,
        ...extraction.facts,
      };
      const sessionFacts: StructuredFacts = {
        ...facts,
        reasonForCall: "first_call_death_report",
      };
      const decision = decideFirstCallNextStep(facts);
      const session = updateSession(existingSession, {
        currentState: decision.nextState,
        intent: extraction.intent,
        sentiment: extraction.sentiment,
        facts: sessionFacts,
        escalationScore: decision.escalationReason ? 1 : existingSession.escalationScore,
      });
      const correlationId = input.correlationId ?? idFactory();
      const toolOutput = await executeFirstCallTools({
        eventIdFactory: idFactory,
        toolCallIdFactory: idFactory,
        correlationId,
        session,
        facts,
        decision,
        registry,
      });
      await options.store.save(session);

      return {
        session,
        extraction,
        decision,
        responseText: firstCallPromptForStep(decision.step),
        events: toolOutput.events,
        toolResults: toolOutput.results,
      };
    },
  };
}

export class FirstCallServiceError extends Error {
  constructor(
    public readonly code: "SESSION_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "FirstCallServiceError";
  }
}

function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const adapters = createFakeFuneralHomeAdapters();
  for (const definition of createFuneralHomeToolDefinitions(adapters)) {
    registry.registerAny(definition);
  }
  return registry;
}

function randomId(): string {
  return crypto.randomUUID();
}
