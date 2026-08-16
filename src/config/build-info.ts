import { readFileSync } from "node:fs";

export type BuildInfo = {
  serviceName: string;
  version: string;
  commit: string;
  buildTime: string;
};

export type DeploymentBuildMetadata = {
  commit?: string;
  buildTime?: string;
};

export function createBuildInfoFromEnv(
  env: Record<string, string | undefined> = process.env,
  metadata: DeploymentBuildMetadata = loadDeploymentBuildMetadata(env.SERVICE_BUILD_METADATA_PATH),
): BuildInfo {
  return {
    serviceName: env.SERVICE_NAME?.trim() || "voice-ai-platform",
    version: env.SERVICE_VERSION?.trim() || "0.1.0",
    commit:
      env.SERVICE_COMMIT?.trim() ||
      env.RENDER_GIT_COMMIT?.trim() ||
      metadata.commit?.trim() ||
      "local",
    buildTime: env.SERVICE_BUILD_TIME?.trim() || metadata.buildTime?.trim() || "local",
  };
}

export function loadDeploymentBuildMetadata(
  filePath = "dist/build-metadata.json",
): DeploymentBuildMetadata {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const metadata: DeploymentBuildMetadata = {};
    if (typeof parsed.commit === "string" && parsed.commit.trim()) {
      metadata.commit = parsed.commit;
    }
    if (typeof parsed.buildTime === "string" && parsed.buildTime.trim()) {
      metadata.buildTime = parsed.buildTime;
    }
    return metadata;
  } catch {
    return {};
  }
}
