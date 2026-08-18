export type TwilioVoiceMode = "gather" | "conversation_relay";

export type TwilioConversationRelayConfig = {
  mode: TwilioVoiceMode;
  publicBaseUrl?: string;
  language: string;
  ttsProvider: "Google" | "Amazon" | "ElevenLabs";
  transcriptionProvider: "Google" | "Deepgram";
  interruptSensitivity: "high" | "medium" | "low";
};

export class TwilioConversationRelayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioConversationRelayConfigError";
  }
}

export function createTwilioConversationRelayConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): TwilioConversationRelayConfig {
  const mode = parseVoiceMode(env.TWILIO_VOICE_MODE);
  const config: TwilioConversationRelayConfig = {
    mode,
    language: env.TWILIO_CONVERSATION_RELAY_LANGUAGE?.trim() || "en-US",
    ttsProvider: parseTtsProvider(env.TWILIO_CONVERSATION_RELAY_TTS_PROVIDER),
    transcriptionProvider: parseTranscriptionProvider(
      env.TWILIO_CONVERSATION_RELAY_TRANSCRIPTION_PROVIDER,
    ),
    interruptSensitivity: parseInterruptSensitivity(
      env.TWILIO_CONVERSATION_RELAY_INTERRUPT_SENSITIVITY,
    ),
  };

  const publicBaseUrl = optionalPublicBaseUrl(env.TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL);
  if (publicBaseUrl) config.publicBaseUrl = publicBaseUrl;

  if (mode === "conversation_relay" && !publicBaseUrl) {
    throw new TwilioConversationRelayConfigError(
      "TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL is required when TWILIO_VOICE_MODE=conversation_relay.",
    );
  }
  if (mode === "conversation_relay" && parseHandoffMode(env.TWILIO_HANDOFF_MODE) !== "simulate") {
    throw new TwilioConversationRelayConfigError(
      "ConversationRelay is limited to simulated handoffs until its live handoff callback passes acceptance testing.",
    );
  }

  return config;
}

export function twilioConversationRelaySocketUrl(
  config: TwilioConversationRelayConfig,
  tenantId: string,
): string {
  if (!config.publicBaseUrl) {
    throw new TwilioConversationRelayConfigError("ConversationRelay public base URL is not configured.");
  }
  return `${config.publicBaseUrl}${twilioConversationRelaySocketPath(tenantId)}`;
}

export function twilioConversationRelaySocketPath(tenantId: string): string {
  return `/v1/tenants/${encodeURIComponent(tenantId)}/telephony/twilio/conversation-relay`;
}

export function twilioConversationRelayCompletePath(tenantId: string): string {
  return `${twilioConversationRelaySocketPath(tenantId)}/complete`;
}

function parseVoiceMode(value: string | undefined): TwilioVoiceMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "gather") return "gather";
  if (normalized === "conversation_relay") return normalized;
  throw new TwilioConversationRelayConfigError(
    "TWILIO_VOICE_MODE must be either gather or conversation_relay.",
  );
}

function optionalPublicBaseUrl(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TwilioConversationRelayConfigError(
      "TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL must be a valid wss:// origin.",
    );
  }
  if (parsed.protocol !== "wss:" || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new TwilioConversationRelayConfigError(
      "TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL must be a wss:// origin without a path, query, or fragment.",
    );
  }
  return parsed.origin;
}

function parseTtsProvider(
  value: string | undefined,
): TwilioConversationRelayConfig["ttsProvider"] {
  const normalized = value?.trim() || "ElevenLabs";
  if (normalized === "Google" || normalized === "Amazon" || normalized === "ElevenLabs") {
    return normalized;
  }
  throw new TwilioConversationRelayConfigError(
    "TWILIO_CONVERSATION_RELAY_TTS_PROVIDER must be Google, Amazon, or ElevenLabs.",
  );
}

function parseTranscriptionProvider(
  value: string | undefined,
): TwilioConversationRelayConfig["transcriptionProvider"] {
  const normalized = value?.trim() || "Deepgram";
  if (normalized === "Google" || normalized === "Deepgram") return normalized;
  throw new TwilioConversationRelayConfigError(
    "TWILIO_CONVERSATION_RELAY_TRANSCRIPTION_PROVIDER must be Google or Deepgram.",
  );
}

function parseInterruptSensitivity(
  value: string | undefined,
): TwilioConversationRelayConfig["interruptSensitivity"] {
  const normalized = value?.trim().toLowerCase() || "medium";
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  throw new TwilioConversationRelayConfigError(
    "TWILIO_CONVERSATION_RELAY_INTERRUPT_SENSITIVITY must be high, medium, or low.",
  );
}

function parseHandoffMode(value: string | undefined): "live" | "simulate" {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "live") return "live";
  if (normalized === "simulate") return normalized;
  return "live";
}
