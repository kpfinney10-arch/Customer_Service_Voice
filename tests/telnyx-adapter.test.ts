import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTelnyxCommands,
  TelnyxWebhookError,
  translateTelnyxWebhook,
} from "../src/providers/telephony/telnyx-adapter.js";
import { createHangupVoiceResponse, createListenVoiceResponse } from "../src/providers/telephony/voice-response.js";

test("Telnyx adapter translates call.initiated into generic inbound call input", () => {
  const translated = translateTelnyxWebhook({
    tenantId: "fh-demo",
    payload: {
      data: {
        id: "event-1",
        event_type: "call.initiated",
        payload: {
          call_control_id: "telnyx-call-1",
          from: "+15551230000",
          to: "+15559870000",
        },
      },
    },
  });

  assert.deepEqual(translated, {
    kind: "inbound_call",
    input: {
      tenantId: "fh-demo",
      provider: "telnyx",
      providerCallId: "telnyx-call-1",
      fromPhone: "+15551230000",
      toPhone: "+15559870000",
      correlationId: "event-1",
    },
  });
});

test("Telnyx adapter translates call.hangup into generic call-end input", () => {
  const translated = translateTelnyxWebhook({
    tenantId: "fh-demo",
    payload: {
      data: {
        id: "event-2",
        event_type: "call.hangup",
        payload: {
          call_control_id: "telnyx-call-1",
          hangup_cause: "normal_clearing",
        },
      },
    },
  });

  assert.deepEqual(translated, {
    kind: "call_end",
    input: {
      tenantId: "fh-demo",
      provider: "telnyx",
      providerCallId: "telnyx-call-1",
      reason: "normal_clearing",
      correlationId: "event-2",
    },
  });
});

test("Telnyx adapter translates call.ai_gather.ended into generic speech-turn input", () => {
  const translated = translateTelnyxWebhook({
    tenantId: "fh-demo",
    payload: {
      data: {
        id: "event-3",
        event_type: "call.ai_gather.ended",
        payload: {
          call_control_id: "telnyx-call-1",
          message_history: [
            {
              role: "assistant",
              content: "How can I help?",
            },
            {
              role: "user",
              content: "My name is Angela Carter. My uncle David Carter passed away at 100 Pine Street.",
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(translated, {
    kind: "speech_turn",
    input: {
      tenantId: "fh-demo",
      provider: "telnyx",
      providerCallId: "telnyx-call-1",
      transcript: "My name is Angela Carter. My uncle David Carter passed away at 100 Pine Street.",
      correlationId: "event-3",
    },
  });
});

test("Telnyx adapter ignores unsupported events without failing", () => {
  const translated = translateTelnyxWebhook({
    tenantId: "fh-demo",
    payload: {
      data: {
        event_type: "call.speak.ended",
        payload: {
          call_control_id: "telnyx-call-1",
        },
      },
    },
  });

  assert.deepEqual(translated, {
    kind: "ignored",
    eventType: "call.speak.ended",
  });
});

test("Telnyx adapter rejects malformed required webhook fields", () => {
  assert.throws(
    () =>
      translateTelnyxWebhook({
        tenantId: "fh-demo",
        payload: {
          data: {
            event_type: "call.initiated",
            payload: {},
          },
        },
      }),
    TelnyxWebhookError,
  );
});

test("Telnyx command adapter maps listen voice responses to gather_using_speak", () => {
  const commands = createTelnyxCommands({
    callControlId: "telnyx-call-1",
    voiceResponse: createListenVoiceResponse("I am assisting the funeral director with gathering call information."),
    commandIdPrefix: "cmd-1",
    answerFirst: true,
    gatherStrategy: {
      command: "gather_using_speak",
      language: "en-US",
      voice: "female",
      timeoutMillis: 8000,
      maximumDigits: 1,
    },
  });

  assert.deepEqual(commands, [
    {
      command: "answer",
      callControlId: "telnyx-call-1",
      payload: {
        command_id: "cmd-1-1",
      },
    },
    {
      command: "gather_using_speak",
      callControlId: "telnyx-call-1",
      payload: {
        payload: "I am assisting the funeral director with gathering call information.",
        language: "en-US",
        voice: "female",
        maximum_digits: 1,
        timeout_millis: 8000,
        command_id: "cmd-1-2",
      },
    },
  ]);
});

test("Telnyx command adapter maps hangup responses to hangup commands", () => {
  const commands = createTelnyxCommands({
    callControlId: "telnyx-call-1",
    voiceResponse: createHangupVoiceResponse("caller_ended"),
  });

  assert.deepEqual(commands, [
    {
      command: "hangup",
      callControlId: "telnyx-call-1",
      payload: {
        cause: "caller_ended",
      },
    },
  ]);
});
