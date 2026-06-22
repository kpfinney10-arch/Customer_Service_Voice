import { parseWebhookSecrets } from "../../security/webhook-signature.js";

export type TwilioReadinessCheck = {
  name: string;
  ok: boolean;
  severity: "blocking" | "warning" | "info";
  message: string;
};

export type TwilioReadiness = {
  provider: "twilio";
  mode: "unsigned_local" | "signed_webhook";
  readyForLocalTesting: boolean;
  readyForPublicTraffic: boolean;
  checks: TwilioReadinessCheck[];
};

export function evaluateTwilioReadinessFromEnv(
  env: Record<string, string | undefined> = process.env,
): TwilioReadiness {
  const webhookSecrets = parseWebhookSecrets(env.TELEPHONY_WEBHOOK_SECRETS);
  const webhookSignatureConfigured = Boolean(webhookSecrets.twilio);

  const checks: TwilioReadinessCheck[] = [
    {
      name: "webhook_signature_configured",
      ok: webhookSignatureConfigured,
      severity: webhookSignatureConfigured ? "info" : "blocking",
      message: webhookSignatureConfigured
        ? "Twilio webhook signature verification is configured."
        : "Set TELEPHONY_WEBHOOK_SECRETS with a twilio:<auth_token> entry before persistent public traffic.",
    },
  ];

  return {
    provider: "twilio",
    mode: webhookSignatureConfigured ? "signed_webhook" : "unsigned_local",
    readyForLocalTesting: true,
    readyForPublicTraffic: webhookSignatureConfigured,
    checks,
  };
}
