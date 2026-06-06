import assert from "node:assert/strict";
import { test } from "node:test";
import { loadServerEnvironment, ServerEnvironmentError } from "../src/config/server-environment.js";
import { RateLimitConfigError } from "../src/security/rate-limit.js";
import { TenantConfigParseError } from "../src/tenants/tenant-config.js";

test("server environment loads validated startup dependencies", async () => {
  const environment = loadServerEnvironment({
    PORT: "4000",
    TENANT_API_KEYS: "fh-demo:demo-api-key",
    TENANT_CONFIGS_JSON: JSON.stringify({
      "fh-demo": {
        tenantId: "fh-demo",
        displayName: "Demo Funeral Home",
        timezone: "America/Chicago",
        handoff: {
          defaultQueue: "first-call",
          onCallPhone: "+15555550100",
        },
        features: {
          crmHandoff: true,
          dispatchHandoff: true,
          voiceIntake: true,
        },
      },
    }),
    RATE_LIMIT_PER_WINDOW: "2",
    RATE_LIMIT_WINDOW_MS: "1000",
    SERVICE_VERSION: "1.0.0",
    SERVICE_COMMIT: "abc123",
    SERVICE_BUILD_TIME: "2026-06-06T12:00:00.000Z",
    STORAGE_DRIVER: "file",
    STORAGE_DATA_DIR: "/tmp/voice-ai-platform-test",
  });

  assert.equal(environment.port, 4000);
  assert.equal(environment.buildInfo.version, "1.0.0");
  assert.equal(environment.buildInfo.commit, "abc123");
  assert.equal(environment.storage.driver, "file");
  assert.equal(environment.storage.dataDir, "/tmp/voice-ai-platform-test");
  assert.equal(await environment.apiKeyVerifier.verify("fh-demo", "demo-api-key"), true);
  assert.equal((await environment.tenantConfigStore.get("fh-demo"))?.displayName, "Demo Funeral Home");
  assert.equal(environment.rateLimiter.check({ key: "fh-demo", method: "GET", path: "/config" }).allowed, true);
});

test("server environment requires at least one tenant API key", () => {
  assert.throws(
    () =>
      loadServerEnvironment({
        TENANT_API_KEYS: "",
      }),
    ServerEnvironmentError,
  );
});

test("server environment rejects invalid port", () => {
  assert.throws(
    () =>
      loadServerEnvironment({
        PORT: "99999",
        TENANT_API_KEYS: "fh-demo:demo-api-key",
      }),
    ServerEnvironmentError,
  );
});

test("server environment surfaces tenant config parse errors", () => {
  assert.throws(
    () =>
      loadServerEnvironment({
        TENANT_API_KEYS: "fh-demo:demo-api-key",
        TENANT_CONFIGS_JSON: "{bad-json",
      }),
    TenantConfigParseError,
  );
});

test("server environment surfaces rate-limit config errors", () => {
  assert.throws(
    () =>
      loadServerEnvironment({
        TENANT_API_KEYS: "fh-demo:demo-api-key",
        RATE_LIMIT_PER_WINDOW: "nope",
      }),
    RateLimitConfigError,
  );
});
