export type BuildInfo = {
  serviceName: string;
  version: string;
  commit: string;
  buildTime: string;
};

export function createBuildInfoFromEnv(env: Record<string, string | undefined> = process.env): BuildInfo {
  return {
    serviceName: env.SERVICE_NAME?.trim() || "voice-ai-platform",
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    commit: env.SERVICE_COMMIT?.trim() || "local",
    buildTime: env.SERVICE_BUILD_TIME?.trim() || "local",
  };
}
