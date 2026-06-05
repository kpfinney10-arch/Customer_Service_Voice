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

export class InMemoryTenantConfigStore implements TenantConfigStore {
  private readonly configs: Map<string, TenantConfig>;

  constructor(configs: Record<string, TenantConfig> = {}) {
    this.configs = new Map(Object.entries(configs));
  }

  async get(tenantId: string): Promise<TenantConfig | undefined> {
    return this.configs.get(tenantId);
  }
}

export function createDefaultTenantConfigStore(): TenantConfigStore {
  return new InMemoryTenantConfigStore({
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
  });
}
