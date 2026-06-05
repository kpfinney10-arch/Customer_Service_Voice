import assert from "node:assert/strict";
import { test } from "node:test";
import type { TenantConfig } from "../src/tenants/tenant-config.js";
import { evaluateTenantReadiness } from "../src/tenants/tenant-readiness.js";

test("tenant readiness passes when voice intake and urgent routing are configured", () => {
  const readiness = evaluateTenantReadiness(tenantConfig());

  assert.equal(readiness.tenantId, "fh-ready");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.checks.every((check) => check.ok), true);
});

test("tenant readiness blocks when voice intake is disabled", () => {
  const readiness = evaluateTenantReadiness(
    tenantConfig({
      voiceIntake: false,
    }),
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.find((check) => check.name === "voice_intake_enabled")?.ok, false);
});

test("tenant readiness warns when downstream handoffs are disabled", () => {
  const readiness = evaluateTenantReadiness(
    tenantConfig({
      crmHandoff: false,
      dispatchHandoff: false,
    }),
  );

  assert.equal(readiness.ready, true);
  const check = readiness.checks.find((item) => item.name === "at_least_one_downstream_handoff_enabled");
  assert.equal(check?.ok, false);
  assert.equal(check?.severity, "warning");
});

function tenantConfig(features: Partial<TenantConfig["features"]> = {}): TenantConfig {
  return {
    tenantId: "fh-ready",
    displayName: "Ready Funeral Home",
    timezone: "America/Chicago",
    handoff: {
      defaultQueue: "first-call",
      onCallPhone: "+15555550100",
    },
    features: {
      crmHandoff: true,
      dispatchHandoff: true,
      voiceIntake: true,
      ...features,
    },
  };
}
