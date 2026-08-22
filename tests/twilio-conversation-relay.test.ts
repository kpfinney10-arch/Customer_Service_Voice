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
