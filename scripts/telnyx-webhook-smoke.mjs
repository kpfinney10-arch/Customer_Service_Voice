import crypto from "node:crypto";

const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const webhookSecret = env("TELNYX_WEBHOOK_SECRET", "");
const liveExpected = env("TELNYX_EXPECT_LIVE_EXECUTION", "false").toLowerCase() === "true";
const callControlId = env("TELNYX_SMOKE_CALL_CONTROL_ID", "telnyx-smoke-call-1");
const eventId = env("TELNYX_SMOKE_EVENT_ID", "telnyx-smoke-event-1");
const speechEventId = env("TELNYX_SMOKE_SPEECH_EVENT_ID", "telnyx-smoke-speech-event-1");
const speechTranscript = env(
  "TELNYX_SMOKE_TRANSCRIPT",
  "My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street, Springfield. My phone is 555-212-3434.",
);

await main();

async function main() {
  console.log(`Telnyx webhook smoke check against ${baseUrl}`);

  const readiness = await expectTenantJson("GET", `/v1/tenants/${tenantId}/telephony/telnyx/readiness`, undefined, 200);
  assertEqual(readiness.telnyxReadiness?.readyForDryRun, true, "Telnyx dry-run readiness");
  if (liveExpected) {
    assertEqual(readiness.telnyxReadiness?.readyForLiveTraffic, true, "Telnyx live readiness");
  }

  const initiatedPayload = {
    data: {
      id: eventId,
      event_type: "call.initiated",
      payload: {
        call_control_id: callControlId,
        from: "+15551230000",
        to: "+15559870000",
      },
    },
  };
  const initiatedResponse = await postTelnyxWebhook(initiatedPayload, eventId);

  assertEqual(initiatedResponse.provider, "telnyx", "provider");
  assertEqual(initiatedResponse.eventType, "call.initiated", "event type");
  assertEqual(initiatedResponse.result?.session?.sessionId, callControlId, "session id");
  assertEqual(initiatedResponse.telnyxCommands?.[0]?.command, "answer", "first Telnyx command");
  assertEqual(initiatedResponse.telnyxCommands?.[1]?.command, "gather_using_speak", "second Telnyx command");
  assertString(initiatedResponse.providerCommandEventId, "initiated provider command event id");
  assertCommandResults(initiatedResponse, "initiated command result");

  const speechPayload = {
    data: {
      id: speechEventId,
      event_type: "call.ai_gather.ended",
      payload: {
        call_control_id: callControlId,
        message_history: [
          {
            role: "assistant",
            content:
              initiatedResponse.telnyxCommands?.[1]?.payload?.payload ??
              "I am assisting the funeral director with gathering call information.",
          },
          {
            role: "user",
            content: speechTranscript,
          },
        ],
      },
    },
  };
  const speechResponse = await postTelnyxWebhook(speechPayload, speechEventId);

  assertEqual(speechResponse.provider, "telnyx", "speech provider");
  assertEqual(speechResponse.eventType, "call.ai_gather.ended", "speech event type");
  assertEqual(speechResponse.result?.session?.sessionId, callControlId, "speech session id");
  assertEqual(speechResponse.result?.session?.currentState, "ESCALATE", "speech session state");
  assertEqual(speechResponse.result?.nextExpectedInput, "human_handoff", "speech next expected input");
  assertEqual(speechResponse.telnyxCommands?.[0]?.command, "speak", "speech Telnyx command");
  assertString(speechResponse.providerCommandEventId, "speech provider command event id");
  assertCommandResults(speechResponse, "speech command result");

  const replay = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/first-call/sessions/${callControlId}/replay`,
    undefined,
    200,
  );
  assertEqual(replay.snapshot?.escalated, true, "replay escalation status");
  assertEqual(replay.snapshot?.handoff?.handoffType, "human_escalation", "replay handoff type");
  const providerCommandBatches = replay.snapshot?.providerCommandBatches ?? [];
  assertEqual(providerCommandBatches.length, 2, "replay provider command batch count");
  assertEqual(providerCommandBatches[0]?.provider, "telnyx", "first replay command provider");
  assertEqual(providerCommandBatches[0]?.providerEventType, "call.initiated", "first replay provider event type");
  assertEqual(providerCommandBatches[0]?.allSucceeded, true, "first replay command batch success");
  assertEqual(providerCommandBatches[1]?.providerEventType, "call.ai_gather.ended", "second replay provider event type");
  assertEqual(providerCommandBatches[1]?.allSucceeded, true, "second replay command batch success");

  console.log("Telnyx webhook smoke check passed.");
  console.log(`Call control id: ${callControlId}`);
  console.log(`Replay: ${baseUrl}/v1/tenants/${tenantId}/first-call/sessions/${callControlId}/replay`);
  console.log(`Mode: ${liveExpected ? "live execution expected" : "dry-run expected"}`);
}

async function postTelnyxWebhook(payload, eventKey) {
  const path = `/v1/tenants/${tenantId}/telephony/telnyx/webhook`;
  const rawBody = JSON.stringify(payload);
  const headers = {
    "idempotency-key": `telnyx-smoke-${eventKey}`,
  };
  if (webhookSecret) {
    headers["x-webhook-signature"] = createSignature({
      secret: webhookSecret,
      method: "POST",
      path,
      rawBody,
    });
  }
  return expectTenantJson("POST", path, payload, 200, headers);
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

function createSignature(input) {
  return `sha256=${crypto
    .createHmac("sha256", input.secret)
    .update(`${input.method.toUpperCase()} ${input.path}\n${input.rawBody}`)
    .digest("hex")}`;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertString(actual, label) {
  if (typeof actual !== "string" || actual.trim() === "") {
    throw new Error(`${label} expected a non-empty string, got ${JSON.stringify(actual)}`);
  }
}

function assertCommandResults(response, label) {
  if (liveExpected) {
    const failed = response.telnyxCommandResults?.filter((result) => !result.ok) ?? [];
    if (failed.length > 0) {
      throw new Error(`Telnyx live command execution failed for ${label}: ${JSON.stringify(failed)}`);
    }
    return;
  }
  assertEqual(response.telnyxCommandResults?.[0]?.responseBody?.dryRun, true, label);
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
