import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTelnyxReadinessFromEnv } from "../src/providers/telephony/telnyx-readiness.js";

test("Telnyx readiness reports dry-run mode when live execution is disabled", () => {
  const readiness = evaluateTelnyxReadinessFromEnv({
    TELEPHONY_WEBHOOK_SECRETS: "",
    TELNYX_EXECUTE_COMMANDS: "false",
    TELNYX_API_KEY: "",
  });

  assert.equal(readiness.provider, "telnyx");
  assert.equal(readiness.mode, "dry_run");
  assert.equal(readiness.readyForDryRun, true);
  assert.equal(readiness.readyForLiveTraffic, false);
  assert.equal(readiness.checks.find((check) => check.name === "call_control_execution_enabled")?.ok, false);
});

test("Telnyx readiness requires signature, live execution, and API key for live traffic", () => {
  const readiness = evaluateTelnyxReadinessFromEnv({
    TELEPHONY_WEBHOOK_SECRETS: "telnyx:webhook-secret",
    TELNYX_EXECUTE_COMMANDS: "true",
    TELNYX_API_KEY: "telnyx-api-key",
  });

  assert.equal(readiness.mode, "live");
  assert.equal(readiness.readyForDryRun, true);
  assert.equal(readiness.readyForLiveTraffic, true);
  assert.equal(readiness.checks.every((check) => check.ok), true);
});
