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
    voiceResponse: createListenVoiceResponse("I am sorry. I will help get this to the right person."),
    commandIdPrefix: "cmd-1",
    answerFirst: true,
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
        payload: "I am sorry. I will help get this to the right person.",
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
