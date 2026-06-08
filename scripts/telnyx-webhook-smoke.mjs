import crypto from "node:crypto";

const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const webhookSecret = env("TELNYX_WEBHOOK_SECRET", "");
const liveExpected = env("TELNYX_EXPECT_LIVE_EXECUTION", "false").toLowerCase() === "true";
const callControlId = env("TELNYX_SMOKE_CALL_CONTROL_ID", "telnyx-smoke-call-1");
const eventId = env("TELNYX_SMOKE_EVENT_ID", "telnyx-smoke-event-1");

await main();

async function main() {
  console.log(`Telnyx webhook smoke check against ${baseUrl}`);

  const payload = {
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
  const rawBody = JSON.stringify(payload);
  const headers = {
    "idempotency-key": `telnyx-smoke-${eventId}`,
  };
  if (webhookSecret) {
    headers["x-webhook-signature"] = createSignature({
      secret: webhookSecret,
      method: "POST",
      path: `/v1/tenants/${tenantId}/telephony/telnyx/webhook`,
      rawBody,
    });
  }

  const response = await expectTenantJson(
    "POST",
    `/v1/tenants/${tenantId}/telephony/telnyx/webhook`,
    payload,
    200,
    headers,
  );

  assertEqual(response.provider, "telnyx", "provider");
  assertEqual(response.eventType, "call.initiated", "event type");
  assertEqual(response.result?.session?.sessionId, callControlId, "session id");
  assertEqual(response.telnyxCommands?.[0]?.command, "answer", "first Telnyx command");
  assertEqual(response.telnyxCommands?.[1]?.command, "gather_using_speak", "second Telnyx command");

  if (liveExpected) {
    const failed = response.telnyxCommandResults?.filter((result) => !result.ok) ?? [];
    if (failed.length > 0) {
      throw new Error(`Telnyx live command execution failed: ${JSON.stringify(failed)}`);
    }
  } else {
    assertEqual(response.telnyxCommandResults?.[0]?.responseBody?.dryRun, true, "dry-run command result");
  }

  console.log("Telnyx webhook smoke check passed.");
  console.log(`Call control id: ${callControlId}`);
  console.log(`Mode: ${liveExpected ? "live execution expected" : "dry-run expected"}`);
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

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
