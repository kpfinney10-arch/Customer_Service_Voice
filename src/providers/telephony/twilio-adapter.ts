import type {
  InboundTelephonyCallInput,
  TelephonyCallEndInput,
  TelephonySpeechTurnInput,
} from "./inbound-call.js";
import type { VoiceResponse, VoiceResponseAction } from "./voice-response.js";

export type TwilioWebhookFields = Record<string, string>;

export type TwilioWebhookTranslation =
  | {
      kind: "inbound_call";
      input: InboundTelephonyCallInput;
    }
  | {
      kind: "speech_turn";
      input: TelephonySpeechTurnInput;
    }
  | {
      kind: "call_end";
      input: TelephonyCallEndInput;
    }
  | {
      kind: "empty_speech";
      providerCallId: string;
      correlationId: string;
    };

export type TwilioTwiMlOptions = {
  actionUrl: string;
  method?: "POST";
  voice?: string;
  language?: string;
  handoffMode?: TwilioHandoffMode;
  speechTimeout?: "auto" | number;
  timeoutSeconds?: number;
  dialTimeoutSeconds?: number;
  actionOnEmptyResult?: boolean;
  hints?: string[];
  handoffScreeningUrl?: string;
  handoffResultUrl?: string;
};

export type TwilioHandoffMode = "live" | "simulate";

export const DEFAULT_TWILIO_SPEECH_TIMEOUT_SECONDS = 2;
export const DEFAULT_TWILIO_SIMULATED_HANDOFF_MESSAGE =
  "This demo has recorded that a funeral home team member should follow up. No live transfer will be placed.";
export const DEFAULT_TWILIO_HANDOFF_FAILURE_MESSAGE =
  "I am sorry, no team member was available to take the transfer. Your information has been recorded for urgent follow-up. If you need immediate emergency assistance, please call 911.";

export type TwilioHandoffScreeningDecision = {
  sessionId: string;
  correlationId: string;
  outcome: "accepted" | "rejected" | "no_input";
  succeeded: boolean;
};

export type TwilioHandoffDialResult = {
  sessionId: string;
  correlationId: string;
  dialStatus: "completed" | "busy" | "no_answer" | "failed" | "canceled";
};

export const DEFAULT_TWILIO_SPEECH_HINTS = [
  "caller name",
  "decedent name",
  "passed away",
  "died",
  "death",
  "father",
  "mother",
  "husband",
  "wife",
  "son",
  "daughter",
  "address",
  "street",
  "road",
  "avenue",
  "drive",
  "lane",
  "boulevard",
  "hospital",
  "hospice",
  "nursing home",
  "funeral home",
];

export class TwilioWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioWebhookError";
  }
}

export function translateTwilioWebhook(input: {
  tenantId: string;
  fields: TwilioWebhookFields;
}): TwilioWebhookTranslation {
  const callSid = requiredString(input.fields.CallSid, "CallSid");
  const callStatus = optionalString(input.fields.CallStatus);
  const speechResult = optionalString(input.fields.SpeechResult);
  const correlationId = optionalString(input.fields.SmsSid) ?? optionalString(input.fields.MessageSid) ?? callSid;

  if (isEmptyGatherCallback(input.fields, callStatus, speechResult)) {
    return {
      kind: "empty_speech",
      providerCallId: callSid,
      correlationId,
    };
  }

  if (isCompletedCallStatus(callStatus) && !speechResult) {
    const callEndInput: TelephonyCallEndInput = {
      tenantId: input.tenantId,
      provider: "twilio",
      providerCallId: callSid,
    };
    addIfPresent(callEndInput, "reason", callStatus);
    addIfPresent(callEndInput, "correlationId", correlationId);
    return {
      kind: "call_end",
      input: callEndInput,
    };
  }

  if (speechResult) {
    const speechTurnInput: TelephonySpeechTurnInput = {
      tenantId: input.tenantId,
      provider: "twilio",
      providerCallId: callSid,
      transcript: speechResult,
    };
    addIfPresent(speechTurnInput, "confidence", optionalNumberString(input.fields.Confidence));
    addIfPresent(speechTurnInput, "correlationId", correlationId);
    return {
      kind: "speech_turn",
      input: speechTurnInput,
    };
  }

  const inboundCallInput: InboundTelephonyCallInput = {
    tenantId: input.tenantId,
    provider: "twilio",
    providerCallId: callSid,
  };
  addIfPresent(inboundCallInput, "fromPhone", optionalString(input.fields.From));
  addIfPresent(inboundCallInput, "toPhone", optionalString(input.fields.To));
  addIfPresent(inboundCallInput, "correlationId", correlationId);
  return {
    kind: "inbound_call",
    input: inboundCallInput,
  };
}

