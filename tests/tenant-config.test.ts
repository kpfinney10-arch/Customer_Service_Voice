import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTenantConfigStoreFromEnv,
  parseTenantConfigsJson,
  TenantConfigParseError,
} from "../src/tenants/tenant-config.js";

test("tenant config parser loads tenant-specific handoff destinations", () => {
  const configs = parseTenantConfigsJson(
    JSON.stringify({
      "fh-alpha": {
        tenantId: "fh-alpha",
        displayName: "Alpha Funeral Care",
        timezone: "America/New_York",
        handoff: {
          defaultQueue: "alpha-first-call",
          onCallPhone: "+15555551000",
          dispatchDeskPhone: "+15555551001",
          afterHoursQueue: "alpha-after-hours",
        },
        features: {
          crmHandoff: true,
          dispatchHandoff: true,
          voiceIntake: true,
        },
      },
    }),
  );

  assert.equal(configs?.["fh-alpha"]?.displayName, "Alpha Funeral Care");
  assert.equal(configs?.["fh-alpha"]?.handoff.onCallPhone, "+15555551000");
  assert.equal(configs?.["fh-alpha"]?.handoff.afterHoursQueue, "alpha-after-hours");
});

test("tenant config store falls back to demo config when env is empty", async () => {
  const store = createTenantConfigStoreFromEnv("");
  const config = await store.get("fh-demo");

  assert.equal(config?.displayName, "Demo Funeral Home");
  assert.equal(config?.handoff.onCallPhone, "+15555550100");
});

test("tenant config parser rejects malformed JSON", () => {
  assert.throws(() => parseTenantConfigsJson("{bad-json"), TenantConfigParseError);
});

test("tenant config parser rejects missing required handoff queue", () => {
  assert.throws(
    () =>
      parseTenantConfigsJson(
        JSON.stringify({
          "fh-missing": {
            tenantId: "fh-missing",
            displayName: "Missing Funeral Home",
            timezone: "America/Chicago",
            handoff: {},
            features: {
              crmHandoff: true,
              dispatchHandoff: true,
              voiceIntake: true,
            },
          },
        }),
      ),
    TenantConfigParseError,
  );
});

test("tenant config parser rejects a tenant id that does not match its object key", () => {
  assert.throws(
    () =>
      parseTenantConfigsJson(
        JSON.stringify({
          "fh-alpha": {
            tenantId: "fh-beta",
            displayName: "Alpha Funeral Care",
            timezone: "America/Chicago",
            handoff: { defaultQueue: "alpha-first-call" },
            features: { crmHandoff: false, dispatchHandoff: false, voiceIntake: false },
          },
        }),
      ),
    /must match its tenantId value/,
  );
});

test("tenant config parser rejects invalid tenant ids", () => {
  assert.throws(
    () =>
      parseTenantConfigsJson(
        JSON.stringify({
          "FH Alpha": {
            tenantId: "FH Alpha",
            displayName: "Alpha Funeral Care",
            timezone: "America/Chicago",
            handoff: { defaultQueue: "Alpha First Call" },
            features: { crmHandoff: false, dispatchHandoff: false, voiceIntake: false },
          },
        }),
      ),
    /lower-kebab-case tenant ids/,
  );
});

test("tenant config parser rejects invalid queue names", () => {
  assert.throws(
    () =>
      parseTenantConfigsJson(
        JSON.stringify({
          "fh-alpha": {
            tenantId: "fh-alpha",
            displayName: "Alpha Funeral Care",
            timezone: "America/Chicago",
            handoff: { defaultQueue: "Alpha First Call" },
            features: { crmHandoff: false, dispatchHandoff: false, voiceIntake: false },
          },
        }),
      ),
    /invalid handoff.defaultQueue/,
  );
});

test("tenant config parser rejects invalid timezones and phone numbers", () => {
  const baseConfig = {
    tenantId: "fh-alpha",
    displayName: "Alpha Funeral Care",
    timezone: "America/Chicago",
    handoff: { defaultQueue: "alpha-first-call", onCallPhone: "+15555551000" },
    features: { crmHandoff: false, dispatchHandoff: false, voiceIntake: false },
  };

  assert.throws(
    () =>
      parseTenantConfigsJson(
        JSON.stringify({ "fh-alpha": { ...baseConfig, timezone: "Central Time" } }),
      ),
    /invalid IANA timezone/,
  );
  assert.throws(
    () =>
      parseTenantConfigsJson(
        JSON.stringify({
          "fh-alpha": { ...baseConfig, handoff: { ...baseConfig.handoff, onCallPhone: "555-555-1000" } },
        }),
      ),
    /E\.164 format/,
  );
});
