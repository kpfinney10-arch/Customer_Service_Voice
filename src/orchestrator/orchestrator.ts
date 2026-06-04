import { createCallEvent } from "../events/call-event.js";
import type { CallEvent } from "../events/call-event.js";
import { evaluateRules } from "../rules/rules-engine.js";
import type { BusinessRule, RuleAction } from "../rules/rules-engine.js";
import { updateSession } from "../session/call-session.js";
import type { CallSession } from "../session/call-session.js";
import { assertTransition } from "../state-machine/call-state-machine.js";
import { redactText } from "../security/redaction.js";
import { classifyFuneralHomeIntent } from "../verticals/funeral-home/intents.js";

export type OrchestratorTurnInput = {
  eventIdFactory: () => string;
  correlationId: string;
  transcript: string;
  session: CallSession;
  rules: BusinessRule[];
};

export type OrchestratorTurnOutput = {
  session: CallSession;
  events: CallEvent[];
  actions: RuleAction[];
  responseText: string;
};

export function handleTranscriptTurn(input: OrchestratorTurnInput): OrchestratorTurnOutput {
  const redacted = redactText(input.transcript);
  const intent = classifyFuneralHomeIntent(redacted.value);
  const transcriptEvent = createCallEvent({
    eventId: input.eventIdFactory(),
    eventType: "TRANSCRIPT_RECEIVED",
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    tenantId: input.session.tenantId,
    correlationId: input.correlationId,
    redactionStatus: redacted.redacted ? "redacted" : "not_required",
    payload: {
      transcript: redacted.value,
      redactionCategories: redacted.categories,
    },
  });

  const intentEvent = createCallEvent({
    eventId: input.eventIdFactory(),
    eventType: "INTENT_DETECTED",
    callId: input.session.callId,
    sessionId: input.session.sessionId,
    tenantId: input.session.tenantId,
    correlationId: input.correlationId,
    payload: { intent },
  });

  const evaluated = evaluateRules(input.rules, {
    intent,
    sentiment: input.session.sentiment,
    retryCount: input.session.retryCount,
    facts: input.session.facts,
  });
  const matchedActions = evaluated.flatMap((result) => result.actions);

  const shouldEscalate = matchedActions.some((action) => action.type === "escalate");
  const nextState = shouldEscalate
    ? "ESCALATE"
    : input.session.currentState === "IDENTIFY_INTENT"
      ? "RESOLVE_REQUEST"
      : "IDENTIFY_INTENT";
  assertTransition(input.session.currentState, nextState);

  const nextSession = updateSession(input.session, {
    intent,
    currentState: nextState,
    escalationScore: shouldEscalate ? 1 : input.session.escalationScore,
  });

  const transitionEvent = createCallEvent({
    eventId: input.eventIdFactory(),
    eventType: shouldEscalate ? "ESCALATION_TRIGGERED" : "STATE_TRANSITIONED",
    callId: nextSession.callId,
    sessionId: nextSession.sessionId,
    tenantId: nextSession.tenantId,
    correlationId: input.correlationId,
    payload: {
      from: input.session.currentState,
      to: nextSession.currentState,
      actions: matchedActions,
    },
  });

  return {
    session: nextSession,
    events: [transcriptEvent, intentEvent, transitionEvent],
    actions: matchedActions,
    responseText: shouldEscalate
      ? "I am going to connect you with a funeral home team member who can help right away."
      : "I can help with that. Let me collect the details we need.",
  };
}
