import type { CallEvent } from "../events/call-event.js";
import { createCallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import type { StructuredFacts } from "../domain/call-types.js";
import { createSessionReplaySnapshot } from "../debug/session-replay.js";
import type { SessionReplaySnapshot } from "../debug/session-replay.js";
import { redactText } from "../security/redaction.js";
import { createCallSession, updateSession } from "../session/call-session.js";
import type { CallSession } from "../session/call-session.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import type { TenantConfig, TenantConfigStore } from "../tenants/tenant-config.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import type { ToolResult } from "../tools/tool-registry.js";
import { createFakeFuneralHomeAdapters } from "../verticals/funeral-home/fake-adapters.js";
import { deterministicFirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import type { FirstCallExtraction, FirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import { createFirstCallHandoffSummary } from "../verticals/funeral-home/first-call-handoff.js";
import type { FirstCallHandoffSummary } from "../verticals/funeral-home/first-call-handoff.js";
import { decideFirstCallNextStep, firstCallPromptForStep } from "../verticals/funeral-home/first-call-flow.js";
import type { FirstCallFlowDecision } from "../verticals/funeral-home/first-call-flow.js";
import type { FirstCallFacts } from "../verticals/funeral-home/first-call-facts.js";
import { executeFirstCallTools } from "../verticals/funeral-home/first-call-tools.js";
import { routeFirstCallHandoff } from "../verticals/funeral-home/handoff-routing.js";
import type { HandoffRoutingDecision } from "../verticals/funeral-home/handoff-routing.js";
import { createFuneralHomeToolDefinitions } from "../verticals/funeral-home/tools.js";

export type IdFactory = () => string;

export type FirstCallService = {
  startSession: (input: StartFirstCallSessionInput) => Promise<StartFirstCallSessionOutput>;
  handleTranscript: (input: HandleFirstCallTranscriptInput) => Promise<HandleFirstCallTranscriptOutput>;
  interruptSession: (input: InterruptFirstCallSessionInput) => Promise<InterruptFirstCallSessionOutput>;
  endSession: (input: EndFirstCallSessionInput) => Promise<EndFirstCallSessionOutput>;
  listEvents: (input: ListFirstCallEventsInput) => Promise<ListFirstCallEventsOutput>;
  replaySession: (input: ReplayFirstCallSessionInput) => Promise<ReplayFirstCallSessionOutput>;
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
  handoff?: FirstCallHandoffSummary;
  handoffRouting?: HandoffRoutingDecision;
};

export type InterruptFirstCallSessionInput = {
  tenantId: string;
  sessionId: string;
  reason: string;
  interruptedOutput?: string;
  correlationId?: string;
};

export type InterruptFirstCallSessionOutput = {
  session: CallSession;
  events: CallEvent[];
  responseText: string;
};

export type EndFirstCallSessionInput = {
  tenantId: string;
  sessionId: string;
  reason?: string;
  correlationId?: string;
};

export type EndFirstCallSessionOutput = {
  session: CallSession;
  events: CallEvent[];
};

export type ListFirstCallEventsInput = {
  tenantId: string;
  sessionId: string;
};

export type ListFirstCallEventsOutput = {
  events: CallEvent[];
};

export type ReplayFirstCallSessionInput = {
  tenantId: string;
  sessionId: string;
};

export type ReplayFirstCallSessionOutput = {
  session: CallSession;
  events: CallEvent[];
  snapshot: SessionReplaySnapshot;
};

export type CreateFirstCallServiceOptions = {
  store: SessionStore;
  eventStore?: EventStore;
  idFactory?: IdFactory;
  extractor?: FirstCallExtractor;
  registry?: ToolRegistry;
  tenantConfigStore?: TenantConfigStore;
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
      const tenantConfig = await options.tenantConfigStore?.get(session.tenantId);
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
      const toolInput = {
        eventIdFactory: idFactory,
        toolCallIdFactory: idFactory,
        correlationId,
        session,
        facts,
        decision,
        registry,
      };
      addIfPresent(toolInput, "enabledToolNames", enabledToolNamesForTenant(tenantConfig));
      const toolOutput = await executeFirstCallTools(toolInput);
      await options.store.save(session);
      const events = [...decisionEvents, ...toolOutput.events];
      await options.eventStore?.append(events);
      const handoff = createFirstCallHandoffSummary({
        session,
        facts,
        decision,
        toolResults: toolOutput.results,
      });
      const handoffRouting = handoff ? routeFirstCallHandoff({ handoff, tenantConfig }) : undefined;

      const output: HandleFirstCallTranscriptOutput = {
        session,
        extraction,
        decision,
        responseText: firstCallPromptForStep(decision.step),
        events,
        toolResults: toolOutput.results,
      };
      if (handoff) output.handoff = handoff;
      if (handoffRouting) output.handoffRouting = handoffRouting;
      return output;
    },

    async interruptSession(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }
      const session = updateSession(existingSession, {
        retryCount: existingSession.retryCount + 1,
      });
      const payload: Record<string, unknown> = {
        reason: input.reason,
        currentState: session.currentState,
        retryCount: session.retryCount,
      };
      if (input.interruptedOutput !== undefined) payload.interruptedOutput = input.interruptedOutput;
      const events = [
        createCallEvent({
          eventId: idFactory(),
          eventType: "CALL_INTERRUPTED",
          callId: session.callId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          correlationId: input.correlationId ?? idFactory(),
          payload,
        }),
      ];
      await options.store.save(session);
      await options.eventStore?.append(events);
      return {
        session,
        events,
        responseText: "Go ahead. I am listening.",
      };
    },

    async endSession(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }
      const session = updateSession(existingSession, {
        currentState: "END_CALL",
      });
      const payload: Record<string, unknown> = {
        from: existingSession.currentState,
        to: session.currentState,
      };
      if (input.reason !== undefined) payload.reason = input.reason;
      const events = [
        createCallEvent({
          eventId: idFactory(),
          eventType: "CALL_ENDED",
          callId: session.callId,
          sessionId: session.sessionId,
          tenantId: session.tenantId,
          correlationId: input.correlationId ?? idFactory(),
          payload,
        }),
      ];
      await options.store.save(session);
      await options.eventStore?.append(events);
      return { session, events };
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

    async replaySession(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }
      const events = (await options.eventStore?.listBySession(input.tenantId, input.sessionId)) ?? [];
      const facts = existingSession.facts as Partial<FirstCallFacts>;
      const decision = decideFirstCallNextStep(facts);
      const toolResults = events
        .filter((event) => event.eventType === "TOOL_EXECUTED" || event.eventType === "TOOL_FAILED")
        .map((event): ToolResult<object> => {
          const result: ToolResult<object> = {
            toolCallId: String(event.payload.toolCallId ?? ""),
            toolName: String(event.payload.toolName ?? ""),
            ok: event.eventType === "TOOL_EXECUTED",
          };
          if (typeof event.payload.errorCode === "string") result.errorCode = event.payload.errorCode;
          if (typeof event.payload.callerSafeSummary === "string") {
            result.callerSafeSummary = event.payload.callerSafeSummary;
          }
          return result;
        });
      const handoff = createFirstCallHandoffSummary({
        session: existingSession,
        facts,
        decision,
        toolResults,
      });
      return {
        session: existingSession,
        events,
        snapshot: createReplaySnapshot({
          session: existingSession,
          events,
          handoff,
        }),
      };
    },
  };
}

function createReplaySnapshot(input: {
  session: CallSession;
  events: CallEvent[];
  handoff: FirstCallHandoffSummary | undefined;
}): SessionReplaySnapshot {
  if (input.handoff) {
    return createSessionReplaySnapshot({
      session: input.session,
      events: input.events,
      handoff: input.handoff,
    });
  }
  return createSessionReplaySnapshot({
    session: input.session,
    events: input.events,
  });
}

function enabledToolNamesForTenant(config: TenantConfig | undefined): Set<string> | undefined {
  if (!config) return undefined;
  const toolNames = new Set<string>();
  if (config.features.crmHandoff) toolNames.add("crm.create_intake_lead");
  if (config.features.dispatchHandoff) toolNames.add("dispatch.create_removal_request");
  return toolNames;
}

function addIfPresent<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): asserts target is T & Record<K, V> {
  if (value !== undefined) {
    Object.assign(target, { [key]: value });
  }
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
