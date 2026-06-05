export type TenantHandoffConfig = {
  defaultQueue: string;
  onCallPhone?: string;
  dispatchDeskPhone?: string;
  afterHoursQueue?: string;
};

export type TenantConfig = {
  tenantId: string;
  displayName: string;
  timezone: string;
  handoff: TenantHandoffConfig;
  features: {
    crmHandoff: boolean;
    dispatchHandoff: boolean;
    voiceIntake: boolean;
  };
};

export type TenantConfigStore = {
  get: (tenantId: string) => Promise<TenantConfig | undefined>;
};

export class TenantConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantConfigParseError";
  }
}

export class InMemoryTenantConfigStore implements TenantConfigStore {
  private readonly configs: Map<string, TenantConfig>;

  constructor(configs: Record<string, TenantConfig> = {}) {
    this.configs = new Map(Object.entries(configs));
  }

  async get(tenantId: string): Promise<TenantConfig | undefined> {
    return this.configs.get(tenantId);
  }
}

export function createTenantConfigStoreFromEnv(value = process.env.TENANT_CONFIGS_JSON): TenantConfigStore {
  const parsed = parseTenantConfigsJson(value);
  return new InMemoryTenantConfigStore(parsed ?? defaultTenantConfigs());
}

export function createDefaultTenantConfigStore(): TenantConfigStore {
  return new InMemoryTenantConfigStore(defaultTenantConfigs());
}

export function parseTenantConfigsJson(value: string | undefined): Record<string, TenantConfig> | undefined {
  if (!value?.trim()) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TenantConfigParseError("TENANT_CONFIGS_JSON must be valid JSON.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TenantConfigParseError("TENANT_CONFIGS_JSON must be a JSON object keyed by tenant id.");
  }

  const configs: Record<string, TenantConfig> = {};
  for (const [tenantId, config] of Object.entries(parsed)) {
    configs[tenantId] = normalizeTenantConfig(tenantId, config);
  }
  return configs;
}

function defaultTenantConfigs(): Record<string, TenantConfig> {
  return {
    "fh-demo": {
      tenantId: "fh-demo",
      displayName: "Demo Funeral Home",
      timezone: "America/Chicago",
      handoff: {
        defaultQueue: "first-call-dispatch",
        onCallPhone: "+15555550100",
        dispatchDeskPhone: "+15555550101",
        afterHoursQueue: "first-call-after-hours",
      },
      features: {
        crmHandoff: true,
        dispatchHandoff: true,
        voiceIntake: true,
      },
    },
  };
}

function normalizeTenantConfig(tenantId: string, value: unknown): TenantConfig {
  if (!tenantId.trim()) {
    throw new TenantConfigParseError("Tenant config keys must be non-empty tenant ids.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TenantConfigParseError(`Tenant config for ${tenantId} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const handoff = requiredObject(record.handoff, `Tenant config for ${tenantId} must include handoff.`);
  const features = requiredObject(record.features, `Tenant config for ${tenantId} must include features.`);

  return {
    tenantId: requiredString(record.tenantId ?? tenantId, `Tenant config for ${tenantId} must include tenantId.`),
    displayName: requiredString(
      record.displayName,
      `Tenant config for ${tenantId} must include displayName.`,
    ),
    timezone: requiredString(record.timezone, `Tenant config for ${tenantId} must include timezone.`),
    handoff: normalizeHandoffConfig(tenantId, handoff),
    features: {
      crmHandoff: requiredBoolean(features.crmHandoff, `Tenant config for ${tenantId} must include features.crmHandoff.`),
      dispatchHandoff: requiredBoolean(
        features.dispatchHandoff,
        `Tenant config for ${tenantId} must include features.dispatchHandoff.`,
      ),
      voiceIntake: requiredBoolean(features.voiceIntake, `Tenant config for ${tenantId} must include features.voiceIntake.`),
    },
  };
}

function normalizeHandoffConfig(tenantId: string, value: Record<string, unknown>): TenantHandoffConfig {
  const handoff: TenantHandoffConfig = {
    defaultQueue: requiredString(
      value.defaultQueue,
      `Tenant config for ${tenantId} must include handoff.defaultQueue.`,
    ),
  };
  addIfPresent(handoff, "onCallPhone", optionalString(value.onCallPhone));
  addIfPresent(handoff, "dispatchDeskPhone", optionalString(value.dispatchDeskPhone));
  addIfPresent(handoff, "afterHoursQueue", optionalString(value.afterHoursQueue));
  return handoff;
}

function requiredObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TenantConfigParseError(message);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TenantConfigParseError(message);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value.trim();
}

function requiredBoolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") {
    throw new TenantConfigParseError(message);
  }
  return value;
}

function addIfPresent<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): asserts target is T & Record<K, V> {
  if (value !== undefined) {
    Object.assign(target, { [key]: value });
  }
}
