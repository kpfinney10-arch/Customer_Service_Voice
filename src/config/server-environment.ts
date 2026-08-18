import { createBuildInfoFromEnv } from "./build-info.js";
import type { BuildInfo } from "./build-info.js";
import { createRateLimiterFromEnv } from "../security/rate-limit.js";
import type { RateLimiter } from "../security/rate-limit.js";
import { createPersistenceStoresFromEnv } from "../persistence/storage-factory.js";
import type { StorageDriver } from "../persistence/storage-factory.js";
import {
  createTenantApiKeyVerifierFromEnv,
  parseTenantApiKeys,
} from "../security/tenant-auth.js";
import type { TenantApiKeyVerifier } from "../security/tenant-auth.js";
import type { EventStore } from "../events/in-memory-event-store.js";
import {
  callAlertWindowSecondsFromEnv,
  EventStoreCallHealthProbe,
  longTurnAlertMsFromEnv,
  repeatedPromptAlertCountFromEnv,
} from "../observability/call-health.js";
import type { CallHealthProbe } from "../observability/call-health.js";
import type { IdempotencyStore } from "../security/idempotency.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import { createWebhookSignatureVerifierFromEnv } from "../security/webhook-signature.js";
import type { WebhookSignatureVerifier } from "../security/webhook-signature.js";
import { createTelnyxCallControlClientFromEnv } from "../providers/telephony/telnyx-client.js";
import type { TelnyxCallControlClient } from "../providers/telephony/telnyx-client.js";
import { evaluateTelnyxReadinessFromEnv } from "../providers/telephony/telnyx-readiness.js";
import type { TelnyxReadiness } from "../providers/telephony/telnyx-readiness.js";
import { evaluateTwilioReadinessFromEnv } from "../providers/telephony/twilio-readiness.js";
import type { TwilioReadiness } from "../providers/telephony/twilio-readiness.js";
import { createTwilioConversationRelayConfigFromEnv } from "../providers/telephony/twilio-conversation-relay-config.js";
import type { TwilioConversationRelayConfig } from "../providers/telephony/twilio-conversation-relay-config.js";
import { createTenantConfigStoreFromEnv } from "../tenants/tenant-config.js";
import type { TenantConfigStore } from "../tenants/tenant-config.js";
import { createFirstCallExtractorFromEnv } from "./first-call-extractor-environment.js";
import type { FirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import { OperatorAuthService } from "../security/operator-auth.js";
import type { OperatorUser } from "../security/operator-auth-store.js";
import { parseOperatorUsers } from "../security/operator-users-config.js";
import type { OperatorAuthStore } from "../security/operator-auth-store.js";

export type ServerEnvironment = {
  host: string;
  port: number;
  tenantConfigStore: TenantConfigStore;
  apiKeyVerifier: TenantApiKeyVerifier;
  rateLimiter: RateLimiter;
  buildInfo: BuildInfo;
  storage: {
    driver: StorageDriver;
    dataDir?: string;
    initialize: () => Promise<void>;
    close: () => Promise<void>;
  };
  sessionStore: SessionStore;
  eventStore: EventStore;
  callHealthProbe: CallHealthProbe;
  idempotencyStore: IdempotencyStore;
  webhookSignatureVerifier: WebhookSignatureVerifier;
  telnyxClient: TelnyxCallControlClient;
  telnyxReadiness: TelnyxReadiness;
  twilioReadiness: TwilioReadiness;
  twilioConversationRelayConfig: TwilioConversationRelayConfig;
  firstCallExtractor: FirstCallExtractor;
  operatorAuthService: OperatorAuthService;
  operatorAuthStore: OperatorAuthStore;
  operatorUsers: OperatorUser[];
};

export class ServerEnvironmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServerEnvironmentError";
  }
}

