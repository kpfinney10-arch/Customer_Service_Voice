import crypto from "node:crypto";
import { WebSocket } from "ws";

const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000").replace(/\/+$/, "");
const relayPublicBaseUrl = env(
  "TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL",
  baseUrl.replace(/^http/, "ws"),
).replace(/\/+$/, "");
const relayConnectBaseUrl = env(
  "TWILIO_CONVERSATION_RELAY_CONNECT_BASE_URL",
  relayPublicBaseUrl,
).replace(/\/+$/, "");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const authToken = requiredEnv("TWILIO_AUTH_TOKEN");
const runId = env("TWILIO_CONVERSATION_RELAY_RUN_ID", `conversation-relay-${Date.now()}`);
const callSid = `${runId}-pricing`;
const languageCallSid = `${runId}-language`;
const phoneRetryCallSid = `${runId}-phone-retry`;
const pricingPrompt = "No one has passed away. I need cremation pricing.";
const languagePrompt = "My father passed away at home.";
const expectedLanguageStatus = env("CALLER_LANGUAGE_EXPECT_STATUS", "deterministic");
const timeoutMs = positiveInteger(env("TWILIO_CONVERSATION_RELAY_TIMEOUT_MS", "5000"));

await main();

async function main() {
  console.log(`Twilio ConversationRelay smoke against ${baseUrl}`);
  console.log(`Run id: ${runId}`);

  const readiness = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/telephony/twilio/readiness`,
    undefined,
    200,
  );
  assertEqual(readiness.twilioReadiness?.readyForPublicTraffic, true, "Twilio public readiness");
  assertEqual(readiness.twilioReadiness?.handoffMode, "simulate", "Twilio handoff mode");
  assertEqual(
    readiness.callerLanguageReadiness?.mode,
    expectedLanguageStatus === "generated" ? "openai" : "deterministic",
    "caller-language readiness mode",
  );
  assertEqual(readiness.callerLanguageReadiness?.ready, true, "caller-language readiness");
  assertEqual(
    readiness.callerLanguageReadiness?.callerDataSentToModel,
    false,
    "caller-language preparation caller-data isolation",
  );
  if (expectedLanguageStatus === "generated") {
    assertEqual(
      readiness.callerLanguageReadiness?.preparedPromptCount,
      readiness.callerLanguageReadiness?.approvedPromptCount,
      "prepared caller-language prompt count",
    );
    if (!(readiness.callerLanguageReadiness?.preparationUsage?.totalTokens > 0)) {
      throw new Error("OpenAI caller-language preparation must include positive one-time token usage.");
    }
  }

  const webhookPath = `/v1/tenants/${tenantId}/telephony/twilio/webhook`;
  const openingTwiml = await postTwilioForm(webhookPath, {
    CallSid: callSid,
    From: "+15551230000",
    To: "+15559870000",
    CallStatus: "ringing",
  });
  assertIncludes(openingTwiml, "<ConversationRelay", "ConversationRelay opening TwiML");
  assertIncludes(openingTwiml, 'ttsProvider="ElevenLabs"', "ElevenLabs TTS configuration");
  assertIncludes(openingTwiml, 'transcriptionProvider="Deepgram"', "Deepgram transcription configuration");
  assertIncludes(openingTwiml, 'speechModel="flux"', "Deepgram Flux speech model");
  assertIncludes(openingTwiml, 'eotThreshold="0.85"', "patient end-of-turn threshold");
  assertIncludes(openingTwiml, 'interruptible="speech"', "speech interruption configuration");
  assertExcludes(openingTwiml, "<Gather", "ConversationRelay opening gather");
  assertExcludes(openingTwiml, "<Dial", "ConversationRelay opening dial");

  const relayPath = `/v1/tenants/${tenantId}/telephony/twilio/conversation-relay`;
  const relayUrl = `${relayPublicBaseUrl}${relayPath}`;
  const relayConnectUrl = `${relayConnectBaseUrl}${relayPath}`;
  assertIncludes(openingTwiml, xmlEscape(relayUrl), "ConversationRelay WebSocket URL");

  const webSocket = new WebSocket(relayConnectUrl, {
    headers: {
      "x-twilio-signature": createTwilioSignature({
        authToken,
        url: relayUrl,
        rawBody: "",
      }),
    },
  });

  try {
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid,
      customParameters: { tenantId },
    }));
    webSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: pricingPrompt,
      lang: "en-US",
      last: true,
    }));

    const terminal = JSON.parse(await onceMessage(webSocket));
    assertEqual(terminal.type, "end", "pricing terminal message type");
    assertEqual(
      JSON.parse(terminal.handoffData).reasonCode,
      "pricing_blocked",
      "pricing terminal reason",
    );

    const completionPath = `${relayPath}/complete`;
    const completionTwiml = await postTwilioForm(completionPath, {
      CallSid: callSid,
      HandoffData: terminal.handoffData,
    });
    assertIncludes(completionTwiml, "I cannot provide pricing", "pricing completion message");
    assertIncludes(completionTwiml, "<Hangup/>", "pricing completion hangup");
    assertExcludes(completionTwiml, "<Gather", "pricing completion gather");
    assertExcludes(completionTwiml, "<Dial", "pricing completion dial");
  } finally {
    await closeWebSocket(webSocket);
  }

  const replay = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/first-call/sessions/${encodeURIComponent(callSid)}/replay`,
    undefined,
    200,
  );
  assertEqual(replay.session?.currentState, "WRAPUP", "pricing replay state");
  assertEqual(replay.session?.intent, "pricing_or_billing", "pricing replay intent");
  const transcriptEvent = replay.events?.find((event) => event.eventType === "TRANSCRIPT_RECEIVED");
  assertEqual(transcriptEvent?.payload?.transcriptRetained, false, "transcript retention flag");
  assertEqual(JSON.stringify(transcriptEvent?.payload?.redactionCategories), "[]", "transcript redactions");
  assertExcludes(JSON.stringify(replay), pricingPrompt, "durable replay raw prompt");

  const languageOpeningTwiml = await postTwilioForm(webhookPath, {
    CallSid: languageCallSid,
    From: "+15551230001",
    To: "+15559870000",
    CallStatus: "ringing",
  });
  assertIncludes(languageOpeningTwiml, "<ConversationRelay", "language opening TwiML");

  const languageSocket = new WebSocket(relayConnectUrl, {
    headers: {
      "x-twilio-signature": createTwilioSignature({
        authToken,
        url: relayUrl,
        rawBody: "",
      }),
    },
  });
  try {
    await onceOpen(languageSocket);
    languageSocket.send(JSON.stringify({
      type: "setup",
      callSid: languageCallSid,
      customParameters: { tenantId },
    }));
    languageSocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: languagePrompt,
      lang: "en-US",
      last: true,
    }));
    const languageMessage = JSON.parse(await onceMessage(languageSocket));
    assertEqual(languageMessage.type, "text", "caller-language message type");
    assertEqual(languageMessage.last, true, "caller-language final flag");
    if (typeof languageMessage.token !== "string" || !languageMessage.token.trim()) {
      throw new Error("caller-language text token must be non-empty.");
    }

    const languageEvent = await waitForLanguageEvent(languageCallSid);
    assertEqual(
      languageEvent.payload?.languageStatus,
      expectedLanguageStatus,
      "caller-language generation status",
    );
    assertEqual(
      languageEvent.payload?.canonicalTextRetained,
      false,
      "canonical language retention",
    );
    assertEqual(
      languageEvent.payload?.generatedTextRetained,
      false,
      "generated language retention",
    );
    if (expectedLanguageStatus === "generated") {
      assertEqual(languageEvent.payload?.languageMode, "openai", "caller-language mode");
      assertEqual(languageEvent.payload?.cacheHit, true, "caller-language cache hit");
      assertEqual(languageEvent.payload?.totalTokens, 0, "per-call caller-language tokens");
      assertEqual(
        languageEvent.payload?.estimatedCostMicrousd,
        0,
        "per-call caller-language generation cost",
      );
      if (!(languageEvent.payload?.latencyMs >= 0 && languageEvent.payload?.latencyMs <= 100)) {
        throw new Error("cached caller language must be served within 100 milliseconds.");
      }
    }
  } finally {
    await closeWebSocket(languageSocket);
  }

  const phoneRetryOpeningTwiml = await postTwilioForm(webhookPath, {
    CallSid: phoneRetryCallSid,
    From: "+15551230002",
    To: "+15559870000",
    CallStatus: "ringing",
  });
  assertIncludes(phoneRetryOpeningTwiml, "<ConversationRelay", "phone-retry opening TwiML");

  const phoneRetrySocket = new WebSocket(relayConnectUrl, {
    headers: {
      "x-twilio-signature": createTwilioSignature({
        authToken,
        url: relayUrl,
        rawBody: "",
      }),
    },
  });
  try {
    await onceOpen(phoneRetrySocket);
    phoneRetrySocket.send(JSON.stringify({
      type: "setup",
      callSid: phoneRetryCallSid,
      customParameters: { tenantId },
    }));
    phoneRetrySocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "My name is Test Caller. I am reporting a death.",
      lang: "en-US",
      last: true,
    }));
    const phonePrompt = JSON.parse(await onceMessage(phoneRetrySocket));
    assertEqual(phonePrompt.type, "text", "phone collection message type");

    phoneRetrySocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "The number should already be in your records.",
      lang: "en-US",
      last: true,
    }));
    const phoneClarification = JSON.parse(await onceMessage(phoneRetrySocket));
    assertEqual(phoneClarification.type, "text", "phone clarification message type");
    assertIncludes(
      String(phoneClarification.token).toLowerCase(),
      "digit",
      "phone digit-by-digit clarification",
    );

    phoneRetrySocket.send(JSON.stringify({
      type: "prompt",
      voicePrompt: "It still is not understanding the number.",
      lang: "en-US",
      last: true,
    }));
    const phoneRetryTerminal = JSON.parse(await onceMessage(phoneRetrySocket));
    assertEqual(phoneRetryTerminal.type, "end", "phone retry terminal message type");
    assertEqual(
      JSON.parse(phoneRetryTerminal.handoffData).reasonCode,
      "handoff",
      "phone retry terminal reason",
    );
  } finally {
    await closeWebSocket(phoneRetrySocket);
  }

  const phoneRetryReplay = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/first-call/sessions/${encodeURIComponent(phoneRetryCallSid)}/replay`,
    undefined,
    200,
  );
  assertEqual(phoneRetryReplay.session?.currentState, "ESCALATE", "phone retry replay state");
  assertEqual(
    phoneRetryReplay.snapshot?.handoff?.reason,
    "retry_budget_exhausted",
    "phone retry replay handoff reason",
  );
  const phoneRetryEscalation = phoneRetryReplay.events?.find(
    (event) => event.eventType === "ESCALATION_TRIGGERED",
  );
  assertEqual(phoneRetryEscalation?.payload?.retryAttempt, 2, "phone retry attempt count");
  assertEqual(phoneRetryEscalation?.payload?.retryBudget, 2, "phone retry budget");
  assertExcludes(
    JSON.stringify(phoneRetryReplay),
    "not understanding the number",
    "durable phone-retry raw prompt",
  );

  console.log("Twilio ConversationRelay smoke passed.");
  console.log(`Call SID: ${callSid}`);
  console.log(`Language Call SID: ${languageCallSid}`);
  console.log(`Phone Retry Call SID: ${phoneRetryCallSid}`);
  console.log(`Caller-language status: ${expectedLanguageStatus}`);
  console.log("Handoff mode: simulate");
  console.log("Raw transcript retained: no");
}

async function waitForLanguageEvent(sessionId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const replay = await expectTenantJson(
      "GET",
      `/v1/tenants/${tenantId}/first-call/sessions/${encodeURIComponent(sessionId)}/replay`,
      undefined,
      200,
    );
    const event = replay.events?.find((candidate) => candidate.eventType === "TTS_STARTED");
    if (event) {
      assertExcludes(JSON.stringify(event.payload), languagePrompt, "durable caller-language prompt");
      return event;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("caller-language metering event was not recorded before timeout.");
}

async function postTwilioForm(path, fields) {
  const body = new URLSearchParams(fields);
  const rawBody = body.toString();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createTwilioSignature({
        authToken,
        url: `${baseUrl}${path}`,
        rawBody,
      }),
    },
    body,
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`POST ${path} expected 200, got ${response.status}: ${text}`);
  }
  return text;
}

async function expectTenantJson(method, path, body, statusCode) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-api-key": apiKey,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await response.json();
  if (response.status !== statusCode) {
    throw new Error(`${method} ${path} expected ${statusCode}, got ${response.status}: ${JSON.stringify(responseBody)}`);
  }
  return responseBody;
}

function onceOpen(webSocket) {
  return withTimeout(new Promise((resolve, reject) => {
    webSocket.once("open", resolve);
    webSocket.once("error", reject);
    webSocket.once("unexpected-response", (_request, response) => {
      reject(new Error(`WebSocket upgrade failed with HTTP ${response.statusCode}.`));
    });
  }), "WebSocket open");
}

function onceMessage(webSocket) {
  return withTimeout(new Promise((resolve, reject) => {
    webSocket.once("message", (data) => resolve(data.toString()));
    webSocket.once("error", reject);
    webSocket.once("close", (code, reason) => {
      reject(new Error(`WebSocket closed before a response (${code}: ${reason.toString()}).`));
    });
  }), "WebSocket message");
}

async function closeWebSocket(webSocket) {
  if (webSocket.readyState === WebSocket.CLOSED) return;
  if (webSocket.readyState === WebSocket.CONNECTING) {
    webSocket.terminate();
    return;
  }
  await withTimeout(new Promise((resolve) => {
    webSocket.once("close", resolve);
    webSocket.close();
  }), "WebSocket close");
}

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function createTwilioSignature(input) {
  const signedPayload = `${input.url}${twilioSortedFormPayload(input.rawBody)}`;
  return crypto.createHmac("sha1", input.authToken).update(signedPayload).digest("base64");
}

function twilioSortedFormPayload(rawBody) {
  const params = new URLSearchParams(rawBody);
  return Array.from(params.keys())
    .sort()
    .map((key) => `${key}${params.getAll(key).join("")}`)
    .join("");
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} in ${JSON.stringify(actual)}`);
  }
}

function assertExcludes(actual, unexpected, label) {
  if (actual.includes(unexpected)) {
    throw new Error(`${label} did not expect ${JSON.stringify(unexpected)} in ${JSON.stringify(actual)}`);
  }
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("TWILIO_CONVERSATION_RELAY_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
