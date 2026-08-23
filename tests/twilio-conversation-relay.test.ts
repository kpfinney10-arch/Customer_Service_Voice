import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createApiServer, listen } from "../src/api/http-server.js";
import { createFirstCallService } from "../src/api/first-call-service.js";
import { InMemoryEventStore } from "../src/events/in-memory-event-store.js";
import { createNoopLogger } from "../src/observability/logger.js";
import {
  createTwilioWebhookSignature,
  HmacWebhookSignatureVerifier,
} from "../src/security/webhook-signature.js";
import { InMemorySessionStore } from "../src/session/in-memory-session-store.js";
import { createDefaultTenantConfigStore } from "../src/tenants/tenant-config.js";

test("ConversationRelay routes a pricing prompt through the deterministic orchestrator and fails closed", async () => {
  const tenantConfigStore = createDefaultTenantConfigStore();
  const eventStore = new InMemoryEventStore();
  const service = createFirstCallService({
    store: new InMemorySessionStore(),
    eventStore,
    tenantConfigStore,
  });
  const authToken = "conversation-relay-test-auth-token";
  const server = createApiServer({
    service,
    tenantConfigStore,
    webhookSignatureVerifier: new HmacWebhookSignatureVerifier({ twilio: authToken }),
    logger: createNoopLogger(),
    twilioReadiness: {
      provider: "twilio",
      mode: "signed_webhook",
      handoffMode: "simulate",
      readyForLocalTesting: true,
      readyForPublicTraffic: true,
      checks: [],
    },
    twilioConversationRelayConfig: {
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
  const localUrl = await listen(server, 0);
  const callSid = "CAconversationrelaypricing000000000001";
  let webSocket: WebSocket | undefined;

  try {
    const webhookPath = "/v1/tenants/fh-demo/telephony/twilio/webhook";
    const openingBody = new URLSearchParams({
      CallSid: callSid,
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "ringing",
    });
    const opening = await fetch(`${localUrl}${webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `${localUrl}${webhookPath}`,
          rawBody: openingBody.toString(),
        }),
      },
      body: openingBody,
    });
    const openingTwiml = await opening.text();
    assert.equal(opening.status, 200);
    assert.match(openingTwiml, /<ConversationRelay /);
    assert.match(openingTwiml, /ttsProvider="ElevenLabs"/);
    assert.match(openingTwiml, /speechModel="flux"/);
    assert.match(openingTwiml, /eotThreshold="0.85"/);
    assert.doesNotMatch(openingTwiml, /<Gather|<Dial/);

    const relayPath = "/v1/tenants/fh-demo/telephony/twilio/conversation-relay";
    webSocket = new WebSocket(localUrl.replace(/^http/, "ws") + relayPath, {
      headers: {
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `wss://voice.lanternbell.com${relayPath}`,
          rawBody: "",
        }),
      },
    });
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid,
      customParameters: { tenantId: "fh-demo" },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "No one has passed away. I need cremation pricing.",
      lang: "en-US",
      last: true,
    }));

    const terminal = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      handoffData: string;
    };
    assert.equal(terminal.type, "end");
    assert.deepEqual(JSON.parse(terminal.handoffData), { reasonCode: "pricing_blocked" });

    const completionPath = `${relayPath}/complete`;
    const completionBody = new URLSearchParams({
      CallSid: callSid,
      HandoffData: terminal.handoffData,
    });
    const completion = await fetch(
      `${localUrl}${completionPath}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": createTwilioWebhookSignature({
            authToken,
            url: `${localUrl}${completionPath}`,
            rawBody: completionBody.toString(),
          }),
        },
        body: completionBody,
      },
    );
    const completionTwiml = await completion.text();
    assert.equal(completion.status, 200);
    assert.match(completionTwiml, /I cannot provide pricing/);
    assert.match(completionTwiml, /<Hangup\/>/);
    assert.doesNotMatch(completionTwiml, /<Gather|<Dial/);

    const events = await eventStore.listBySession("fh-demo", callSid);
    const transcriptEvent = events.find((event) => event.eventType === "TRANSCRIPT_RECEIVED");
    assert.deepEqual(transcriptEvent?.payload, {
      transcriptRetained: false,
      redactionCategories: [],
    });

    await closeWebSocket(webSocket);
    const interruptionCallSid = "CAconversationrelayinterrupt0000000001";
    const interruptionOpeningBody = new URLSearchParams({
      CallSid: interruptionCallSid,
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "ringing",
    });
    const interruptionOpening = await fetch(`${localUrl}${webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `${localUrl}${webhookPath}`,
          rawBody: interruptionOpeningBody.toString(),
        }),
      },
      body: interruptionOpeningBody,
    });
    assert.equal(interruptionOpening.status, 200);

    webSocket = new WebSocket(localUrl.replace(/^http/, "ws") + relayPath, {
      headers: {
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `wss://voice.lanternbell.com${relayPath}`,
          rawBody: "",
        }),
      },
    });
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid: interruptionCallSid,
      customParameters: { tenantId: "fh-demo" },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "My father passed away at home.",
      lang: "en-US",
      last: true,
    }));
    const spoken = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
      last: boolean;
      interruptible: boolean;
    };
    assert.equal(spoken.type, "text");
    assert.equal(spoken.last, true);
    assert.equal(spoken.interruptible, true);
    assert.match(spoken.token, /name and the best phone number/i);

    webSocket.send(JSON.stringify({
      type: "interrupt",
      utteranceUntilInterrupt: "May I have your",
      durationUntilInterruptMs: 420,
    }));
    await waitForEvent(eventStore, interruptionCallSid, "CALL_INTERRUPTED");

    await closeWebSocket(webSocket);
    const spokenPhoneCallSid = "CAconversationrelayspokenphone00000001";
    const spokenPhoneOpeningBody = new URLSearchParams({
      CallSid: spokenPhoneCallSid,
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "ringing",
    });
    const spokenPhoneOpening = await fetch(`${localUrl}${webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `${localUrl}${webhookPath}`,
          rawBody: spokenPhoneOpeningBody.toString(),
        }),
      },
      body: spokenPhoneOpeningBody,
    });
    assert.equal(spokenPhoneOpening.status, 200);

    webSocket = new WebSocket(localUrl.replace(/^http/, "ws") + relayPath, {
      headers: {
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `wss://voice.lanternbell.com${relayPath}`,
          rawBody: "",
        }),
      },
    });
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid: spokenPhoneCallSid,
      customParameters: { tenantId: "fh-demo" },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt:
        "My name is Kyle Finney. My phone number is six zero three, seven three one, five eight four five.",
      lang: "en-US",
      last: true,
    }));
    const spokenPhoneResponse = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
      last: boolean;
    };
    assert.equal(spokenPhoneResponse.type, "text");
    assert.equal(spokenPhoneResponse.last, true);
    assert.match(spokenPhoneResponse.token, /name of the person who passed away/i);
    assert.doesNotMatch(spokenPhoneResponse.token, /phone number|callback number/i);

    const spokenPhoneReplay = await service.replaySession({
      tenantId: "fh-demo",
      sessionId: spokenPhoneCallSid,
    });
    assert.equal(spokenPhoneReplay.session.facts.caller_phone, "603-731-5845");

    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "My father Robert Jones passed away at home.",
      lang: "en-US",
      last: true,
    }));
    const addressPrompt = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
    };
    assert.equal(addressPrompt.type, "text");
    assert.match(addressPrompt.token, /located right now/i);

    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "six three six Commerce Avenue Keller Texas.",
      lang: "en-US",
      last: true,
    }));
    const spokenAddressTerminal = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      handoffData: string;
    };
    assert.equal(spokenAddressTerminal.type, "end");
    assert.deepEqual(JSON.parse(spokenAddressTerminal.handoffData), { reasonCode: "handoff" });

    const spokenAddressReplay = await service.replaySession({
      tenantId: "fh-demo",
      sessionId: spokenPhoneCallSid,
    });
    assert.equal(spokenAddressReplay.session.facts.pickup_address, "636 Commerce Avenue Keller Texas");
    assert.equal(spokenAddressReplay.session.currentState, "ESCALATE");
    const spokenAddressIntent = spokenAddressReplay.events
      .filter((event) => event.eventType === "INTENT_DETECTED")
      .at(-1);
    assert.deepEqual(spokenAddressIntent?.payload.slotDiagnostics, {
      targetFact: "pickup_address",
      captured: true,
      tokenCountBucket: "medium",
      numericDigitPresent: false,
      spokenNumberPresent: true,
      streetSuffixPresent: true,
      addressCuePresent: false,
    });

    await closeWebSocket(webSocket);
    const retryBudgetCallSid = "CAconversationrelayaddressretry0000001";
    const retryBudgetOpeningBody = new URLSearchParams({
      CallSid: retryBudgetCallSid,
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "ringing",
    });
    const retryBudgetOpening = await fetch(`${localUrl}${webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `${localUrl}${webhookPath}`,
          rawBody: retryBudgetOpeningBody.toString(),
        }),
      },
      body: retryBudgetOpeningBody,
    });
    assert.equal(retryBudgetOpening.status, 200);

    webSocket = new WebSocket(localUrl.replace(/^http/, "ws") + relayPath, {
      headers: {
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `wss://voice.lanternbell.com${relayPath}`,
          rawBody: "",
        }),
      },
    });
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid: retryBudgetCallSid,
      customParameters: { tenantId: "fh-demo" },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt:
        "My name is Kyle Finney. My father Robert Jones passed away at home. My phone number is 603-731-5845.",
      lang: "en-US",
      last: true,
    }));
    const retryBudgetAddressPrompt = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
    };
    assert.equal(retryBudgetAddressPrompt.type, "text");
    assert.match(retryBudgetAddressPrompt.token, /located right now/i);

    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "It is difficult to explain.",
      lang: "en-US",
      last: true,
    }));
    const retryClarification = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
    };
    assert.equal(retryClarification.type, "text");
    assert.match(retryClarification.token, /house number one digit at a time/i);

    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "I still cannot explain it clearly.",
      lang: "en-US",
      last: true,
    }));
    const retryTerminal = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      handoffData: string;
    };
    assert.equal(retryTerminal.type, "end");
    assert.deepEqual(JSON.parse(retryTerminal.handoffData), { reasonCode: "handoff" });

    const retryReplay = await service.replaySession({
      tenantId: "fh-demo",
      sessionId: retryBudgetCallSid,
    });
    assert.equal(retryReplay.session.currentState, "ESCALATE");
    assert.equal(retryReplay.snapshot.handoff?.reason, "retry_budget_exhausted");
    assert.equal(retryReplay.session.facts.pickup_address, undefined);
    const retryEscalation = retryReplay.events.find(
      (event) =>
        event.eventType === "ESCALATION_TRIGGERED" &&
        event.payload.escalationReason === "retry_budget_exhausted",
    );
    assert.equal(retryEscalation?.payload.retryAttempt, 2);
    assert.equal(retryEscalation?.payload.retryBudget, 2);

    await service.endSession({
      tenantId: "fh-demo",
      sessionId: retryBudgetCallSid,
      reason: "completed",
    });
    const endedRetryReplay = await service.replaySession({
      tenantId: "fh-demo",
      sessionId: retryBudgetCallSid,
    });
    assert.equal(endedRetryReplay.session.currentState, "END_CALL");
    assert.equal(endedRetryReplay.snapshot.handoff?.reason, "retry_budget_exhausted");
  } finally {
    webSocket?.close();
    await closeServer(server);
  }
});

