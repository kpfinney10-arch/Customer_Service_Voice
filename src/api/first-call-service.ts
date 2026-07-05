import type { CallEvent } from "../events/call-event.js";
import { createCallEvent } from "../events/call-event.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import type { CallIntent, StructuredFacts } from "../domain/call-types.js";
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
import type {
  FirstCallExtraction,
  FirstCallExtractor,
  FirstCallFactConfidence,
} from "../verticals/funeral-home/first-call-extractor.js";
import { createFirstCallHandoffSummary } from "../verticals/funeral-home/first-call-handoff.js";
import type { FirstCallHandoffSummary } from "../verticals/funeral-home/first-call-handoff.js";
import {
  decideFirstCallNextStep,
  decideRoutineInquiryNextStep,
  firstCallPromptForDecision,
  firstCallPromptForStep,
} from "../verticals/funeral-home/first-call-flow.js";
import type { FirstCallFlowDecision, FirstCallStep } from "../verticals/funeral-home/first-call-flow.js";
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
  recordProviderCommands: (input: RecordProviderCommandsInput) => Promise<RecordProviderCommandsOutput>;
  listEvents: (input: ListFirstCallEventsInput) => Promise<ListFirstCallEventsOutput>;
  replaySession: (input: ReplayFirstCallSessionInput) => Promise<ReplayFirstCallSessionOutput>;
  listTenantActivity: (input: ListTenantActivityInput) => Promise<ListTenantActivityOutput>;
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

export type RecordProviderCommandsInput = {
  tenantId: string;
  sessionId: string;
  provider: string;
  providerEventType: string;
  commandNames: string[];
  commandResults: ProviderCommandResultSummary[];
  correlationId?: string;
};

export type ProviderCommandResultSummary = {
  command: string;
  ok: boolean;
  statusCode: number;
  dryRun?: boolean;
  failureSummary?: string;
};

