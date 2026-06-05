import { timingSafeEqual } from "node:crypto";

export type TenantApiKeyVerifier = {
  verify: (tenantId: string, apiKey: string) => Promise<boolean> | boolean;
};

export class InMemoryTenantApiKeyVerifier implements TenantApiKeyVerifier {
  private keysByTenant = new Map<string, string>();

  constructor(keysByTenant: Record<string, string>) {
    for (const [tenantId, apiKey] of Object.entries(keysByTenant)) {
      if (tenantId.trim() && apiKey.trim()) {
        this.keysByTenant.set(tenantId, apiKey);
      }
    }
  }

  verify(tenantId: string, apiKey: string): boolean {
    const expected = this.keysByTenant.get(tenantId);
    if (!expected) return false;
    return safeEqual(expected, apiKey);
  }
}

export function createTenantApiKeyVerifierFromEnv(value = process.env.TENANT_API_KEYS): TenantApiKeyVerifier {
  return new InMemoryTenantApiKeyVerifier(parseTenantApiKeys(value ?? ""));
}

export function parseTenantApiKeys(value: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [tenantId, apiKey] = pair.split(":");
    if (tenantId?.trim() && apiKey?.trim()) {
      entries[tenantId.trim()] = apiKey.trim();
    }
  }
  return entries;
}

export function extractApiKeyFromHeaders(headers: Pick<Headers, "get">): string | undefined {
  const direct = headers.get("x-api-key");
  if (direct?.trim()) return direct.trim();

  const authorization = headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || undefined;
}

function safeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
