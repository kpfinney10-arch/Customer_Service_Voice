import { parseWebhookSecrets } from "../../security/webhook-signature.js";

export type TelnyxReadinessCheck = {
  name: string;
  ok: boolean;
  severity: "blocking" | "warning" | "info";
  message: string;
};

export type TelnyxReadiness = {
  provider: "telnyx";
  mode: "dry_run" | "live";
  readyForDryRun: boolean;
  readyForLiveTraffic: boolean;
  checks: TelnyxReadinessCheck[];
};

export function evaluateTelnyxReadinessFromEnv(
  env: Record<string, string | undefined> = process.env,
): TelnyxReadiness {
  const executeCommands = env.TELNYX_EXECUTE_COMMANDS?.trim().toLowerCase() === "true";
  const apiKeyConfigured = Boolean(env.TELNYX_API_KEY?.trim());
  const webhookSecrets = parseWebhookSecrets(env.TELEPHONY_WEBHOOK_SECRETS);
  const webhookSignatureConfigured = Boolean(webhookSecrets.telnyx);

  const checks: TelnyxReadinessCheck[] = [
    {
      name: "webhook_signature_configured",
      ok: webhookSignatureConfigured,
      severity: webhookSignatureConfigured ? "info" : "blocking",
      message: webhookSignatureConfigured
        ? "Telnyx webhook signature verification is configured."
        : "Set TELEPHONY_WEBHOOK_SECRETS with a telnyx:<secret> entry before live traffic.",
    },
    {
      name: "call_control_execution_enabled",
      ok: executeCommands,
      severity: executeCommands ? "info" : "blocking",
      message: executeCommands
        ? "Telnyx Call Control command execution is enabled."
        : "TELNYX_EXECUTE_COMMANDS is not true, so generated commands will run in dry-run mode.",
    },
    {
      name: "api_key_configured",
      ok: apiKeyConfigured,
      severity: apiKeyConfigured ? "info" : "blocking",
      message: apiKeyConfigured
        ? "Telnyx API key is configured for live command execution."
        : "Set TELNYX_API_KEY before enabling live Telnyx command execution.",
    },
  ];

  return {
    provider: "telnyx",
    mode: executeCommands ? "live" : "dry_run",
    readyForDryRun: true,
    readyForLiveTraffic: webhookSignatureConfigured && executeCommands && apiKeyConfigured,
    checks,
  };
}
