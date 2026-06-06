import { createApiServer, listen } from "./http-server.js";
import { loadServerEnvironment } from "../config/server-environment.js";

try {
  const environment = loadServerEnvironment();
  const server = createApiServer({
    apiKeyVerifier: environment.apiKeyVerifier,
    tenantConfigStore: environment.tenantConfigStore,
    rateLimiter: environment.rateLimiter,
  });
  const url = await listen(server, environment.port, "127.0.0.1");

  console.log(`voice-ai-platform listening on ${url}`);
} catch (error) {
  console.error(
    JSON.stringify({
      level: "error",
      type: "startup_error",
      errorName: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown startup error.",
    }),
  );
  process.exitCode = 1;
}
