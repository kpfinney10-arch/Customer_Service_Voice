import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTwilioConversationRelayCompletionTwiMl,
  createTwilioConversationRelayTwiMl,
  createTwilioHandoffAcceptedTwiMl,
  createTwilioHandoffRejectedTwiMl,
  createTwilioHandoffResultTwiMl,
  createTwilioHandoffScreeningTwiMl,
  createTwilioTwiMl,
  DEFAULT_TWILIO_HANDOFF_FAILURE_MESSAGE,
  DEFAULT_TWILIO_SIMULATED_HANDOFF_MESSAGE,
  DEFAULT_TWILIO_SPEECH_HINTS,
  DEFAULT_TWILIO_SPEECH_TIMEOUT_SECONDS,
  translateTwilioHandoffDialResult,
  translateTwilioHandoffScreeningDecision,
  translateTwilioWebhook,
  TwilioWebhookError,
} from "../src/providers/telephony/twilio-adapter.js";
import {
  createHandoffVoiceResponse,
  createHangupVoiceResponse,
  createListenVoiceResponse,
} from "../src/providers/telephony/voice-response.js";

test("Twilio speech hints include pricing and no-death language", () => {
  assert.equal(DEFAULT_TWILIO_SPEECH_HINTS.includes("no one"), true);
  assert.equal(DEFAULT_TWILIO_SPEECH_HINTS.includes("cremation"), true);
  assert.equal(DEFAULT_TWILIO_SPEECH_HINTS.includes("pricing"), true);
  assert.equal(DEFAULT_TWILIO_SPEECH_HINTS.includes("cost"), true);
});

test("Twilio adapter creates a natural-voice ConversationRelay connection without Gather", () => {
  const twiml = createTwilioConversationRelayTwiMl({
    websocketUrl: "wss://voice.lanternbell.com/v1/tenants/fh-demo/telephony/twilio/conversation-relay",
    actionUrl: "/v1/tenants/fh-demo/telephony/twilio/conversation-relay/complete",
    welcomeGreeting: "I am an automated assistant helping the funeral director. How may I help you today?",
    tenantId: "fh-demo",
    config: {
      mode: "conversation_relay",
      publicBaseUrl: "wss://voice.lanternbell.com",
      language: "en-US",
      ttsProvider: "ElevenLabs",
      transcriptionProvider: "Deepgram",
      speechModel: "flux",
      eotThreshold: "0.85",
      interruptSensitivity: "medium",
    },
  });

  assert.match(twiml, /<Connect action="[^"]+" method="POST">/);
  assert.match(twiml, /<ConversationRelay /);
  assert.match(twiml, /ttsProvider="ElevenLabs"/);
  assert.match(twiml, /transcriptionProvider="Deepgram"/);
  assert.match(twiml, /speechModel="flux"/);
  assert.match(twiml, /eotThreshold="0.85"/);
  assert.match(twiml, /interruptible="speech"/);
  assert.match(twiml, /<Parameter name="tenantId" value="fh-demo"\/>/);
  assert.doesNotMatch(twiml, /<Gather|<Dial/);
});

test("Twilio ConversationRelay completion responses fail closed without dialing", () => {
  for (const reason of ["handoff", "pricing_blocked", "completed", "technical_failure"] as const) {
    const twiml = createTwilioConversationRelayCompletionTwiMl(reason);
    assert.match(twiml, /<Say>/);
    assert.match(twiml, /<Hangup\/>/);
    assert.doesNotMatch(twiml, /<Gather|<Dial/);
  }
});

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