export function loadServerEnvironment(env: Record<string, string | undefined> = process.env): ServerEnvironment {
  validateTenantApiKeys(env.TENANT_API_KEYS);
  const persistence = createPersistenceStoresFromEnv(env);
  const storage: ServerEnvironment["storage"] = {
    driver: persistence.driver,
    initialize: persistence.initialize,
    close: persistence.close,
  };
  if (persistence.dataDir) storage.dataDir = persistence.dataDir;

  return {
    host: parseHost(env.HOST),
    port: parsePort(env.PORT),
    tenantConfigStore: createTenantConfigStoreFromEnv(env.TENANT_CONFIGS_JSON),
    apiKeyVerifier: createTenantApiKeyVerifierFromEnv(env.TENANT_API_KEYS),
    rateLimiter: createRateLimiterFromEnv({
      limit: env.RATE_LIMIT_PER_WINDOW,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    }),
    buildInfo: createBuildInfoFromEnv(env),
    storage,
    sessionStore: persistence.sessionStore,
    eventStore: persistence.eventStore,
    callHealthProbe: new EventStoreCallHealthProbe(persistence.eventStore, {
      windowSeconds: callAlertWindowSecondsFromEnv(env.CALL_ALERT_WINDOW_SECONDS),
      longTurnThresholdMs: longTurnAlertMsFromEnv(env.CALL_ALERT_LONG_TURN_MS),
      repeatedPromptThreshold: repeatedPromptAlertCountFromEnv(
        env.CALL_ALERT_REPEATED_PROMPT_COUNT,
      ),
    }),
    idempotencyStore: persistence.idempotencyStore,
    webhookSignatureVerifier: createWebhookSignatureVerifierFromEnv(env),
    telnyxClient: createTelnyxCallControlClientFromEnv(env),
    telnyxReadiness: evaluateTelnyxReadinessFromEnv(env),
    twilioReadiness: evaluateTwilioReadinessFromEnv(env),
    twilioConversationRelayConfig: createTwilioConversationRelayConfigFromEnv(env),
    firstCallExtractor: createFirstCallExtractorFromEnv(env),
    operatorAuthService: new OperatorAuthService(persistence.operatorAuthStore, {
      absoluteTtlMs: parseDurationMinutes(env.OPERATOR_SESSION_ABSOLUTE_MINUTES, 480, "OPERATOR_SESSION_ABSOLUTE_MINUTES"),
      idleTtlMs: parseDurationMinutes(env.OPERATOR_SESSION_IDLE_MINUTES, 30, "OPERATOR_SESSION_IDLE_MINUTES"),
      secureCookie: parseBoolean(env.OPERATOR_COOKIE_SECURE, true, "OPERATOR_COOKIE_SECURE"),
    }),
    operatorAuthStore: persistence.operatorAuthStore,
    operatorUsers: parseOperatorUsers(env.OPERATOR_USERS_JSON),
  };
}

function parseDurationMinutes(value: string | undefined, fallbackMinutes: number, name: string): number {
  if (!value?.trim()) return fallbackMinutes * 60_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 1_440) {
    throw new ServerEnvironmentError("INVALID_OPERATOR_SESSION_DURATION", `${name} must be an integer between 5 and 1440.`);
  }
  return parsed * 60_000;
}

function parseBoolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (!value?.trim()) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ServerEnvironmentError("INVALID_BOOLEAN", `${name} must be true or false.`);
}

function parseHost(value: string | undefined): string {
  const host = value?.trim() || "127.0.0.1";
  if (host.includes("/") || host.includes("://") || /\s/.test(host)) {
    throw new ServerEnvironmentError(
      "INVALID_HOST",
      "HOST must be a hostname or IP address without a scheme, path, or whitespace.",
    );
  }
  return host;
}

function parsePort(value: string | undefined): number {
  if (!value?.trim()) return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new ServerEnvironmentError("INVALID_PORT", "PORT must be an integer between 1 and 65535.");
  }
  return parsed;
}

function validateTenantApiKeys(value: string | undefined): void {
  if (Object.keys(parseTenantApiKeys(value ?? "")).length === 0) {
    throw new ServerEnvironmentError(
      "TENANT_API_KEYS_REQUIRED",
      "TENANT_API_KEYS must include at least one tenantId:apiKey pair.",
    );
  }
}
