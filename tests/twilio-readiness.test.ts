import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTwilioReadinessFromEnv } from "../src/providers/telephony/twilio-readiness.js";

test("Twilio readiness reports unsigned local mode when signature secret is absent", () => {
  const readiness = evaluateTwilioReadinessFromEnv({
    TELEPHONY_WEBHOOK_SECRETS: "",
  });

  assert.equal(readiness.provider, "twilio");
  assert.equal(readiness.mode, "unsigned_local");
  assert.equal(readiness.readyForLocalTesting, true);
  assert.equal(readiness.readyForPublicTraffic, false);
  assert.equal(readiness.checks.find((check) => check.name === "webhook_signature_configured")?.ok, false);
});

test("Twilio readiness requires signature verification for public traffic", () => {
  const readiness = evaluateTwilioReadinessFromEnv({
    TELEPHONY_WEBHOOK_SECRETS: "telnyx:webhook-secret,twilio:auth-token",
  });

  assert.equal(readiness.mode, "signed_webhook");
  assert.equal(readiness.readyForLocalTesting, true);
  assert.equal(readiness.readyForPublicTraffic, true);
  assert.equal(readiness.checks.every((check) => check.ok), true);
});
