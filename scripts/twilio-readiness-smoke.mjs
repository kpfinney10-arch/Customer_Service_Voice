const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const publicExpected = env("TWILIO_EXPECT_PUBLIC_READY", "false").toLowerCase() === "true";

await main();

async function main() {
  console.log(`Twilio readiness smoke check against ${baseUrl}`);

  await expectJson("GET", "/health", undefined, 200);
  await expectJson("GET", "/version", undefined, 200);

  const readiness = await expectTenantJson("GET", `/v1/tenants/${tenantId}/telephony/twilio/readiness`, undefined, 200);
  assertEqual(readiness.tenantReadiness?.ready, true, "tenant readiness");
  assertEqual(readiness.twilioReadiness?.provider, "twilio", "provider");
  assertEqual(readiness.twilioReadiness?.readyForLocalTesting, true, "Twilio local readiness");

  if (publicExpected) {
    assertEqual(readiness.twilioReadiness?.readyForPublicTraffic, true, "Twilio public readiness");
  }

  console.log("Twilio readiness smoke check passed.");
  console.log(`Mode: ${readiness.twilioReadiness?.mode ?? "unknown"}`);
  console.log(`Public traffic ready: ${readiness.twilioReadiness?.readyForPublicTraffic === true ? "yes" : "no"}`);
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
