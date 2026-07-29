import { parseWebhookSecrets } from "../../security/webhook-signature.js";
import type { TwilioHandoffMode } from "./twilio-adapter.js";

export type TwilioReadinessCheck = {
  name: string;
  ok: boolean;
  severity: "blocking" | "warning" | "info";
  message: string;
};

export type TwilioReadiness = {
  provider: "twilio";
  mode: "unsigned_local" | "signed_webhook";
  handoffMode: TwilioHandoffMode;
  readyForLocalTesting: boolean;
  readyForPublicTraffic: boolean;
  checks: TwilioReadinessCheck[];
};

export class TwilioReadinessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioReadinessConfigError";
  }
}

export function evaluateTwilioReadinessFromEnv(
  env: Record<string, string | undefined> = process.env,
): TwilioReadiness {
  const webhookSecrets = parseWebhookSecrets(env.TELEPHONY_WEBHOOK_SECRETS);
  const webhookSignatureConfigured = Boolean(webhookSecrets.twilio);
  const handoffMode = parseHandoffMode(env.TWILIO_HANDOFF_MODE);

  const checks: TwilioReadinessCheck[] = [
    {
      name: "webhook_signature_configured",
      ok: webhookSignatureConfigured,
      severity: webhookSignatureConfigured ? "info" : "blocking",
      message: webhookSignatureConfigured
        ? "Twilio webhook signature verification is configured."
        : "Set TELEPHONY_WEBHOOK_SECRETS with a twilio:<auth_token> entry before persistent public traffic.",
    },
    {
      name: "handoff_mode",
      ok: true,
      severity: "info",
      message:
        handoffMode === "simulate"
          ? "Human handoffs are simulated; escalation decisions are recorded without dialing a destination."
          : "Human handoffs dial the configured tenant destination.",
    },
  ];

  return {
    provider: "twilio",
    mode: webhookSignatureConfigured ? "signed_webhook" : "unsigned_local",
    handoffMode,
    readyForLocalTesting: true,
    readyForPublicTraffic: webhookSignatureConfigured,
    checks,
  };
}

function parseHandoffMode(value: string | undefined): TwilioHandoffMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "live";
  if (normalized === "live" || normalized === "simulate") return normalized;
  throw new TwilioReadinessConfigError("TWILIO_HANDOFF_MODE must be either live or simulate.");
}
