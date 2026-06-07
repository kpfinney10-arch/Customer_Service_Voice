import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWebhookSignature,
  createWebhookSignatureVerifierFromEnv,
  HmacWebhookSignatureVerifier,
  parseWebhookSecrets,
  WebhookSignatureError,
} from "../src/security/webhook-signature.js";

test("webhook signature verifier accepts valid HMAC signatures", () => {
  const verifier = new HmacWebhookSignatureVerifier({
    generic: "secret-1",
  });
  const rawBody = JSON.stringify({ providerCallId: "call-1" });

  verifier.verify({
    provider: "generic",
    method: "POST",
    path: "/v1/tenants/fh-demo/telephony/generic/inbound-call",
    rawBody,
    headers: new Headers({
      "x-webhook-signature": createWebhookSignature({
        secret: "secret-1",
        method: "POST",
        path: "/v1/tenants/fh-demo/telephony/generic/inbound-call",
        rawBody,
      }),
    }),
  });
});

test("webhook signature verifier rejects missing or invalid signatures", () => {
  const verifier = new HmacWebhookSignatureVerifier({
    generic: "secret-1",
  });

  assert.throws(
    () =>
      verifier.verify({
        provider: "generic",
        method: "POST",
        path: "/v1/tenants/fh-demo/telephony/generic/inbound-call",
        rawBody: "{}",
        headers: new Headers(),
      }),
    WebhookSignatureError,
  );
  assert.throws(
    () =>
      verifier.verify({
        provider: "generic",
        method: "POST",
        path: "/v1/tenants/fh-demo/telephony/generic/inbound-call",
        rawBody: "{}",
        headers: new Headers({
          "x-webhook-signature": "sha256=bad",
        }),
      }),
    WebhookSignatureError,
  );
});

test("webhook signature verifier ignores providers without configured secrets", () => {
  const verifier = new HmacWebhookSignatureVerifier({
    other: "secret-1",
  });

  verifier.verify({
    provider: "generic",
    method: "POST",
    path: "/v1/tenants/fh-demo/telephony/generic/inbound-call",
    rawBody: "{}",
    headers: new Headers(),
  });
});

test("webhook signature env parser loads provider secrets", () => {
  assert.deepEqual(parseWebhookSecrets("generic:secret-1,twilio:secret-2"), {
    generic: "secret-1",
    twilio: "secret-2",
  });
  assert.throws(() => parseWebhookSecrets("generic"), WebhookSignatureError);
  assert.equal(typeof createWebhookSignatureVerifierFromEnv({ TELEPHONY_WEBHOOK_SECRETS: "" }).verify, "function");
});
