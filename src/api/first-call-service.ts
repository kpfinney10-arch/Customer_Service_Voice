import type { CallEvent } from "../events/call-event.js";
import { createCallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import type { StructuredFacts } from "../domain/call-types.js";
import { redactText } from "../security/redaction.js";
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
  listEvents: (input: ListFirstCallEventsInput) => Promise<ListFirstCallEventsOutput>;
};

export type StartFirstCallSessionInput = {
  tenantId: string;
  callId?: string;
  sessionId?: string;
  callerPhone?: string;
  correlationId?: string;
};

export type StartFirstCallSessionOutput = {
  session: CallSession;
  events: CallEvent[];
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

export type ListFirstCallEventsInput = {
  tenantId: string;
  sessionId: string;
};

export type ListFirstCallEventsOutput = {
  events: CallEvent[];
};

export type CreateFirstCallServiceOptions = {
  store: SessionStore;
  eventStore?: EventStore;
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
      const events = [
        createCallEvent({
          eventId: idFactory(),
          eventType: "CALL_STARTED",
          callId: session.callId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          correlationId: input.correlationId ?? idFactory(),
          payload: {
            currentState: session.currentState,
            callerPhoneProvided: Boolean(session.callerPhone),
          },
        }),
      ];
      await options.store.save(session);
      await options.eventStore?.append(events);
      return { session, events };
    },

    async handleTranscript(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }

      const redacted = redactText(input.transcript);
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
      const decisionEvents = [
        createCallEvent({
          eventId: idFactory(),
          eventType: "TRANSCRIPT_RECEIVED",
          callId: session.callId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          correlationId,
          redactionStatus: redacted.redacted ? "redacted" : "not_required",
          payload: {
            transcript: redacted.value,
            redactionCategories: redacted.categories,
          },
        }),
        createCallEvent({
          eventId: idFactory(),
          eventType: "INTENT_DETECTED",
          callId: session.callId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          correlationId,
          payload: {
            intent: extraction.intent,
            confidence: extraction.confidence,
            warnings: extraction.warnings,
          },
        }),
        createCallEvent({
          eventId: idFactory(),
          eventType: decision.escalationReason ? "ESCALATION_TRIGGERED" : "STATE_TRANSITIONED",
          callId: session.callId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          correlationId,
          payload: {
            from: existingSession.currentState,
            to: session.currentState,
            step: decision.step,
            missingTargetFacts: decision.missingTargetFacts,
            escalationReason: decision.escalationReason,
          },
        }),
      ];
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
      const events = [...decisionEvents, ...toolOutput.events];
      await options.eventStore?.append(events);

      return {
        session,
        extraction,
        decision,
        responseText: firstCallPromptForStep(decision.step),
        events,
        toolResults: toolOutput.results,
      };
    },

    async listEvents(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }
      return {
        events: (await options.eventStore?.listBySession(input.tenantId, input.sessionId)) ?? [],
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