test("Twilio adapter translates empty gather callbacks without restarting intake", () => {
  const translated = translateTwilioWebhook({
    tenantId: "fh-demo",
    fields: {
      CallSid: "twilio-call-empty-1",
      CallStatus: "in-progress",
      SpeechResult: "",
    },
  });

  assert.deepEqual(translated, {
    kind: "empty_speech",
    providerCallId: "twilio-call-empty-1",
    correlationId: "twilio-call-empty-1",
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

test("Twilio adapter translates handoff screening acceptance, rejection, and timeout", () => {
  assert.deepEqual(
    translateTwilioHandoffScreeningDecision({
      ParentCallSid: "parent-call-1",
      CallSid: "screened-call-1",
      Digits: "1",
    }),
    {
      sessionId: "parent-call-1",
      correlationId: "screened-call-1",
      outcome: "accepted",
      succeeded: true,
    },
  );
  assert.deepEqual(
    translateTwilioHandoffScreeningDecision({
      ParentCallSid: "parent-call-1",
      CallSid: "screened-call-2",
      Digits: "2",
    }),
    {
      sessionId: "parent-call-1",
      correlationId: "screened-call-2",
      outcome: "rejected",
      succeeded: false,
    },
  );
  assert.deepEqual(
    translateTwilioHandoffScreeningDecision({
      ParentCallSid: "parent-call-1",
      CallSid: "screened-call-3",
    }),
    {
      sessionId: "parent-call-1",
      correlationId: "screened-call-3",
      outcome: "no_input",
      succeeded: false,
    },
  );
});

test("Twilio adapter validates final dial handoff statuses", () => {
  assert.deepEqual(
    translateTwilioHandoffDialResult({
      CallSid: "parent-call-1",
      DialCallSid: "screened-call-1",
      DialCallStatus: "no-answer",
    }),
    {
      sessionId: "parent-call-1",
      correlationId: "screened-call-1",
      dialStatus: "no_answer",
    },
  );
  assert.throws(
    () =>
      translateTwilioHandoffDialResult({
        CallSid: "parent-call-1",
        DialCallStatus: "ringing",
      }),
    /DialCallStatus is not supported/,
  );
});

test("Twilio TwiML maps listen responses to Say plus speech Gather", () => {
  const twiml = createTwilioTwiMl({
    voiceResponse: createListenVoiceResponse("I am assisting the funeral director with gathering call information."),
    options: {
      actionUrl: "/v1/tenants/fh-demo/telephony/twilio/webhook",
      voice: "alice",
      language: "en-US",
    },
  });

  assert.equal(
    twiml,
    `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" action="/v1/tenants/fh-demo/telephony/twilio/webhook" method="POST" speechTimeout="${DEFAULT_TWILIO_SPEECH_TIMEOUT_SECONDS}" timeout="8" actionOnEmptyResult="true" hints="${DEFAULT_TWILIO_SPEECH_HINTS.join(",")}"><Say voice="alice" language="en-US">I am assisting the funeral director with gathering call information.</Say></Gather></Response>`,
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

test("Twilio TwiML records demo handoffs without dialing a phone destination", () => {
  const twiml = createTwilioTwiMl({
    voiceResponse: createHandoffVoiceResponse("I am connecting you now.", "urgent_death_report", {
      destinationType: "on_call_phone",
      destination: "+15555550100",
      queue: "first-call-after-hours",
    }),
    options: {
      actionUrl: "/twilio",
      handoffMode: "simulate",
    },
  });

  assert.equal(
    twiml,
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${DEFAULT_TWILIO_SIMULATED_HANDOFF_MESSAGE}</Say><Hangup/></Response>`,
  );
  assert.doesNotMatch(twiml, /<Dial/);
  assert.doesNotMatch(twiml, /\+15555550100/);
});

test("Twilio TwiML adds called-party screening URL for warm handoff", () => {
  const twiml = createTwilioTwiMl({
    voiceResponse: createHandoffVoiceResponse("I am connecting you now.", "urgent_death_report", {
      destinationType: "on_call_phone",
      destination: "+15555550100",
      queue: "first-call-after-hours",
    }),
    options: {
      actionUrl: "/twilio",
      handoffScreeningUrl: "/v1/tenants/fh-demo/telephony/twilio/handoff-screen",
      handoffResultUrl: "/v1/tenants/fh-demo/telephony/twilio/handoff-result",
    },
  });

  assert.equal(
    twiml,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I am connecting you now.</Say><Dial timeout="25" answerOnBridge="true" action="/v1/tenants/fh-demo/telephony/twilio/handoff-result" method="POST"><Number url="/v1/tenants/fh-demo/telephony/twilio/handoff-screen" method="POST">+15555550100</Number></Dial></Response>',
  );
});

test("Twilio handoff screening TwiML prompts called party to accept", () => {
  const screening = createTwilioHandoffScreeningTwiMl({
    summaryText: "Incoming funeral home handoff. Caller Sarah. Deceased Robert.",
    acceptUrl: "/v1/tenants/fh-demo/telephony/twilio/handoff-accept",
  });
  const accepted = createTwilioHandoffAcceptedTwiMl();
  const rejected = createTwilioHandoffRejectedTwiMl();
  const connected = createTwilioHandoffResultTwiMl({ succeeded: true });
  const unavailable = createTwilioHandoffResultTwiMl({ succeeded: false });

  assert.equal(
    screening,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="1" action="/v1/tenants/fh-demo/telephony/twilio/handoff-accept" method="POST" timeout="8" actionOnEmptyResult="true"><Say>Incoming funeral home handoff. Caller Sarah. Deceased Robert. Press 1 to accept this call.</Say></Gather><Say>No input received. Goodbye.</Say><Hangup/></Response>',
  );
  assert.equal(accepted, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting now.</Say></Response>');
  assert.equal(
    rejected,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call will not be connected. Goodbye.</Say><Hangup/></Response>',
  );
  assert.equal(connected, '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
  assert.equal(
    unavailable,
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${DEFAULT_TWILIO_HANDOFF_FAILURE_MESSAGE}</Say><Hangup/></Response>`,
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
