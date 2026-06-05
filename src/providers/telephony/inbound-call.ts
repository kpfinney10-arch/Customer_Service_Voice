import type { CallEvent } from "../../events/call-event.js";
import type { CallSession } from "../../session/call-session.js";
import type { FirstCallFlowDecision } from "../../verticals/funeral-home/first-call-flow.js";
import { firstCallPromptForStep } from "../../verticals/funeral-home/first-call-flow.js";
import type { FirstCallService } from "../../api/first-call-service.js";
import type { FirstCallHandoffSummary } from "../../verticals/funeral-home/first-call-handoff.js";
import type { ToolResult } from "../../tools/tool-registry.js";
import {
  createHandoffVoiceResponse,
  createHangupVoiceResponse,
  createListenVoiceResponse,
} from "./voice-response.js";
import type { VoiceResponse } from "./voice-response.js";

export type InboundTelephonyCallInput = {
  tenantId: string;
  provider: string;
  providerCallId: string;
  fromPhone?: string;
  toPhone?: string;
  correlationId?: string;
};

export type InboundTelephonyCallOutput = {
  session: CallSession;
  events: CallEvent[];
  responseText: string;
  provider: string;
  providerCallId: string;
  route: "first_call_intake";
  nextExpectedInput: "caller_speech";
  voiceResponse: VoiceResponse;
};

export type TelephonySpeechTurnInput = {
  tenantId: string;
  provider: string;
  providerCallId: string;
  transcript: string;
  confidence?: number;
  isFinal?: boolean;
  correlationId?: string;
};

export type TelephonySpeechTurnOutput = {
  session: CallSession;
  events: CallEvent[];
  responseText: string;
  provider: string;
  providerCallId: string;
  route: "first_call_intake";
  nextExpectedInput: "caller_speech" | "human_handoff";
  decision: FirstCallFlowDecision;
  toolResults: ToolResult<object>[];
  voiceResponse: VoiceResponse;
  handoff?: FirstCallHandoffSummary;
};

export type TelephonyCallEndInput = {
  tenantId: string;
  provider: string;
  providerCallId: string;
  reason?: string;
  correlationId?: string;
};

export type TelephonyCallEndOutput = {
  session: CallSession;
  events: CallEvent[];
  provider: string;
  providerCallId: string;
  ended: true;
  voiceResponse: VoiceResponse;
};

export async function handleInboundTelephonyCall(
  service: FirstCallService,
  input: InboundTelephonyCallInput,
): Promise<InboundTelephonyCallOutput> {
  const sessionInput = {
    tenantId: input.tenantId,
    callId: input.providerCallId,
    sessionId: input.providerCallId,
  };
  addIfPresent(sessionInput, "callerPhone", input.fromPhone);
  addIfPresent(sessionInput, "correlationId", input.correlationId);
  const started = await service.startSession(sessionInput);
  const responseText = firstCallPromptForStep("acknowledge");

  return {
    session: started.session,
    events: started.events,
    responseText,
    provider: input.provider,
    providerCallId: input.providerCallId,
    route: "first_call_intake",
    nextExpectedInput: "caller_speech",
    voiceResponse: createListenVoiceResponse(responseText),
  };
}

export async function handleTelephonySpeechTurn(
  service: FirstCallService,
  input: TelephonySpeechTurnInput,
): Promise<TelephonySpeechTurnOutput> {
  const transcriptInput = {
    tenantId: input.tenantId,
    sessionId: input.providerCallId,
    transcript: input.transcript,
  };
  addIfPresent(transcriptInput, "correlationId", input.correlationId);
  const output = await service.handleTranscript(transcriptInput);

  const response: TelephonySpeechTurnOutput = {
    session: output.session,
    events: output.events,
    responseText: output.responseText,
    provider: input.provider,
    providerCallId: input.providerCallId,
    route: "first_call_intake",
    nextExpectedInput: output.handoff ? "human_handoff" : "caller_speech",
    decision: output.decision,
    toolResults: output.toolResults,
    voiceResponse: output.handoff
      ? createHandoffVoiceResponse(output.responseText, output.handoff.reason)
      : createListenVoiceResponse(output.responseText),
  };
  if (output.handoff) response.handoff = output.handoff;
  return response;
}

export async function handleTelephonyCallEnd(
  service: FirstCallService,
  input: TelephonyCallEndInput,
): Promise<TelephonyCallEndOutput> {
  const endInput = {
    tenantId: input.tenantId,
    sessionId: input.providerCallId,
  };
  addIfPresent(endInput, "reason", input.reason);
  addIfPresent(endInput, "correlationId", input.correlationId);
  const output = await service.endSession(endInput);

  return {
    session: output.session,
    events: output.events,
    provider: input.provider,
    providerCallId: input.providerCallId,
    ended: true,
    voiceResponse: createHangupVoiceResponse(input.reason),
  };
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
