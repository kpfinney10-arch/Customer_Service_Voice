import type { TenantConfig } from "./tenant-config.js";

export type TenantReadinessCheck = {
  name: string;
  ok: boolean;
  severity: "blocker" | "warning";
  message: string;
};

export type TenantReadiness = {
  tenantId: string;
  ready: boolean;
  checks: TenantReadinessCheck[];
};

export function evaluateTenantReadiness(config: TenantConfig): TenantReadiness {
  const checks: TenantReadinessCheck[] = [
    {
      name: "voice_intake_enabled",
      ok: config.features.voiceIntake,
      severity: "blocker",
      message: config.features.voiceIntake
        ? "Voice intake is enabled."
        : "Voice intake must be enabled before this tenant can receive first-call traffic.",
    },
    {
      name: "default_handoff_queue_configured",
      ok: config.handoff.defaultQueue.trim().length > 0,
      severity: "blocker",
      message: config.handoff.defaultQueue.trim()
        ? "Default handoff queue is configured."
        : "A default handoff queue is required.",
    },
    {
      name: "urgent_handoff_destination_configured",
      ok: Boolean(config.handoff.onCallPhone?.trim()),
      severity: "blocker",
      message: config.handoff.onCallPhone?.trim()
        ? "Urgent handoff destination is configured."
        : "An on-call phone is required for urgent first-call death reports.",
    },
    {
      name: "at_least_one_downstream_handoff_enabled",
      ok: config.features.crmHandoff || config.features.dispatchHandoff,
      severity: "warning",
      message:
        config.features.crmHandoff || config.features.dispatchHandoff
          ? "At least one downstream handoff tool is enabled."
          : "No CRM or dispatch handoff tools are enabled; calls can still route to a human.",
    },
  ];

  return {
    tenantId: config.tenantId,
    ready: checks.every((check) => check.severity !== "blocker" || check.ok),
    checks,
  };
}
