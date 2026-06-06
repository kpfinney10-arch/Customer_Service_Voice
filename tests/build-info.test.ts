import assert from "node:assert/strict";
import { test } from "node:test";
import { createBuildInfoFromEnv } from "../src/config/build-info.js";

test("build info uses safe local defaults", () => {
  const build = createBuildInfoFromEnv({});

  assert.deepEqual(build, {
    serviceName: "voice-ai-platform",
    version: "0.1.0",
    commit: "local",
    buildTime: "local",
  });
});

test("build info loads deployment metadata from environment", () => {
  const build = createBuildInfoFromEnv({
    SERVICE_NAME: "voice-ai-platform",
    SERVICE_VERSION: "1.2.3",
    SERVICE_COMMIT: "abc123",
    SERVICE_BUILD_TIME: "2026-06-06T12:00:00.000Z",
  });

  assert.equal(build.version, "1.2.3");
  assert.equal(build.commit, "abc123");
  assert.equal(build.buildTime, "2026-06-06T12:00:00.000Z");
});
