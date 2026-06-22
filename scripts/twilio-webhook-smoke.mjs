import crypto from "node:crypto";

const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const authToken = env("TWILIO_AUTH_TOKEN", "");
const signedExpected = env("TWILIO_EXPECT_SIGNED_WEBHOOK", "false").toLowerCase() === "true";
const callSid = env("TWILIO_SMOKE_CALL_SID", "twilio-smoke-call-1");
const outboundCallSid = env("TWILIO_SMOKE_OUTBOUND_CALL_SID", "twilio-smoke-outbound-1");
const speechTranscript = env(
  "TWILIO_SMOKE_TRANSCRIPT",
  "My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street, Springfield. My phone is 555-212-3434.",
);

await main();

async function main() {
  console.log(`Twilio webhook smoke check against ${baseUrl}`);
  if (signedExpected && !authToken) {
    throw new Error("TWILIO_EXPECT_SIGNED_WEBHOOK=true requires TWILIO_AUTH_TOKEN.");
  }

  const readiness = await expectTenantJson("GET", `/v1/tenants/${tenantId}/telephony/twilio/readiness`, undefined, 200);
  assertEqual(readiness.twilioReadiness?.readyForLocalTesting, true, "Twilio local readiness");
  if (signedExpected) {
    assertEqual(readiness.twilioReadiness?.readyForPublicTraffic, true, "Twilio public readiness");
  }

  const initialTwiMl = await postTwilioForm("/webhook", {
    CallSid: callSid,
    From: "+15551230000",
    To: "+15559870000",
    CallStatus: "ringing",
  });
  assertIncludes(initialTwiMl, "<Gather ", "initial gather");
  assertIncludes(initialTwiMl, "May I have your name", "opening prompt");

  const escalationTwiMl = await postTwilioForm("/webhook", {
    CallSid: callSid,
    CallStatus: "in-progress",
    SpeechResult: speechTranscript,
    Confidence: "0.92",
  });
  assertIncludes(escalationTwiMl, "<Dial ", "handoff dial");
  assertIncludes(escalationTwiMl, "/telephony/twilio/handoff-screen", "handoff screen url");

  const screeningTwiMl = await postTwilioForm("/handoff-screen", {
    CallSid: outboundCallSid,
    ParentCallSid: callSid,
  });
  assertIncludes(screeningTwiMl, '<Gather input="dtmf" numDigits="1"', "handoff screening gather");
  assertIncludes(screeningTwiMl, "Caller Sarah Miller", "handoff caller summary");
  assertIncludes(screeningTwiMl, "Deceased Robert Miller", "handoff decedent summary");

  const acceptTwiMl = await postTwilioForm("/handoff-accept", {
    CallSid: outboundCallSid,
    ParentCallSid: callSid,
    Digits: "1",
  });
  assertIncludes(acceptTwiMl, "Connecting now.", "handoff accept response");

  const replay = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/first-call/sessions/${encodeURIComponent(callSid)}/replay`,
    undefined,
    200,
  );
  assertEqual(replay.snapshot?.escalated, true, "replay escalation status");
  assertEqual(replay.snapshot?.handoff?.handoffType, "human_escalation", "replay handoff type");

  console.log("Twilio webhook smoke check passed.");
  console.log(`Call SID: ${callSid}`);
  console.log(`Replay: ${baseUrl}/v1/tenants/${tenantId}/first-call/sessions/${callSid}/replay`);
  console.log(`Mode: ${authToken ? "signed webhook" : "unsigned local"}`);
}

async function postTwilioForm(pathSuffix, fields) {
  const path = `/v1/tenants/${tenantId}/telephony/twilio${pathSuffix}`;
  const body = new URLSearchParams(fields);
  const rawBody = body.toString();
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (authToken) {
    headers["x-twilio-signature"] = createTwilioSignature({
      authToken,
      url: `${baseUrl}${path}`,
      rawBody,
    });
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body,
  });
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`POST ${path} expected 200, got ${response.status}: ${text}`);
  }
  return text;
}

async function expectTenantJson(method, path, body, statusCode, headers = {}) {
  return expectJson(method, path, body, statusCode, {
    "x-api-key": apiKey,
    ...headers,
  });
}

async function expectJson(method, path, body, statusCode, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await response.json();
  if (response.status !== statusCode) {
    throw new Error(`${method} ${path} expected ${statusCode}, got ${response.status}: ${JSON.stringify(responseBody)}`);
  }
  return responseBody;
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

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