test("ConversationRelay speaks constrained generated language and stores only metering metadata", async () => {
  const tenantConfigStore = createDefaultTenantConfigStore();
  const eventStore = new InMemoryEventStore();
  const service = createFirstCallService({
    store: new InMemorySessionStore(),
    eventStore,
    tenantConfigStore,
  });
  const authToken = "conversation-relay-language-auth-token";
  const clock = [1_000, 1_042];
  let generationAttempt = 0;
  const server = createApiServer({
    service,
    tenantConfigStore,
    webhookSignatureVerifier: new HmacWebhookSignatureVerifier({ twilio: authToken }),
    logger: createNoopLogger(),
    twilioReadiness: {
      provider: "twilio",
      mode: "signed_webhook",
      handoffMode: "simulate",
      readyForLocalTesting: true,
      readyForPublicTraffic: true,
      checks: [],
    },
    twilioConversationRelayConfig: {
      mode: "conversation_relay",
      publicBaseUrl: "wss://voice.lanternbell.com",
      language: "en-US",
      ttsProvider: "ElevenLabs",
      transcriptionProvider: "Deepgram",
      speechModel: "flux",
      eotThreshold: "0.85",
      interruptSensitivity: "medium",
    },
    callerLanguageRuntime: {
      mode: "openai",
      generator: {
        async generate(request) {
          generationAttempt += 1;
          if (generationAttempt === 2) throw new Error("simulated provider failure");
          assert.equal(request.purpose, "collect_caller");
          assert.doesNotMatch(JSON.stringify(request), /My father|passed away at home/);
          return {
            text: "May I have your name and best callback phone number in case we get disconnected?",
            purpose: request.purpose,
            provider: "openai",
            model: "gpt-5.6-luna",
            usage: {
              inputTokens: 80,
              cachedInputTokens: 0,
              cacheWriteTokens: 0,
              outputTokens: 16,
              totalTokens: 96,
            },
          };
        },
      },
      pricing: {
        inputUsdPerMillion: 0.2,
        cachedInputUsdPerMillion: 0.02,
        cacheWriteUsdPerMillion: 0.25,
        outputUsdPerMillion: 1.2,
        version: "test-pricing",
      },
      nowMs: () => clock.shift() ?? 1_042,
    },
  });
  const localUrl = await listen(server, 0);
  const callSid = "CAconversationrelaylanguage000000001";
  let webSocket: WebSocket | undefined;

  try {
    const webhookPath = "/v1/tenants/fh-demo/telephony/twilio/webhook";
    const openingBody = new URLSearchParams({
      CallSid: callSid,
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "ringing",
    });
    const opening = await fetch(`${localUrl}${webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `${localUrl}${webhookPath}`,
          rawBody: openingBody.toString(),
        }),
      },
      body: openingBody,
    });
    assert.equal(opening.status, 200);

    const relayPath = "/v1/tenants/fh-demo/telephony/twilio/conversation-relay";
    webSocket = new WebSocket(localUrl.replace(/^http/, "ws") + relayPath, {
      headers: {
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `wss://voice.lanternbell.com${relayPath}`,
          rawBody: "",
        }),
      },
    });
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid,
      customParameters: { tenantId: "fh-demo" },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "My father passed away at home.",
      lang: "en-US",
      last: true,
    }));

    const spoken = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
      last: boolean;
    };
    assert.equal(spoken.type, "text");
    assert.equal(spoken.last, true);
    assert.equal(
      spoken.token,
      "May I have your name and best callback phone number in case we get disconnected?",
    );

    await waitForEvent(eventStore, callSid, "TTS_STARTED");
    const events = await eventStore.listBySession("fh-demo", callSid);
    const languageEvent = events.find((event) => event.eventType === "TTS_STARTED");
    assert.deepEqual(languageEvent?.payload, {
      provider: "twilio_conversation_relay",
      languageMode: "openai",
      languageStatus: "generated",
      languageProvider: "openai",
      latencyMs: 42,
      inputTokens: 80,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 16,
      totalTokens: 96,
      estimatedCostMicrousd: 35,
      canonicalTextRetained: false,
      generatedTextRetained: false,
      purpose: "collect_caller",
      model: "gpt-5.6-luna",
      pricingVersion: "test-pricing",
    });
    assert.doesNotMatch(JSON.stringify(languageEvent?.payload), /My father|callback phone number/);

    await closeWebSocket(webSocket);
    webSocket = undefined;
    const fallbackCallSid = "CAconversationrelaylanguagefallback0001";
    const fallbackOpeningBody = new URLSearchParams({
      CallSid: fallbackCallSid,
      From: "+15551230002",
      To: "+15559870000",
      CallStatus: "ringing",
    });
    const fallbackOpening = await fetch(`${localUrl}${webhookPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `${localUrl}${webhookPath}`,
          rawBody: fallbackOpeningBody.toString(),
        }),
      },
      body: fallbackOpeningBody,
    });
    assert.equal(fallbackOpening.status, 200);

    webSocket = new WebSocket(localUrl.replace(/^http/, "ws") + relayPath, {
      headers: {
        "x-twilio-signature": createTwilioWebhookSignature({
          authToken,
          url: `wss://voice.lanternbell.com${relayPath}`,
          rawBody: "",
        }),
      },
    });
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid: fallbackCallSid,
      customParameters: { tenantId: "fh-demo" },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "My father passed away at home.",
      lang: "en-US",
      last: true,
    }));
    const fallbackSpoken = JSON.parse(await onceMessage(webSocket)) as {
      type: string;
      token: string;
    };
    assert.equal(fallbackSpoken.type, "text");
    assert.equal(
      fallbackSpoken.token,
      "May I have your name and the best phone number in case we are disconnected?",
    );
    await waitForEvent(eventStore, fallbackCallSid, "TTS_STARTED");
    const fallbackEvents = await eventStore.listBySession("fh-demo", fallbackCallSid);
    const fallbackEvent = fallbackEvents.find((event) => event.eventType === "TTS_STARTED");
    assert.equal(fallbackEvent?.payload.languageMode, "openai");
    assert.equal(fallbackEvent?.payload.languageStatus, "fallback");
    assert.equal(fallbackEvent?.payload.languageProvider, "deterministic");
    assert.equal(fallbackEvent?.payload.fallbackReason, "provider_error");
    assert.equal(fallbackEvent?.payload.totalTokens, 0);
    assert.equal(fallbackEvent?.payload.estimatedCostMicrousd, 0);
  } finally {
    webSocket?.close();
    await closeServer(server);
  }
});

function onceOpen(webSocket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    webSocket.once("open", resolve);
    webSocket.once("error", reject);
  });
}

async function closeWebSocket(webSocket: WebSocket): Promise<void> {
  if (webSocket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    webSocket.once("close", resolve);
    webSocket.close();
  });
}

async function waitForEvent(
  eventStore: InMemoryEventStore,
  sessionId: string,
  eventType: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const events = await eventStore.listBySession("fh-demo", sessionId);
    if (events.some((event) => event.eventType === eventType)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Timed out waiting for ${eventType}.`);
}

function onceMessage(webSocket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    webSocket.once("message", (data) => resolve(data.toString()));
    webSocket.once("error", reject);
  });
}

async function closeServer(server: import("node:http").Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  });
}
