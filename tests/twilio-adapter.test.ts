import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTwilioTwiMl,
  translateTwilioWebhook,
  TwilioWebhookError,
} from "../src/providers/telephony/twilio-adapter.js";
import {
  createHandoffVoiceResponse,
  createHangupVoiceResponse,
  createListenVoiceResponse,
} from "../src/providers/telephony/voice-response.js";

test("Twilio adapter translates initial voice webhook fields into inbound call input", () => {
  const translated = translateTwilioWebhook({
    tenantId: "fh-demo",
    fields: {
      CallSid: "twilio-call-1",
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "ringing",
    },
  });

  assert.deepEqual(translated, {
    kind: "inbound_call",
    input: {
      tenantId: "fh-demo",
      provider: "twilio",
      providerCallId: "twilio-call-1",
      fromPhone: "+15551230000",
      toPhone: "+15559870000",
      correlationId: "twilio-call-1",
    },
  });
});

test("Twilio adapter translates speech gather callbacks into speech turns", () => {
  const translated = translateTwilioWebhook({
    tenantId: "fh-demo",
    fields: {
      CallSid: "twilio-call-1",
      SpeechResult: "My name is Angela Carter. My uncle David Carter passed away at 100 Pine Street.",
      Confidence: "0.91",
    },
  });

  assert.deepEqual(translated, {
    kind: "speech_turn",
    input: {
      tenantId: "fh-demo",
      provider: "twilio",
      providerCallId: "twilio-call-1",
      transcript: "My name is Angela Carter. My uncle David Carter passed away at 100 Pine Street.",
      confidence: 0.91,
      correlationId: "twilio-call-1",
    },
  });
});

test("Twilio adapter translates completed calls into call-end input", () => {
  const translated = translateTwilioWebhook({
    tenantId: "fh-demo",
    fields: {
      CallSid: "twilio-call-1",
      CallStatus: "completed",
    },
  });

  assert.deepEqual(translated, {
    kind: "call_end",
    input: {
      tenantId: "fh-demo",
      provider: "twilio",
      providerCallId: "twilio-call-1",
      reason: "completed",
      correlationId: "twilio-call-1",
    },
  });
});

test("Twilio adapter rejects missing CallSid", () => {
  assert.throws(
    () =>
      translateTwilioWebhook({
        tenantId: "fh-demo",
        fields: {
          From: "+15551230000",
        },
      }),
    TwilioWebhookError,
  );
});

test("Twilio TwiML maps listen responses to Say plus speech Gather", () => {
  const twiml = createTwilioTwiMl({
    voiceResponse: createListenVoiceResponse("I am sorry. I will help get this to the right person."),
    options: {
      actionUrl: "/v1/tenants/fh-demo/telephony/twilio/webhook",
      voice: "alice",
      language: "en-US",
    },
  });

  assert.equal(
    twiml,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="/v1/tenants/fh-demo/telephony/twilio/webhook" method="POST" speechTimeout="auto" timeout="8"><Say voice="alice" language="en-US">I am sorry. I will help get this to the right person.</Say></Gather></Response>',
  );
});

test("Twilio TwiML escapes XML text and hangs up for handoff and hangup responses", () => {
  const handoff = createTwilioTwiMl({
    voiceResponse: createHandoffVoiceResponse("I am connecting you with A&B <Care> now.", "urgent_death_report"),
    options: {
      actionUrl: "/twilio",
    },
  });
  const hangup = createTwilioTwiMl({
    voiceResponse: createHangupVoiceResponse("caller_ended"),
    options: {
      actionUrl: "/twilio",
    },
  });

  assert.equal(
    handoff,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I am connecting you with A&amp;B &lt;Care&gt; now.</Say><Hangup/></Response>',
  );
  assert.equal(hangup, '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
});

test("Twilio TwiML dials phone destinations for human handoff", () => {
  const twiml = createTwilioTwiMl({
    voiceResponse: createHandoffVoiceResponse("I am connecting you now.", "urgent_death_report", {
      destinationType: "on_call_phone",
      destination: "+15555550100",
      queue: "first-call-after-hours",
    }),
    options: {
      actionUrl: "/twilio",
      dialTimeoutSeconds: 18,
    },
  });

  assert.equal(
    twiml,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I am connecting you now.</Say><Dial timeout="18" answerOnBridge="true"><Number>+15555550100</Number></Dial></Response>',
  );
});

test("Twilio TwiML keeps non-phone handoffs as safe hangups", () => {
  const twiml = createTwilioTwiMl({
    voiceResponse: createHandoffVoiceResponse("I am sending this to the dispatch queue.", "urgent_death_report", {
      destinationType: "dispatch_queue",
      destination: "first-call-dispatch",
      queue: "first-call-dispatch",
    }),
    options: {
      actionUrl: "/twilio",
    },
  });

  assert.equal(
    twiml,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I am sending this to the dispatch queue.</Say><Hangup/></Response>',
  );
});