export function translateTwilioHandoffScreeningDecision(
  fields: TwilioWebhookFields,
): TwilioHandoffScreeningDecision {
  const sessionId = requiredString(fields.ParentCallSid, "ParentCallSid");
  const correlationId = optionalString(fields.CallSid) ?? sessionId;
  const digits = optionalString(fields.Digits);
  if (digits === "1") {
    return { sessionId, correlationId, outcome: "accepted", succeeded: true };
  }
  return {
    sessionId,
    correlationId,
    outcome: digits ? "rejected" : "no_input",
    succeeded: false,
  };
}

export function translateTwilioHandoffDialResult(fields: TwilioWebhookFields): TwilioHandoffDialResult {
  const sessionId = requiredString(fields.CallSid, "CallSid");
  const correlationId = optionalString(fields.DialCallSid) ?? sessionId;
  const rawStatus = requiredString(fields.DialCallStatus, "DialCallStatus");
  const dialStatus = rawStatus === "no-answer" ? "no_answer" : rawStatus;
  if (
    dialStatus !== "completed" &&
    dialStatus !== "busy" &&
    dialStatus !== "no_answer" &&
    dialStatus !== "failed" &&
    dialStatus !== "canceled"
  ) {
    throw new TwilioWebhookError("DialCallStatus is not supported.");
  }
  return { sessionId, correlationId, dialStatus };
}

export function createTwilioTwiMl(input: {
  voiceResponse: VoiceResponse;
  options: TwilioTwiMlOptions;
}): string {
  if (
    input.options.handoffMode === "simulate" &&
    input.voiceResponse.actions.some((action) => action.type === "handoff")
  ) {
    return xmlResponse(
      sayElement(DEFAULT_TWILIO_SIMULATED_HANDOFF_MESSAGE, input.options) + hangupElement(),
    );
  }

  const body: string[] = [];
  let pendingSay: string | undefined;

  for (const action of input.voiceResponse.actions) {
    if (action.type === "say") {
      pendingSay = pendingSay ? `${pendingSay} ${action.text}` : action.text;
      continue;
    }
    if (action.type === "listen") {
      body.push(gatherElement(pendingSay ?? "", input.options));
      pendingSay = undefined;
      continue;
    }
    if (action.type === "handoff") {
      if (pendingSay) {
        body.push(sayElement(pendingSay, input.options));
        pendingSay = undefined;
      }
      body.push(handoffElement(action, input.options));
      continue;
    }
    if (action.type === "hangup") {
      if (pendingSay) {
        body.push(sayElement(pendingSay, input.options));
        pendingSay = undefined;
      }
      body.push(hangupElement());
      continue;
    }
    handleStopAction(action);
  }

  if (pendingSay) body.push(sayElement(pendingSay, input.options));
  return xmlResponse(body.join(""));
}

function gatherElement(prompt: string, options: TwilioTwiMlOptions): string {
  const attributes = {
    input: "speech",
    action: options.actionUrl,
    method: options.method ?? "POST",
    speechTimeout: String(options.speechTimeout ?? DEFAULT_TWILIO_SPEECH_TIMEOUT_SECONDS),
    timeout: String(options.timeoutSeconds ?? 8),
    actionOnEmptyResult: String(options.actionOnEmptyResult ?? true),
    hints: (options.hints ?? DEFAULT_TWILIO_SPEECH_HINTS).join(","),
  };
  return `<Gather${xmlAttributes(attributes)}>${prompt ? sayElement(prompt, options) : ""}</Gather>`;
}

function sayElement(text: string, options: TwilioTwiMlOptions): string {
  const attributes: Record<string, string> = {};
  addIfPresent(attributes, "voice", options.voice);
  addIfPresent(attributes, "language", options.language);
  return `<Say${xmlAttributes(attributes)}>${escapeXml(text)}</Say>`;
}

function hangupElement(): string {
  return "<Hangup/>";
}

