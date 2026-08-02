import { installGracefulShutdown } from "./graceful-shutdown.js";
import { createFirstCallService } from "./first-call-service.js";
import { createApiServer, listen } from "./http-server.js";
import { loadServerEnvironment } from "../config/server-environment.js";
import { createConsoleLogger } from "../observability/logger.js";
import { synchronizeOperatorUsers } from "../security/operator-users-config.js";

const logger = createConsoleLogger();
let closePersistence: (() => Promise<void>) | undefined;

try {
  const environment = loadServerEnvironment();
  closePersistence = environment.storage.close;
  await environment.storage.initialize();
  await synchronizeOperatorUsers(environment.operatorAuthStore, environment.operatorUsers);
  const service = createFirstCallService({
    store: environment.sessionStore,
    eventStore: environment.eventStore,
    tenantConfigStore: environment.tenantConfigStore,
    extractor: environment.firstCallExtractor,
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
    telnyxReadiness: environment.telnyxReadiness,
    twilioReadiness: environment.twilioReadiness,
    callHealthProbe: environment.callHealthProbe,
    operatorAuthService: environment.operatorAuthService,
    logger,
  });
  const url = await listen(server, environment.port, environment.host);
  installGracefulShutdown({
    server,
    logger,
    closeResources: environment.storage.close,
  });

  logger.lifecycle({
    type: "startup",
  });
  console.log(`voice-ai-platform listening on ${url}`);
} catch (error) {
  if (closePersistence) {
    await closePersistence().catch(() => {});
  }
  logger.error("Server startup failed.", {
    type: "startup_error",
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown startup error.",
  });
  process.exitCode = 1;
}
