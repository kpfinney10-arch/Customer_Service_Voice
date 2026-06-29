import type { CallEvent } from "../../events/call-event.js";
import type { CallSession } from "../../session/call-session.js";
import type { FirstCallFlowDecision } from "../../verticals/funeral-home/first-call-flow.js";
import { firstCallPromptForStep } from "../../verticals/funeral-home/first-call-flow.js";
import type { FirstCallService } from "../../api/first-call-service.js";
import type { SpeechAdapters, SpeechToTextOutput, TextToSpeechOutput } from "../speech/speech-adapters.js";
import type { FirstCallHandoffSummary } from "../../verticals/funeral-home/first-call-handoff.js";
import type { HandoffRoutingDecision } from "../../verticals/funeral-home/handoff-routing.js";
import type { ToolResult } from "../../tools/tool-registry.js";
import {
  createHandoffVoiceResponse,
  createHangupVoiceResponse,
  createClosingVoiceResponse,
  createInterruptedVoiceResponse,
  createListenVoiceResponse,
} from "./voice-response.js";
import type { VoiceResponse } from "./voice-response.js";

export const INITIAL_FIRST_CALL_VOICE_PROMPT =
  "I am assisting the funeral director with gathering call information. May I have your name and the best phone number in case we are disconnected?";

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
  nextExpectedInput: "caller_speech" | "human_handoff" | "none";
  decision: FirstCallFlowDecision;
  toolResults: ToolResult<object>[];
  voiceResponse: VoiceResponse;
  handoff?: FirstCallHandoffSummary;
  handoffRouting?: HandoffRoutingDecision;
};

export type TelephonyAudioTurnInput = {
  tenantId: string;
  provider: string;
  providerCallId: string;
  audio: {
    contentType: string;
    bytesBase64: string;
  };
  languageCode?: string;
  voice?: string;
  correlationId?: string;
};

export type TelephonyAudioTurnOutput = TelephonySpeechTurnOutput & {
  stt: SpeechToTextOutput;
  tts: TextToSpeechOutput;
};

export type TelephonyInterruptInput = {
  tenantId: string;
  provider: string;
  providerCallId: string;
  reason: string;
  interruptedOutput?: string;
  correlationId?: string;
};

export type TelephonyInterruptOutput = {
  session: CallSession;
  events: CallEvent[];
  responseText: string;
  provider: string;
  providerCallId: string;
  interrupted: true;
  nextExpectedInput: "caller_speech";
  voiceResponse: VoiceResponse;
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
  const responseText = INITIAL_FIRST_CALL_VOICE_PROMPT;

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
  const closesCall = output.session.currentState === "WRAPUP" || output.session.currentState === "END_CALL";

  const response: TelephonySpeechTurnOutput = {
    session: output.session,
    events: output.events,
    responseText: output.responseText,
    provider: input.provider,
    providerCallId: input.providerCallId,
    route: "first_call_intake",
    nextExpectedInput: output.handoff ? "human_handoff" : closesCall ? "none" : "caller_speech",
    decision: output.decision,
    toolResults: output.toolResults,
    voiceResponse: output.handoff
      ? createHandoffVoiceResponse(output.responseText, output.handoff.reason, output.handoffRouting)
      : closesCall
        ? createClosingVoiceResponse(output.responseText, output.session.currentState.toLowerCase())
      : createListenVoiceResponse(output.responseText),
  };
  if (output.handoff) response.handoff = output.handoff;
  if (output.handoffRouting) response.handoffRouting = output.handoffRouting;
  return response;
}

export async function handleTelephonyAudioTurn(
  service: FirstCallService,
  speechAdapters: SpeechAdapters,
  input: TelephonyAudioTurnInput,
): Promise<TelephonyAudioTurnOutput> {
  const sttInput = {
    tenantId: input.tenantId,
    callId: input.providerCallId,
    audio: input.audio,
  };
  addIfPresent(sttInput, "languageCode", input.languageCode);
  addIfPresent(sttInput, "correlationId", input.correlationId);
  const stt = await speechAdapters.stt.transcribe(sttInput);
  const speechTurnInput = {
    tenantId: input.tenantId,
    provider: input.provider,
    providerCallId: input.providerCallId,
    transcript: stt.transcript,
    confidence: stt.confidence,
    isFinal: stt.isFinal,
  };
  addIfPresent(speechTurnInput, "correlationId", input.correlationId);
  const speechTurn = await handleTelephonySpeechTurn(service, speechTurnInput);
  const ttsInput = {
    tenantId: input.tenantId,
    callId: input.providerCallId,
    text: speechTurn.responseText,
  };
  addIfPresent(ttsInput, "voice", input.voice);
  addIfPresent(ttsInput, "languageCode", input.languageCode);
  addIfPresent(ttsInput, "correlationId", input.correlationId);
  const tts = await speechAdapters.tts.synthesize(ttsInput);

  return {
    ...speechTurn,
    stt,
    tts,
  };
}

export async function handleTelephonyInterrupt(
  service: FirstCallService,
  input: TelephonyInterruptInput,
): Promise<TelephonyInterruptOutput> {
  const interruptInput = {
    tenantId: input.tenantId,
    sessionId: input.providerCallId,
    reason: input.reason,
  };
  addIfPresent(interruptInput, "interruptedOutput", input.interruptedOutput);
  addIfPresent(interruptInput, "correlationId", input.correlationId);
  const output = await service.interruptSession(interruptInput);

  return {
    session: output.session,
    events: output.events,
    responseText: output.responseText,
    provider: input.provider,
    providerCallId: input.providerCallId,
    interrupted: true,
    nextExpectedInput: "caller_speech",
    voiceResponse: createInterruptedVoiceResponse(output.responseText),
  };
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