export type RecordProviderCommandsOutput = {
  event: CallEvent;
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

export type ListTenantActivityInput = {
  tenantId: string;
  limit?: number;
};

export type TenantActivitySessionSummary = {
  callId: string;
  sessionId: string;
  currentState: string;
  intent: string | null;
  sentiment: string;
  retryCount: number;
  escalationScore: number;
  createdAt: string;
  updatedAt: string;
};

export type TenantActivityEventSummary = {
  eventId: string;
  eventType: string;
  callId: string;
  sessionId: string;
  occurredAt: string;
  correlationId: string;
  redactionStatus: string;
};

export type ListTenantActivityOutput = {
  tenantId: string;
  limit: number;
  sessions: TenantActivitySessionSummary[];
  recentEvents: TenantActivityEventSummary[];
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
      const tenantConfig = await options.tenantConfigStore?.get(input.tenantId);
      assertVoiceIntakeEnabled(tenantConfig);
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
      const tenantConfig = await options.tenantConfigStore?.get(existingSession.tenantId);
      assertVoiceIntakeEnabled(tenantConfig);

      const redacted = redactText(input.transcript);
      const activeDecision = decideFirstCallNextStep(existingSession.facts as Partial<FirstCallFacts>);
      const contextualFacts = inferContextualFacts(existingSession, input.transcript, activeDecision.step);
      const contextualFactConfidence = inferContextualFactConfidence(contextualFacts);
      const rawExtraction = await extractor.extract(input.transcript, {
        tenantId: existingSession.tenantId,
        currentFacts: existingSession.facts as Partial<FirstCallFacts>,
        localFacts: contextualFacts,
        localFactConfidence: contextualFactConfidence,
        activeStep: activeDecision.step,
        missingTargetFacts: activeDecision.missingTargetFacts,
      });
      const factConfidence = mergeFactConfidence(
        rawExtraction.factConfidence,
        contextualFactConfidence,
      );
      const extraction: FirstCallExtraction = {
        ...rawExtraction,
      };
      if (factConfidence) extraction.factConfidence = factConfidence;
      const effectiveIntent = effectiveCallIntent(existingSession.intent, extraction.intent);
      const facts = mergeFirstCallFacts(
        existingSession.facts as Partial<FirstCallFacts>,
        extraction.facts,
        contextualFacts,
        extraction.factConfidence,
        contextualFactConfidence,
        activeDecision.step,
      );
      const intentFacts = factsForIntent(effectiveIntent, facts);
      const reviewedFacts = applyCallerNameSpellingReview(
        existingSession.facts,
        intentFacts,
        input.transcript,
      );
      const sessionFacts = sessionFactsForIntent(effectiveIntent, reviewedFacts, existingSession.facts);
      extraction.warnings = unresolvedFirstCallWarnings(extraction.warnings, sessionFacts);
      const nextStepDecision = isRoutineInquiryIntent(effectiveIntent)
        ? decideRoutineInquiryNextStep(reviewedFacts)
        : decideFirstCallNextStep(reviewedFacts);
      const decision = firstCallDecisionAfterValidation(
        nextStepDecision,
        reviewedFacts,
        extraction.factConfidence,
        input.transcript,
      );
      const session = updateSession(existingSession, {
        currentState: decision.nextState,
        intent: effectiveIntent,
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
            factConfidence: extraction.factConfidence,
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
        facts: reviewedFacts,
        decision,
        registry,
      };
      addIfPresent(
        toolInput,
        "completedToolNames",
        completedToolNamesFromEvents((await options.eventStore?.listBySession(session.tenantId, session.sessionId)) ?? []),
      );
      addIfPresent(toolInput, "enabledToolNames", enabledToolNamesForTenant(tenantConfig));
      const toolOutput = await executeFirstCallTools(toolInput);
      await options.store.save(session);
      const events = [...decisionEvents, ...toolOutput.events];
      await options.eventStore?.append(events);
      const handoff = createFirstCallHandoffSummary({
        session,
        facts: reviewedFacts,
        decision,
        toolResults: toolOutput.results,
      });
      const handoffRouting = handoff ? routeFirstCallHandoff({ handoff, tenantConfig }) : undefined;

      const output: HandleFirstCallTranscriptOutput = {
        session,
        extraction,
        decision,
        responseText: firstCallResponseText(decision, reviewedFacts, input.transcript),
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

    async recordProviderCommands(input) {
      const existingSession = await options.store.get(input.tenantId, input.sessionId);
      if (!existingSession) {
        throw new FirstCallServiceError("SESSION_NOT_FOUND", "Call session was not found.");
      }
      const failedCommandNames = input.commandResults
        .filter((result) => !result.ok)
        .map((result) => result.command);
      const event = createCallEvent({
        eventId: idFactory(),
        eventType: "PROVIDER_COMMANDS_EXECUTED",
        callId: existingSession.callId,
        sessionId: existingSession.sessionId,
        tenantId: existingSession.tenantId,
        correlationId: input.correlationId ?? idFactory(),
        payload: {
          provider: input.provider,
          providerEventType: input.providerEventType,
          commandCount: input.commandNames.length,
          commandNames: input.commandNames,
          resultCount: input.commandResults.length,
          allSucceeded: failedCommandNames.length === 0,
          failedCommandNames,
          commandResults: input.commandResults,
        },
      });
      await options.eventStore?.append([event]);
      return { event };
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

    async listTenantActivity(input) {
      const limit = normalizeActivityLimit(input.limit);
      const sessions = await options.store.listRecentByTenant(input.tenantId, limit);
      const recentEvents = (await options.eventStore?.listRecentByTenant(input.tenantId, limit)) ?? [];
      return {
        tenantId: input.tenantId,
        limit,
        sessions: sessions.map(summarizeSession),
        recentEvents: recentEvents.map(summarizeEvent),
      };
    },
  };
}

function summarizeSession(session: CallSession): TenantActivitySessionSummary {
  return {
    callId: session.callId,
    sessionId: session.sessionId,
    currentState: session.currentState,
    intent: session.intent,
    sentiment: session.sentiment,
    retryCount: session.retryCount,
    escalationScore: session.escalationScore,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function summarizeEvent(event: CallEvent): TenantActivityEventSummary {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    callId: event.callId,
    sessionId: event.sessionId,
    occurredAt: event.occurredAt,
    correlationId: event.correlationId,
    redactionStatus: event.redactionStatus,
  };
}

function normalizeActivityLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isInteger(value) || value < 1) return 20;
  return Math.min(value, 100);
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

function effectiveCallIntent(existingIntent: CallIntent | null, extractedIntent: CallIntent): CallIntent {
  if (existingIntent && isRoutineInquiryIntent(existingIntent) && extractedIntent === "unknown") return existingIntent;
  return extractedIntent;
}

function isRoutineInquiryIntent(intent: CallIntent | null | undefined): boolean {
  return intent === "pricing_or_billing" || intent === "family_question" || intent === "service_schedule_question";
}

function factsForIntent(
  intent: CallIntent,
  facts: Partial<FirstCallFacts>,
): Partial<FirstCallFacts> {
  if (!isRoutineInquiryIntent(intent)) return facts;
  return {
    ...facts,
    death_reported: false,
    reasonForCall: intent,
    urgency: facts.urgency && facts.urgency !== "unknown" ? facts.urgency : "routine",
  };
}

function sessionFactsForIntent(
  intent: CallIntent,
  facts: Partial<FirstCallFacts>,
  existing: StructuredFacts = {},
): StructuredFacts {
  if (isRoutineInquiryIntent(intent)) {
    return {
      ...facts,
      death_reported: false,
      reasonForCall: intent,
      urgency: facts.urgency && facts.urgency !== "unknown" ? facts.urgency : "routine",
    };
  }
  return {
    ...facts,
    death_reported: existing.death_reported === true ? true : (facts.death_reported ?? true),
    reasonForCall: facts.reasonForCall ?? "first_call_death_report",
  };
}

function enabledToolNamesForTenant(config: TenantConfig | undefined): Set<string> | undefined {
  if (!config) return undefined;
  const toolNames = new Set<string>();
  if (config.features.crmHandoff) toolNames.add("crm.create_intake_lead");
  if (config.features.dispatchHandoff) toolNames.add("dispatch.create_removal_request");
  return toolNames;
}

function completedToolNamesFromEvents(events: CallEvent[]): Set<string> {
  return new Set(
    events
      .filter((event) => event.eventType === "TOOL_EXECUTED")
      .map((event) => event.payload.toolName)
      .filter((toolName): toolName is string => typeof toolName === "string" && toolName.trim().length > 0),
  );
}

function assertVoiceIntakeEnabled(config: TenantConfig | undefined): void {
  if (config && !config.features.voiceIntake) {
    throw new FirstCallServiceError(
      "TENANT_FEATURE_DISABLED",
      "Voice intake is not enabled for this tenant.",
    );
  }
}

function inferContextualFacts(session: CallSession, transcript: string, activeStep?: FirstCallStep): Partial<FirstCallFacts> {
  const spellingFacts = callerNameSpellingCorrectionFacts(session.facts, transcript);
  if (spellingFacts) return spellingFacts;

  const facts: Partial<FirstCallFacts> = {};
  Object.assign(facts, inferCallerFactsForTurn(session, transcript));

  const afterCallerFacts = mergedContextualFacts(session.facts, facts);
  const decedentResult = inferDecedentFactsForTurn(afterCallerFacts, transcript, activeStep);
  Object.assign(facts, decedentResult.facts);

  const afterDecedentFacts = { ...afterCallerFacts, ...decedentResult.facts };
  Object.assign(facts, inferPickupAddressFactsForTurn(afterDecedentFacts, transcript, activeStep, decedentResult.capturedThisTurn));
  return facts;
}

function callerNameSpellingCorrectionFacts(existing: StructuredFacts, transcript: string): Partial<FirstCallFacts> | undefined {
  if (!hasPendingCallerNameSpellingConfirmation(existing)) return undefined;
  const correctedCallerName = correctedSuspiciousNameFromSpelling(existing.caller_name, transcript);
  if (!correctedCallerName) return {};
  return {
    caller_name: correctedCallerName,
    pickup_contact_name: correctedCallerName,
  };
}

function inferCallerFactsForTurn(session: CallSession, transcript: string): Partial<FirstCallFacts> {
  if (session.facts.caller_name && session.facts.caller_phone) return {};
  const callerFacts = callerAnswerFacts(transcript, session.callerPhone);
  if (session.facts.caller_name && !extractContextualCallerName(transcript)) {
    delete callerFacts.caller_name;
    delete callerFacts.pickup_contact_name;
  }
  return callerFacts;
}

function mergedContextualFacts(
  existing: StructuredFacts,
  contextual: Partial<FirstCallFacts>,
): Partial<FirstCallFacts> {
  return { ...(existing as Partial<FirstCallFacts>), ...contextual };
}

type DecedentFactInference = {
  facts: Partial<FirstCallFacts>;
  capturedThisTurn: boolean;
};

function inferDecedentFactsForTurn(
  facts: Partial<FirstCallFacts>,
  transcript: string,
  activeStep?: FirstCallStep,
): DecedentFactInference {
  if (!facts.caller_name || !facts.caller_phone || facts.decedent_name) {
    return { facts: {}, capturedThisTurn: false };
  }
  const decedentName = decedentNameFromTranscript(transcript, activeStep);
  if (!decedentName || decedentName === facts.caller_name) {
    return { facts: {}, capturedThisTurn: false };
  }
  return { facts: { decedent_name: decedentName }, capturedThisTurn: true };
}

function decedentNameFromTranscript(transcript: string, activeStep?: FirstCallStep): string | undefined {
  return (
    nameOnlyAnswer(transcript) ??
    (activeStep === "collect_decedent"
      ? extractContextualCallerName(transcript) ?? leadingNameFromMixedAnswer(transcript)
      : undefined)
  );
}

function inferPickupAddressFactsForTurn(
  facts: Partial<FirstCallFacts>,
  transcript: string,
  activeStep: FirstCallStep | undefined,
  capturedDecedentThisTurn: boolean,
): Partial<FirstCallFacts> {
  if (!facts.decedent_name || facts.pickup_address) return {};
  if (activeStep === "collect_decedent" && capturedDecedentThisTurn) return {};
  const pickupAddress = addressOnlyAnswer(transcript);
  if (!pickupAddress) return {};
  const addressFacts: Partial<FirstCallFacts> = { pickup_address: pickupAddress };
  if (!hasKnownNonResidencePlaceType(facts.place_of_death_type)) {
    addressFacts.place_of_death_type = "residence";
  }
  return addressFacts;
}

function hasKnownNonResidencePlaceType(place: FirstCallFacts["place_of_death_type"] | undefined): boolean {
  return Boolean(place && place !== "unknown" && place !== "residence");
}

function mergeFirstCallFacts(
  existing: Partial<FirstCallFacts>,
  extracted: Partial<FirstCallFacts>,
  contextual: Partial<FirstCallFacts>,
  extractedConfidence: FirstCallFactConfidence | undefined = {},
  contextualConfidence: FirstCallFactConfidence = {},
  activeStep?: FirstCallStep,
): Partial<FirstCallFacts> {
  const merged: Partial<FirstCallFacts> = {
    ...existing,
    ...contextual,
    ...higherConfidenceFacts(extracted, contextual, extractedConfidence, contextualConfidence, existing, activeStep),
  };
  if (existing.death_reported === true && extracted.death_reported === false && contextual.death_reported !== false) {
    merged.death_reported = true;
  }
  return merged;
}

function higherConfidenceFacts(
  extracted: Partial<FirstCallFacts>,
  contextual: Partial<FirstCallFacts>,
  extractedConfidence: FirstCallFactConfidence,
  contextualConfidence: FirstCallFactConfidence,
  existing: Partial<FirstCallFacts> = {},
  activeStep?: FirstCallStep,
): Partial<FirstCallFacts> {
  const preferred: Partial<FirstCallFacts> = {};
  for (const [key, value] of Object.entries(extracted) as Array<[keyof FirstCallFacts, FirstCallFacts[keyof FirstCallFacts]]>) {
    if (value == null) continue;
    if (shouldPreserveExistingCallerIdentity(key, existing, activeStep)) continue;
    if (shouldPreserveExistingPlaceOfDeath(key, value, existing)) continue;
    if (shouldPreserveExistingUrgency(key, value, existing)) continue;
    const contextualValue = contextual[key];
    if (isFullerNameFact(key, value, contextualValue)) {
      setFact(preferred, key, value);
      continue;
    }
    if (contextualValue == null || (extractedConfidence[key] ?? 0) > (contextualConfidence[key] ?? 0)) {
      setFact(preferred, key, value);
    }
  }
  return preferred;
}

function shouldPreserveExistingUrgency(
  key: keyof FirstCallFacts,
  extractedValue: FirstCallFacts[keyof FirstCallFacts],
  existing: Partial<FirstCallFacts>,
): boolean {
  if (key !== "urgency") return false;
  return extractedValue === "unknown" && Boolean(existing.urgency && existing.urgency !== "unknown");
}

function shouldPreserveExistingPlaceOfDeath(
  key: keyof FirstCallFacts,
  extractedValue: FirstCallFacts[keyof FirstCallFacts],
  existing: Partial<FirstCallFacts>,
): boolean {
  if (key !== "place_of_death_type") return false;
  return extractedValue === "unknown" && Boolean(existing.place_of_death_type && existing.place_of_death_type !== "unknown");
}

function shouldPreserveExistingCallerIdentity(
  key: keyof FirstCallFacts,
  existing: Partial<FirstCallFacts>,
  activeStep?: FirstCallStep,
): boolean {
  if (activeStep === "collect_caller") return false;
  if (key !== "caller_name" && key !== "pickup_contact_name") return false;
  return typeof existing[key] === "string" && existing[key].trim().length > 0;
}

function isFullerNameFact(
  key: keyof FirstCallFacts,
  extractedValue: FirstCallFacts[keyof FirstCallFacts],
  contextualValue: FirstCallFacts[keyof FirstCallFacts] | undefined,
): boolean {
  if (key !== "caller_name" && key !== "pickup_contact_name") return false;
  if (typeof extractedValue !== "string" || typeof contextualValue !== "string") return false;
  const extracted = extractedValue.trim();
  const contextual = contextualValue.trim();
  if (!extracted || !contextual) return false;
  return extracted.split(/\s+/).length > contextual.split(/\s+/).length && extracted.toLowerCase().startsWith(`${contextual.toLowerCase()} `);
}

function setFact<K extends keyof FirstCallFacts>(
  facts: Partial<FirstCallFacts>,
  key: K,
  value: FirstCallFacts[K],
): void {
  facts[key] = value;
}

function mergeFactConfidence(
  extracted: FirstCallFactConfidence | undefined,
  contextual: FirstCallFactConfidence,
): FirstCallFactConfidence | undefined {
  const merged: FirstCallFactConfidence = { ...(extracted ?? {}) };
  for (const [key, value] of Object.entries(contextual) as Array<[keyof FirstCallFacts, number]>) {
    merged[key] = Math.max(merged[key] ?? 0, value);
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function unresolvedFirstCallWarnings(warnings: string[], facts: StructuredFacts): string[] {
  return warnings.filter((warning) => {
    if (warning === "caller_name_not_found") return !facts.caller_name;
    if (warning === "caller_phone_not_found") return !facts.caller_phone;
    if (warning === "decedent_name_not_found") return !facts.decedent_name;
    if (warning === "pickup_context_not_found") return !facts.pickup_address && !facts.facility_name;
    return true;
  });
}

function inferContextualFactConfidence(facts: Partial<FirstCallFacts>): FirstCallFactConfidence {
  const confidence: FirstCallFactConfidence = {};
  if (facts.caller_name) confidence.caller_name = 0.86;
  if (facts.pickup_contact_name) confidence.pickup_contact_name = confidence.caller_name ?? 0.82;
  if (facts.caller_phone) confidence.caller_phone = 0.92;
  if (facts.preferred_callback_number) confidence.preferred_callback_number = confidence.caller_phone ?? 0.92;
  if (facts.pickup_contact_phone) confidence.pickup_contact_phone = confidence.caller_phone ?? 0.92;
  if (facts.decedent_name) confidence.decedent_name = 0.84;
  if (facts.pickup_address) confidence.pickup_address = contextualPickupAddressConfidence(facts.pickup_address);
  if (facts.facility_name) confidence.facility_name = 0.82;
  if (facts.place_of_death_type) confidence.place_of_death_type = facts.place_of_death_type === "unknown" ? 0.35 : 0.72;
  return confidence;
}

function contextualPickupAddressConfidence(address: string): number {
  return hasSuspiciousLowercaseLocationToken(address) || hasSuspiciousStreetNameToken(address) ? 0.62 : 0.82;
}

function firstCallDecisionAfterValidation(
  decision: FirstCallFlowDecision,
  facts: Partial<FirstCallFacts>,
  factConfidence: FirstCallFactConfidence | undefined,
  transcript: string,
): FirstCallFlowDecision {
  if (needsCallerNameSpellingConfirmation(facts)) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_caller",
      missingTargetFacts: decision.missingTargetFacts,
      toolNames: [],
    };
  }
  if (decision.step === "escalate" && needsPickupAddressConfirmation(facts, factConfidence, transcript)) {
    return {
      nextState: "RESOLVE_REQUEST",
      step: "collect_location",
      missingTargetFacts: decision.missingTargetFacts.includes("pickup_address")
        ? decision.missingTargetFacts
        : [...decision.missingTargetFacts, "pickup_address"],
      toolNames: [],
    };
  }
  return decision;
}

function needsPickupAddressConfirmation(
  facts: Partial<FirstCallFacts>,
  _factConfidence: FirstCallFactConfidence | undefined,
  transcript = "",
): boolean {
  if (!facts.pickup_address || !hasSuspiciousStreetNameToken(facts.pickup_address)) return false;
  return !confirmsSuspiciousStreetName(facts.pickup_address, transcript);
}

function hasSuspiciousLowercaseLocationToken(address: string): boolean {
  const parts = addressParts(address);
  const suffixIndex = parts.findIndex(isStreetSuffix);
  if (suffixIndex < 0) return false;
  const locationTokens = parts.slice(suffixIndex + 1);
  return locationTokens.some((part) => /^[a-z]{2,}$/.test(part));
}

const suspiciousStreetNameTokens = new Set(["gymnastics"]);

function hasSuspiciousStreetNameToken(address: string): boolean {
  const parts = addressParts(address);
  const suffixIndex = parts.findIndex(isStreetSuffix);
  if (suffixIndex < 0) return false;
  const streetNameTokens = parts.slice(1, suffixIndex);
  return streetNameTokens.some((part) => suspiciousStreetNameTokens.has(part.toLowerCase()));
}

function addressParts(address: string): string[] {
  return address.replace(/[,.]/g, " ").replace(/\s+/g, " ").trim().split(/\s+/);
}

function isStreetSuffix(part: string): boolean {
  return /^(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)$/i.test(
    part,
  );
}

function callerAnswerFacts(transcript: string, providerCallerPhone?: string): Partial<FirstCallFacts> {
  return {
    ...callerPhoneFacts(transcript, providerCallerPhone),
    ...callerNameFacts(transcript),
  };
}

function callerPhoneFacts(transcript: string, providerCallerPhone?: string): Partial<FirstCallFacts> {
  const phone = extractContextualPhone(transcript) ?? repairPhoneFromProviderCallerId(transcript, providerCallerPhone);
  if (phone) {
    return {
      caller_phone: phone,
      preferred_callback_number: phone,
      pickup_contact_phone: phone,
    };
  }
  return {};
}

function callerNameFacts(transcript: string): Partial<FirstCallFacts> {
  const name = callerNameFromTranscript(transcript);
  if (!name) return {};
  return {
    caller_name: name,
    pickup_contact_name: name,
  };
}

function callerNameFromTranscript(transcript: string): string | undefined {
  const explicitName = extractContextualCallerName(transcript);
  const nameCandidate = callerNameCandidate(transcript);
  const candidateName = nameOnlyAnswer(nameCandidate);
  return fullerContextualName(explicitName, candidateName) ?? explicitName ?? candidateName;
}

function callerNameCandidate(transcript: string): string {
  return (transcript.split(phoneCuePattern)[0] ?? transcript)
    .replace(contextualPhonePattern, " ")
    .replace(/\b(?:and|phone|telephone|television|number|contact|callback|call back|cell|mobile|at|is|my|name|i'm|i am)\b/gi, " ")
    .replace(/[,.?!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const contextualPhonePattern = /\b(?:\+?1[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\b/g;
const phoneCuePattern =
  /\b(?:my\s+)?(?:phone|telephone|number|contact|callback|call back|cell|mobile)\b|\b(?:reached|reach me|call me)\b|\bat\b(?=\s*(?:\+?1[\s.-]*)?\d)/i;

function extractContextualCallerName(transcript: string): string | undefined {
  const beforePhoneCue = transcript.split(phoneCuePattern)[0] ?? transcript;
  const rawName =
    beforePhoneCue.match(/\b([A-Za-z]+(?:\s+[A-Za-z]+){0,3})\s+is\s+my\s+name\b/i)?.[1] ??
    beforePhoneCue.match(
      /\b(?:my\s+name\s+is|this\s+is|it\s+is|it'?s|i\s+am|i'm)\s+(?:nurse|rn|registered nurse|doctor|dr\.?|social worker|chaplain|case manager|investigator|medical examiner|coroner|deputy coroner),?\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})(?=[,.?!]|\s+(?:with|at|from)\b|\s*$)/i,
    )?.[1] ??
    beforePhoneCue.match(
      /\b(?:my\s+name\s+is|this\s+is|it\s+is|it'?s|i\s+am|i'm)\s+([A-Za-z]+(?:\s+[A-Za-z]+){0,3})(?=[,.?!]|\s*$)/i,
    )?.[1];
  return rawName ? nameOnlyAnswer(rawName) : undefined;
}

function leadingNameFromMixedAnswer(transcript: string): string | undefined {
  const trimmed = transcript.trim();
  const firstClause = trimmed.split(/[,;]/)[0]?.trim();
  const clauseName = firstClause && firstClause !== trimmed ? nameOnlyAnswer(firstClause) : undefined;
  if (clauseName) return clauseName;
  const atAddressName = trimmed.match(
    /^([A-Za-z]+(?:\s+[A-Za-z]+){0,3})\s+(?:is\s+)?(?:located\s+)?at\s+(?=\d)/i,
  )?.[1];
  return atAddressName ? nameOnlyAnswer(atAddressName) : undefined;
}

function fullerContextualName(
  explicitName: string | undefined,
  candidateName: string | undefined,
): string | undefined {
  if (!explicitName || !candidateName) return undefined;
  const explicit = explicitName.trim();
  const candidate = candidateName.trim();
  if (!explicit || !candidate) return undefined;
  const explicitWords = explicit.split(/\s+/);
  const candidateWords = candidate.split(/\s+/);
  if (candidateWords.length <= explicitWords.length) return undefined;
  return candidate.toLowerCase().startsWith(`${explicit.toLowerCase()} `) ? candidate : undefined;
}

function extractContextualPhone(transcript: string): string | undefined {
  const raw = transcript.match(contextualPhonePattern)?.[0];
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return raw.trim();
  return `${tenDigits.slice(0, 3)}-${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

function repairPhoneFromProviderCallerId(
  transcript: string,
  providerCallerPhone: string | undefined,
): string | undefined {
  if (!providerCallerPhone || (!phoneCuePattern.test(transcript) && !isBareRepairablePhoneAnswer(transcript))) return undefined;
  const transcriptDigits = transcript.replace(/\D/g, "");
  if (transcriptDigits.length !== 9) return undefined;
  const providerDigits = normalizedTenDigitPhone(providerCallerPhone);
  if (!providerDigits || !isSubsequence(transcriptDigits, providerDigits)) return undefined;
  return formatTenDigitPhone(providerDigits);
}

const PHONE_REPAIR_FILLER_WORDS = new Set([
  "course",
  "down",
  "hm",
  "hmm",
  "o",
  "of",
  "oh",
  "ok",
  "okay",
  "uh",
  "um",
  "yeah",
  "yep",
  "yes",
  "zero",
]);

function isBareRepairablePhoneAnswer(transcript: string): boolean {
  const digits = transcript.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  const words = transcript
    .toLowerCase()
    .replace(/\d/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return words.every((word) => PHONE_REPAIR_FILLER_WORDS.has(word));
}

function normalizedTenDigitPhone(phone: string): string | undefined {
  const digits = phone.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return tenDigits.length === 10 ? tenDigits : undefined;
}

function formatTenDigitPhone(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isSubsequence(candidate: string, target: string): boolean {
  let candidateIndex = 0;
  for (const digit of target) {
    if (candidate[candidateIndex] === digit) candidateIndex += 1;
    if (candidateIndex === candidate.length) return true;
  }
  return candidateIndex === candidate.length;
}

function firstCallResponseText(
  decision: FirstCallFlowDecision,
  facts: Partial<FirstCallFacts>,
  transcript: string,
): string {
  if (decision.step === "collect_caller" && needsCallerNameSpellingConfirmation(facts)) {
    const callbackAcknowledgement = facts.caller_phone ? "I have the callback number. " : "";
    return `${callbackAcknowledgement}I heard your name as ${facts.caller_name}. Please spell your last name for the funeral director.`;
  }
  if (decision.step === "collect_caller" && facts.caller_name && !facts.caller_phone && hasNearPhoneNumber(transcript)) {
    return "I heard a phone number, but I want to make sure I have all 10 digits correctly. Please say the best callback number one digit at a time.";
  }
  if (decision.step === "collect_location" && needsPickupAddressConfirmation(facts, undefined, transcript)) {
    return `I heard ${facts.pickup_address}. Please repeat just the street name so I can make sure I have it right.`;
  }
  return firstCallPromptForDecision(decision, facts);
}

function hasNearPhoneNumber(transcript: string): boolean {
  if (!phoneCuePattern.test(transcript)) return false;
  const digits = transcript.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return false;
  return digits.length >= 9 && digits.length <= 12;
}

function confirmsSuspiciousStreetName(address: string, transcript: string): boolean {
  const suspiciousTokens = suspiciousStreetTokensInAddress(address);
  if (suspiciousTokens.length === 0) return false;
  const answerParts = addressParts(transcript);
  if (answerParts.length < 1 || answerParts.length > 3) return false;
  const answer = answerParts.join(" ").toLowerCase();
  return suspiciousTokens.some((token) => answer === token || answer === `${token} street`);
}

function suspiciousStreetTokensInAddress(address: string): string[] {
  const parts = addressParts(address);
  const suffixIndex = parts.findIndex(isStreetSuffix);
  if (suffixIndex < 0) return [];
  return parts
    .slice(1, suffixIndex)
    .map((part) => part.toLowerCase())
    .filter((part) => suspiciousStreetNameTokens.has(part));
}

function nameOnlyAnswer(transcript: string): string | undefined {
  const trimmed = transcript
    .trim()
    .replace(/^(?:the\s+)?name\s+is\s+/i, "")
    .replace(/[.?!]+$/, "")
    .replace(/[.?!]+\s+/g, " ")
    .replace(/\s+/g, " ");
  const words = trimmed.split(" ").filter(Boolean);
  if (words.length < 1 || words.length > 4) return undefined;
  if (!words.every((word) => /^[A-Za-z]+$/.test(word))) return undefined;
  if (words.some((word) => COMMON_NON_NAME_ANSWERS.has(word.toLowerCase()))) return undefined;
  return words.map(normalizeNameWord).join(" ");
}

function normalizeNameWord(word: string): string {
  if (/^[A-Z]{2,3}$/.test(word)) return word;
  if (/^mc[a-z]+$/i.test(word) && word.length > 2) {
    return `Mc${word[2]?.toUpperCase() ?? ""}${word.slice(3).toLowerCase()}`;
  }
  return `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`;
}

const callerNameSpellingStatusKey = "caller_name_spelling_status";
const callerNameSpellingAttemptedKey = "caller_name_spelling_attempted";
const callerNameSpellingOriginalKey = "caller_name_spelling_original";
const callerNameSpellingCorrectedKey = "caller_name_spelling_corrected";
const pendingCallerNameSpellingStatus = "needs_confirmation";
const confirmedCallerNameSpellingStatus = "confirmed";
const attemptedCallerNameSpellingStatus = "attempted";
const suspiciousNameSpellings = new Map([
  ["feny", "finney"],
  ["finny", "finney"],
]);

function applyCallerNameSpellingReview(
  existing: StructuredFacts,
  facts: Partial<FirstCallFacts>,
  transcript: string,
): Partial<FirstCallFacts> & StructuredFacts {
  const reviewed: Partial<FirstCallFacts> & StructuredFacts = { ...facts };
  if (hasRoutineReasonForCall(facts)) return reviewed;

  const existingStatus = stringFact(existing, callerNameSpellingStatusKey);
  const existingAttempted = Number(existing[callerNameSpellingAttemptedKey] ?? 0);

  if (existingStatus === pendingCallerNameSpellingStatus) {
    const correctedCallerName = correctedSuspiciousNameFromSpelling(existing.caller_name, transcript);
    if (correctedCallerName) {
      reviewed.caller_name = correctedCallerName;
      reviewed.pickup_contact_name = correctedCallerName;
      reviewed[callerNameSpellingStatusKey] = confirmedCallerNameSpellingStatus;
      reviewed[callerNameSpellingCorrectedKey] = correctedCallerName;
      reviewed[callerNameSpellingAttemptedKey] = existingAttempted + 1;
      return reviewed;
    }
    if (confirmsHeardName(transcript)) {
      reviewed[callerNameSpellingStatusKey] = confirmedCallerNameSpellingStatus;
      reviewed[callerNameSpellingAttemptedKey] = existingAttempted + 1;
      return reviewed;
    }
    reviewed[callerNameSpellingStatusKey] = attemptedCallerNameSpellingStatus;
    reviewed[callerNameSpellingAttemptedKey] = existingAttempted + 1;
    return reviewed;
  }

  if (
    facts.caller_name &&
    existingStatus !== confirmedCallerNameSpellingStatus &&
    existingStatus !== attemptedCallerNameSpellingStatus &&
    hasSuspiciousNameSpelling(facts.caller_name)
  ) {
    reviewed[callerNameSpellingStatusKey] = pendingCallerNameSpellingStatus;
    reviewed[callerNameSpellingOriginalKey] = facts.caller_name;
    reviewed[callerNameSpellingAttemptedKey] = 0;
  }
  return reviewed;
}

function hasRoutineReasonForCall(facts: Partial<FirstCallFacts>): boolean {
  const reasonForCall = facts.reasonForCall;
  return typeof reasonForCall === "string" && isRoutineInquiryIntent(reasonForCall as CallIntent);
}

function needsCallerNameSpellingConfirmation(facts: Partial<FirstCallFacts> | StructuredFacts): boolean {
  return stringFact(facts, callerNameSpellingStatusKey) === pendingCallerNameSpellingStatus && typeof facts.caller_name === "string";
}

function hasPendingCallerNameSpellingConfirmation(facts: StructuredFacts): boolean {
  return needsCallerNameSpellingConfirmation(facts);
}

function hasSuspiciousNameSpelling(name: string): boolean {
  return nameTokens(name).some((token) => suspiciousNameSpellings.has(token.toLowerCase()));
}

function correctedSuspiciousNameFromSpelling(
  currentName: unknown,
  transcript: string,
): string | undefined {
  if (typeof currentName !== "string" || !hasSuspiciousNameSpelling(currentName)) return undefined;
  const spelledName = spelledNameAnswer(transcript);
  if (!spelledName) return undefined;
  return replaceSuspiciousNameToken(currentName, spelledName);
}

function spelledNameAnswer(transcript: string): string | undefined {
  const normalized = transcript
    .trim()
    .replace(
      /^(?:(?:it'?s|its|that'?s|thats)\s+spelled|it'?s|its|that'?s|thats|(?:the\s+)?last\s+name\s+is\s+spelled|(?:the\s+)?last\s+name\s+is)\s+/i,
      "",
    )
    .replace(/[.?!]+$/g, "")
    .replace(/[,.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 1 && /^[A-Za-z]{2,20}$/.test(words[0] ?? "")) return normalizeNameWord(words[0] ?? "");
  if (words.length >= 2 && words.length <= 20 && words.every((word) => /^[A-Za-z]$/.test(word))) {
    return normalizeNameWord(words.join(""));
  }
  const trailingLetters = trailingSingleLetterWords(words);
  if (trailingLetters.length >= 2 && trailingLetters.length <= 20) {
    return normalizeNameWord(trailingLetters.join(""));
  }
  return undefined;
}

function trailingSingleLetterWords(words: string[]): string[] {
  const letters: string[] = [];
  for (let index = words.length - 1; index >= 0; index -= 1) {
    const word = words[index] ?? "";
    if (!/^[A-Za-z]$/.test(word)) break;
    letters.unshift(word);
  }
  return letters;
}

function replaceSuspiciousNameToken(name: string, spelledName: string): string | undefined {
  const tokens = nameTokens(name);
  const index = tokens.findIndex((token) => suspiciousNameSpellings.has(token.toLowerCase()));
  if (index < 0) return undefined;
  tokens[index] = spelledName;
  return tokens.join(" ");
}

function confirmsHeardName(transcript: string): boolean {
  return /^(?:yes|yeah|yep|correct|that'?s correct|that is correct|right)$/i.test(transcript.trim().replace(/[.?!]+$/g, ""));
}

function nameTokens(name: string): string[] {
  return name.trim().split(/\s+/).filter(Boolean);
}

function stringFact(facts: Partial<FirstCallFacts> | StructuredFacts, key: string): string | undefined {
  const value = (facts as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function addressOnlyAnswer(transcript: string): string | undefined {
  const normalized = transcript
    .trim()
    .replace(/\b(\d):(\d{2})(?=\s+[A-Za-z])/g, "$1$2")
    .replace(/[.?!]+$/, "")
    .replace(/[.?!]+/g, " ")
    .replaceAll(",", " ")
    .replace(/\band\s+its\s+apartment\b/gi, "apartment")
    .replace(/\b(\d{2,6})[.?!]+\s+([A-Za-z])/g, "$1 $2")
    .replace(/\b(\d)\s+(\d)\s+(\d)\b/g, "$1$2$3")
    .replace(/^(\d)\s+(\d)\s+(\d)\b/, "$1$2$3")
    .replace(/^(\d{1,3})\s+(\d)\b/, "$1$2")
    .replace(/\b(\d{2,6}\s+(?:(?!\b(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)\b)[A-Za-z0-9][A-Za-z0-9.-]*\s+){0,4}[A-Za-z0-9][A-Za-z0-9.-]*)\s+(?:a|as|salve)\s+([A-Za-z])/gi, "$1 Ave $2")
    .replace(
      /\b(Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)\s+(?:and|in|from)\s+/gi,
      "$1 ",
    )
    .replace(/\s+/g, " ");
  const address = normalized.match(
    /\b(\d{2,6}\s+[A-Za-z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)\b(?:\s+(?!(?:apartment|apt|unit|suite)\b)[A-Za-z][A-Za-z]*)*(?:\s+(?:apartment|apt|unit|suite)\s+\w+)?)\b/i,
  )?.[1];
  return address?.trim();
}

const COMMON_NON_NAME_ANSWERS = new Set([
  "and",
  "course",
  "yes",
  "no",
  "of",
  "sure",
  "okay",
  "ok",
  "uh",
  "um",
  "hello",
  "hi",
  "home",
  "hospital",
  "hospice",
  "address",
  "apartment",
  "at",
  "about",
  "callback",
  "basic",
  "call",
  "calling",
  "case",
  "case manager",
  "cost",
  "cremation",
  "disconnected",
  "doctor",
  "direct",
  "dr",
  "deputy",
  "coroner",
  "examiner",
  "he",
  "her",
  "him",
  "future",
  "in",
  "included",
  "investigator",
  "is",
  "it",
  "located",
  "location",
  "manager",
  "medical",
  "miss",
  "mr",
  "mrs",
  "ms",
  "my",
  "nurse",
  "number",
  "phone",
  "planning",
  "pricing",
  "question",
  "rn",
  "she",
  "social",
  "there",
  "we",
  "worker",
]);

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
    public readonly code: "SESSION_NOT_FOUND" | "TENANT_FEATURE_DISABLED",
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
