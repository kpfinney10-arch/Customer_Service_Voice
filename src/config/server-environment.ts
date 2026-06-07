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
import type { IdempotencyStore } from "../security/idempotency.js";
import type { SessionStore } from "../session/in-memory-session-store.js";
import { createWebhookSignatureVerifierFromEnv } from "../security/webhook-signature.js";
import type { WebhookSignatureVerifier } from "../security/webhook-signature.js";
import { createTenantConfigStoreFromEnv } from "../tenants/tenant-config.js";
import type { TenantConfigStore } from "../tenants/tenant-config.js";

export type ServerEnvironment = {
  port: number;
  tenantConfigStore: TenantConfigStore;
  apiKeyVerifier: TenantApiKeyVerifier;
  rateLimiter: RateLimiter;
  buildInfo: BuildInfo;
  storage: {
    driver: StorageDriver;
    dataDir?: string;
  };
  sessionStore: SessionStore;
  eventStore: EventStore;
  idempotencyStore: IdempotencyStore;
  webhookSignatureVerifier: WebhookSignatureVerifier;
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
  };
  if (persistence.dataDir) storage.dataDir = persistence.dataDir;

  return {
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
    idempotencyStore: persistence.idempotencyStore,
    webhookSignatureVerifier: createWebhookSignatureVerifierFromEnv(env),
  };
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
