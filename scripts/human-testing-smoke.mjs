const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const sessionId = env("SMOKE_SESSION_ID", "human-test-session-1");
const callId = env("SMOKE_CALL_ID", "human-test-call-1");

const transcript =
  "My name is Angela Carter. My uncle David Carter passed away at 100 Pine Street, Tulsa. My callback number is 555-212-3434.";

await main();

async function main() {
  console.log(`Human-testing smoke check against ${baseUrl}`);

  await expectJson("GET", "/health", undefined, 200);
  await expectJson("GET", "/version", undefined, 200);

  const readiness = await expectTenantJson("GET", `/v1/tenants/${tenantId}/readiness`, undefined, 200);
  if (!readiness.readiness?.ready) {
    throw new Error(`Tenant ${tenantId} is not ready for voice traffic.`);
  }

  const started = await expectTenantJson(
    "POST",
    `/v1/tenants/${tenantId}/first-call/sessions`,
    {
      callId,
      sessionId,
      callerPhone: "555-212-3434",
    },
    201,
    {
      "idempotency-key": `smoke-start-${sessionId}`,
    },
  );
  assertEqual(started.session?.sessionId, sessionId, "created session id");

  const turn = await expectTenantJson(
    "POST",
    `/v1/tenants/${tenantId}/first-call/sessions/${sessionId}/transcript`,
    {
      transcript,
      correlationId: `smoke-transcript-${sessionId}`,
    },
    200,
    {
      "idempotency-key": `smoke-transcript-${sessionId}`,
    },
  );
  assertEqual(turn.session?.sessionId, sessionId, "transcript session id");
  assertEqual(turn.session?.currentState, "ESCALATE", "first-call state");

  const replay = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/first-call/sessions/${sessionId}/replay`,
    undefined,
    200,
  );
  assertEqual(replay.snapshot?.escalated, true, "replay escalation status");

  const activity = await expectTenantJson("GET", `/v1/tenants/${tenantId}/diagnostics/activity?limit=10`, undefined, 200);
  const hasSession = activity.sessions?.some((session) => session.sessionId === sessionId);
  const hasTranscriptEvent = activity.recentEvents?.some(
    (event) => event.sessionId === sessionId && event.eventType === "TRANSCRIPT_RECEIVED",
  );
  assertEqual(hasSession, true, "diagnostics contains smoke session");
  assertEqual(hasTranscriptEvent, true, "diagnostics contains transcript event");

  console.log("Human-testing smoke check passed.");
  console.log(`Session: ${sessionId}`);
  console.log(`Replay: ${baseUrl}/v1/tenants/${tenantId}/first-call/sessions/${sessionId}/replay`);
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

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
