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