export function createTwilioHandoffScreeningTwiMl(input: {
  summaryText: string;
  acceptUrl: string;
  acceptDigit?: string;
  timeoutSeconds?: number;
  voice?: string;
  language?: string;
}): string {
  const acceptDigit = input.acceptDigit ?? "1";
  const gatherAttributes = {
    input: "dtmf",
    numDigits: "1",
    action: input.acceptUrl,
    method: "POST",
    timeout: String(input.timeoutSeconds ?? 8),
    actionOnEmptyResult: "true",
  };
  const options = {
    actionUrl: input.acceptUrl,
  };
  addIfPresent(options, "voice", input.voice);
  addIfPresent(options, "language", input.language);
  return xmlResponse(
    `<Gather${xmlAttributes(gatherAttributes)}>${sayElement(`${input.summaryText} Press ${acceptDigit} to accept this call.`, options)}</Gather>` +
      `${sayElement("No input received. Goodbye.", options)}${hangupElement()}`,
  );
}

export function createTwilioHandoffAcceptedTwiMl(input: {
  text?: string;
  voice?: string;
  language?: string;
} = {}): string {
  const options = { actionUrl: "" };
  addIfPresent(options, "voice", input.voice);
  addIfPresent(options, "language", input.language);
  return xmlResponse(sayElement(input.text ?? "Connecting now.", options));
}

export function createTwilioHandoffRejectedTwiMl(input: {
  text?: string;
  voice?: string;
  language?: string;
} = {}): string {
  const options = { actionUrl: "" };
  addIfPresent(options, "voice", input.voice);
  addIfPresent(options, "language", input.language);
  return xmlResponse(
    sayElement(input.text ?? "This call will not be connected. Goodbye.", options) + hangupElement(),
  );
}

export function createTwilioHandoffResultTwiMl(input: {
  succeeded: boolean;
  failureText?: string;
  voice?: string;
  language?: string;
}): string {
  if (input.succeeded) return xmlResponse(hangupElement());
  const options = { actionUrl: "" };
  addIfPresent(options, "voice", input.voice);
  addIfPresent(options, "language", input.language);
  return xmlResponse(
    sayElement(input.failureText ?? DEFAULT_TWILIO_HANDOFF_FAILURE_MESSAGE, options) + hangupElement(),
  );
}

function handoffElement(action: Extract<VoiceResponseAction, { type: "handoff" }>, options: TwilioTwiMlOptions): string {
  if (isPhoneHandoff(action)) {
    return dialElement(action.destination, options);
  }
  return hangupElement();
}

function dialElement(phoneNumber: string, options: TwilioTwiMlOptions): string {
  const attributes = {
    timeout: String(options.dialTimeoutSeconds ?? 25),
    answerOnBridge: "true",
    action: options.handoffResultUrl,
    method: options.handoffResultUrl ? options.method ?? "POST" : undefined,
  };
  const numberAttributes = {
    url: options.handoffScreeningUrl,
    method: options.handoffScreeningUrl ? options.method ?? "POST" : undefined,
  };
  return `<Dial${xmlAttributes(attributes)}><Number${xmlAttributes(numberAttributes)}>${escapeXml(phoneNumber)}</Number></Dial>`;
}

function xmlResponse(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function xmlAttributes(attributes: Record<string, string | undefined>): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => ` ${key}="${escapeXml(value ?? "")}"`)
    .join("");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isCompletedCallStatus(status: string | undefined): boolean {
  return status === "completed" || status === "busy" || status === "failed" || status === "no-answer" || status === "canceled";
}

function isEmptyGatherCallback(
  fields: TwilioWebhookFields,
  callStatus: string | undefined,
  speechResult: string | undefined,
): boolean {
  if (speechResult) return false;
  if (Object.hasOwn(fields, "SpeechResult")) return true;
  return callStatus === "in-progress" && !optionalString(fields.From) && !optionalString(fields.To);
}

function handleStopAction(_action: Extract<VoiceResponseAction, { type: "stop" }>): void {
  // TwiML is request/response based; there is no current server-side media stream to stop here.
}

function isPhoneHandoff(action: Extract<VoiceResponseAction, { type: "handoff" }>): action is Extract<
  VoiceResponseAction,
  { type: "handoff" }
> & { destination: string } {
  return (
    (action.destinationType === "on_call_phone" || action.destinationType === "dispatch_desk_phone") &&
    typeof action.destination === "string" &&
    action.destination.trim().length > 0
  );
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TwilioWebhookError(`${field} is required.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumberString(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
