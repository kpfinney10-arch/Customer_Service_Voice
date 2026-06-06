import { createRateLimiterFromEnv } from "../security/rate-limit.js";
import type { RateLimiter } from "../security/rate-limit.js";
import {
  createTenantApiKeyVerifierFromEnv,
  parseTenantApiKeys,
} from "../security/tenant-auth.js";
import type { TenantApiKeyVerifier } from "../security/tenant-auth.js";
import { createTenantConfigStoreFromEnv } from "../tenants/tenant-config.js";
import type { TenantConfigStore } from "../tenants/tenant-config.js";

export type ServerEnvironment = {
  port: number;
  tenantConfigStore: TenantConfigStore;
  apiKeyVerifier: TenantApiKeyVerifier;
  rateLimiter: RateLimiter;
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
  return {
    port: parsePort(env.PORT),
    tenantConfigStore: createTenantConfigStoreFromEnv(env.TENANT_CONFIGS_JSON),
    apiKeyVerifier: createTenantApiKeyVerifierFromEnv(env.TENANT_API_KEYS),
    rateLimiter: createRateLimiterFromEnv({
      limit: env.RATE_LIMIT_PER_WINDOW,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    }),
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
