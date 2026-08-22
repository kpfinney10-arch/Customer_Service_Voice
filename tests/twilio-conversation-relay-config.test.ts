import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTwilioConversationRelayConfigFromEnv,
  twilioConversationRelayCompletePath,
  twilioConversationRelaySocketUrl,
  TwilioConversationRelayConfigError,
} from "../src/providers/telephony/twilio-conversation-relay-config.js";

test("ConversationRelay remains disabled by default", () => {
  const config = createTwilioConversationRelayConfigFromEnv({});
  assert.equal(config.mode, "gather");
  assert.equal(config.publicBaseUrl, undefined);
  assert.equal(config.ttsProvider, "ElevenLabs");
  assert.equal(config.transcriptionProvider, "Deepgram");
  assert.equal(config.speechModel, "flux");
  assert.equal(config.eotThreshold, "0.85");
  assert.equal(config.interruptSensitivity, "medium");
});

test("ConversationRelay validates patient Deepgram Flux turn detection", () => {
  const config = createTwilioConversationRelayConfigFromEnv({
    TWILIO_CONVERSATION_RELAY_SPEECH_MODEL: "FLUX",
    TWILIO_CONVERSATION_RELAY_EOT_THRESHOLD: "0.90",
  });
  assert.equal(config.speechModel, "flux");
  assert.equal(config.eotThreshold, "0.9");

  for (const eotThreshold of ["0.49", "0.91", "not-a-number"]) {
    assert.throws(
      () => createTwilioConversationRelayConfigFromEnv({
        TWILIO_CONVERSATION_RELAY_EOT_THRESHOLD: eotThreshold,
      }),
      /number from 0.5 through 0.9/,
    );
  }
  assert.throws(
    () => createTwilioConversationRelayConfigFromEnv({
      TWILIO_CONVERSATION_RELAY_SPEECH_MODEL: "nova-3",
    }),
    /must be flux/,
  );
});

test("ConversationRelay omits Deepgram-only tuning for Google transcription", () => {
  const config = createTwilioConversationRelayConfigFromEnv({
    TWILIO_CONVERSATION_RELAY_TRANSCRIPTION_PROVIDER: "Google",
  });
  assert.equal(config.speechModel, undefined);
  assert.equal(config.eotThreshold, undefined);

  assert.throws(
    () => createTwilioConversationRelayConfigFromEnv({
      TWILIO_CONVERSATION_RELAY_TRANSCRIPTION_PROVIDER: "Google",
      TWILIO_CONVERSATION_RELAY_EOT_THRESHOLD: "0.85",
    }),
    /requires the Deepgram transcription provider/,
  );
});

test("ConversationRelay requires a secure public origin and simulated handoffs", () => {
  assert.throws(
    () => createTwilioConversationRelayConfigFromEnv({
      TWILIO_VOICE_MODE: "conversation_relay",
      TWILIO_HANDOFF_MODE: "simulate",
    }),
    TwilioConversationRelayConfigError,
  );
  assert.throws(
    () => createTwilioConversationRelayConfigFromEnv({
      TWILIO_VOICE_MODE: "conversation_relay",
      TWILIO_HANDOFF_MODE: "live",
      TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL: "wss://voice.lanternbell.com",
    }),
    /limited to simulated handoffs/,
  );
  assert.throws(
    () => createTwilioConversationRelayConfigFromEnv({
      TWILIO_VOICE_MODE: "conversation_relay",
      TWILIO_HANDOFF_MODE: "simulate",
      TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL: "https://voice.lanternbell.com",
    }),
    /wss:\/\//,
  );
});

test("ConversationRelay builds tenant-scoped socket and completion paths", () => {
  const config = createTwilioConversationRelayConfigFromEnv({
    TWILIO_VOICE_MODE: "conversation_relay",
    TWILIO_HANDOFF_MODE: "simulate",
    TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL: "wss://voice.lanternbell.com/",
  });
  assert.equal(
    twilioConversationRelaySocketUrl(config, "funeral home/a"),
    "wss://voice.lanternbell.com/v1/tenants/funeral%20home%2Fa/telephony/twilio/conversation-relay",
  );
  assert.equal(
    twilioConversationRelayCompletePath("fh-demo"),
    "/v1/tenants/fh-demo/telephony/twilio/conversation-relay/complete",
  );
});
