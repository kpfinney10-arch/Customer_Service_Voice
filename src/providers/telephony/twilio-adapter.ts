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
    };

export type TwilioTwiMlOptions = {
  actionUrl: string;
  method?: "POST";
  voice?: string;
  language?: string;
  speechTimeout?: "auto" | number;
  timeoutSeconds?: number;
};

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

export function createTwilioTwiMl(input: {
  voiceResponse: VoiceResponse;
  options: TwilioTwiMlOptions;
}): string {
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
      body.push(hangupElement());
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
    speechTimeout: String(options.speechTimeout ?? "auto"),
    timeout: String(options.timeoutSeconds ?? 8),
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

function handleStopAction(_action: Extract<VoiceResponseAction, { type: "stop" }>): void {
  // TwiML is request/response based; there is no current server-side media stream to stop here.
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
