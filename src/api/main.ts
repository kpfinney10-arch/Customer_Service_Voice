import { installGracefulShutdown } from "./graceful-shutdown.js";
import { createFirstCallService } from "./first-call-service.js";
import { createApiServer, listen } from "./http-server.js";
import { loadServerEnvironment } from "../config/server-environment.js";
import { createConsoleLogger } from "../observability/logger.js";

const logger = createConsoleLogger();

try {
  const environment = loadServerEnvironment();
  const service = createFirstCallService({
    store: environment.sessionStore,
    eventStore: environment.eventStore,
    tenantConfigStore: environment.tenantConfigStore,
  });
  const server = createApiServer({
    service,
    apiKeyVerifier: environment.apiKeyVerifier,
    tenantConfigStore: environment.tenantConfigStore,
    rateLimiter: environment.rateLimiter,
    buildInfo: environment.buildInfo,
    idempotencyStore: environment.idempotencyStore,
    webhookSignatureVerifier: environment.webhookSignatureVerifier,
    telnyxClient: environment.telnyxClient,
    logger,
  });
  const url = await listen(server, environment.port, "127.0.0.1");
  installGracefulShutdown({
    server,
    logger,
  });

  logger.lifecycle({
    type: "startup",
  });
  console.log(`voice-ai-platform listening on ${url}`);
} catch (error) {
  logger.error("Server startup failed.", {
    type: "startup_error",
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown startup error.",
  });
  process.exitCode = 1;
}
