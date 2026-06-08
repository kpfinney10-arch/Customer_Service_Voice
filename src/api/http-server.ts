import http from "node:http";
import type { AddressInfo } from "node:net";
import { createBuildInfoFromEnv } from "../config/build-info.js";
import type { BuildInfo } from "../config/build-info.js";
import { InMemoryEventStore } from "../events/in-memory-event-store.js";
import { createConsoleLogger, createNoopLogger } from "../observability/logger.js";
import type { Logger } from "../observability/logger.js";
import { createFakeSpeechAdapters } from "../providers/speech/fake-speech-adapters.js";
import type { SpeechAdapters } from "../providers/speech/speech-adapters.js";
import { createRateLimiterFromEnv } from "../security/rate-limit.js";
import type { RateLimitDecision, RateLimiter } from "../security/rate-limit.js";
import {
  IdempotencyConflictError,
  InMemoryIdempotencyStore,
  resolveIdempotentOperation,
} from "../security/idempotency.js";
import type { IdempotencyStore } from "../security/idempotency.js";
import {
  createTenantApiKeyVerifierFromEnv,
  extractApiKeyFromHeaders,
} from "../security/tenant-auth.js";
import type { TenantApiKeyVerifier } from "../security/tenant-auth.js";
import {
  createWebhookSignatureVerifierFromEnv,
  NoopWebhookSignatureVerifier,
  WebhookSignatureError,
} from "../security/webhook-signature.js";
import type { WebhookSignatureVerifier } from "../security/webhook-signature.js";
import { InMemorySessionStore } from "../session/in-memory-session-store.js";
import { createTenantConfigStoreFromEnv } from "../tenants/tenant-config.js";
import type { TenantConfigStore } from "../tenants/tenant-config.js";
import { evaluateTenantReadiness } from "../tenants/tenant-readiness.js";
import {
  handleTelephonyAudioTurn,
  handleInboundTelephonyCall,
  handleTelephonyCallEnd,
  handleTelephonyInterrupt,
  handleTelephonySpeechTurn,
} from "../providers/telephony/inbound-call.js";
import {
  createTelnyxCommands,
  translateTelnyxWebhook,
} from "../providers/telephony/telnyx-adapter.js";
import { NoopTelnyxCallControlClient } from "../providers/telephony/telnyx-client.js";
import type { TelnyxCallControlClient } from "../providers/telephony/telnyx-client.js";
import { createFirstCallService, FirstCallServiceError } from "./first-call-service.js";
import type { FirstCallService } from "./first-call-service.js";

export type ApiServerOptions = {
  service?: FirstCallService;
  apiKeyVerifier?: TenantApiKeyVerifier;
  speechAdapters?: SpeechAdapters;
  tenantConfigStore?: TenantConfigStore;
  logger?: Logger;
  rateLimiter?: RateLimiter;
  buildInfo?: BuildInfo;
  idempotencyStore?: IdempotencyStore;
  webhookSignatureVerifier?: WebhookSignatureVerifier;
  telnyxClient?: TelnyxCallControlClient;
};

export function createApiServer(options: ApiServerOptions = {}): http.Server {
  const tenantConfigStore = options.tenantConfigStore ?? createTenantConfigStoreFromEnv();
  const service =
    options.service ??
    createFirstCallService({
      store: new InMemorySessionStore(),
      eventStore: new InMemoryEventStore(),
      tenantConfigStore,
    });
  const apiKeyVerifier = options.apiKeyVerifier ?? createTenantApiKeyVerifierFromEnv();
  const speechAdapters = options.speechAdapters ?? createFakeSpeechAdapters();
  const logger = options.logger ?? createConsoleLogger();
  const rateLimiter = options.rateLimiter ?? createRateLimiterFromEnv();
  const buildInfo = options.buildInfo ?? createBuildInfoFromEnv();
  const idempotencyStore = options.idempotencyStore ?? new InMemoryIdempotencyStore();
  const webhookSignatureVerifier = options.webhookSignatureVerifier ?? createWebhookSignatureVerifierFromEnv();
  const telnyxClient = options.telnyxClient ?? new NoopTelnyxCallControlClient();

  return http.createServer(async (request, response) => {
    const startedAt = Date.now();
    const method = request.method ?? "GET";
    const path = request.url ? new URL(request.url, "http://localhost").pathname : "/";
    const requestId = requestIdFromIncomingMessage(request);
    response.setHeader("x-request-id", requestId);
    let errorCode: string | undefined;
    try {
      if (!isPublicOperationalPath(method, path)) {
        enforceRateLimit({
          limiter: rateLimiter,
          method,
          path,
          requestKey: tenantIdFromPath(path) ?? "anonymous",
        });
      }
      await routeRequest(
        service,
        apiKeyVerifier,
        speechAdapters,
        tenantConfigStore,
        buildInfo,
        idempotencyStore,
        webhookSignatureVerifier,
        telnyxClient,
        request,
        response,
      );
    } catch (error) {
      if (error instanceof ApiError) {
        errorCode = error.code;
        sendJson(response, error.statusCode, { error: error.code, message: error.message }, error.headers);
        return;
      }
      if (error instanceof FirstCallServiceError) {
        errorCode = error.code;
        sendJson(response, firstCallServiceStatusCode(error), { error: error.code, message: error.message });
        return;
      }
      if (error instanceof IdempotencyConflictError) {
        errorCode = "IDEMPOTENCY_KEY_CONFLICT";
        sendJson(response, 409, {
          error: "IDEMPOTENCY_KEY_CONFLICT",
          message: error.message,
        });
        return;
      }
      if (error instanceof WebhookSignatureError) {
        errorCode = "WEBHOOK_SIGNATURE_INVALID";
        sendJson(response, 401, {
          error: "WEBHOOK_SIGNATURE_INVALID",
          message: error.message,
        });
        return;
      }
      errorCode = "INTERNAL_SERVER_ERROR";
      sendJson(response, 500, {
        error: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      });
    } finally {
      logger.request(
        createApiRequestLog({
          method,
          path,
          requestId,
          statusCode: response.statusCode,
          startedAt,
          errorCode,
        }),
      );
    }
  });
}

export async function listen(server: http.Server, port: number, host = "127.0.0.1"): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://${address.address}:${address.port}`;
}

export async function handleApiRequest(
  service: FirstCallService,
  request: Request,
  apiKeyVerifier: TenantApiKeyVerifier,
  speechAdapters: SpeechAdapters = createFakeSpeechAdapters(),
  tenantConfigStore?: TenantConfigStore,
  logger: Logger = createNoopLogger(),
  rateLimiter?: RateLimiter,
  buildInfo: BuildInfo = createBuildInfoFromEnv(),
  idempotencyStore: IdempotencyStore = new InMemoryIdempotencyStore(),
  webhookSignatureVerifier: WebhookSignatureVerifier = new NoopWebhookSignatureVerifier(),
  telnyxClient: TelnyxCallControlClient = new NoopTelnyxCallControlClient(),
): Promise<Response> {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const requestId = requestIdFromHeaders(request.headers);
  let response: Response | undefined;
  let errorCode: string | undefined;
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      response = jsonResponse(200, { ok: true });
      response.headers.set("x-request-id", requestId);
      return response;
    }

    if (request.method === "GET" && url.pathname === "/version") {
      response = jsonResponse(200, { build: buildInfo });
      response.headers.set("x-request-id", requestId);
      return response;
    }

    if (rateLimiter) {
      enforceRateLimit({
        limiter: rateLimiter,
        method: request.method,
        path: url.pathname,
        requestKey: tenantIdFromPath(url.pathname) ?? "anonymous",
      });
    }

    const tenantConfigMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/config$/);
    if (request.method === "GET" && tenantConfigMatch?.[1]) {
      const tenantId = decodeURIComponent(tenantConfigMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      if (!tenantConfigStore) {
        throw new ApiError(404, "TENANT_CONFIG_NOT_FOUND", "Tenant config was not found.");
      }
      const config = await tenantConfigStore.get(tenantId);
      if (!config) {
        throw new ApiError(404, "TENANT_CONFIG_NOT_FOUND", "Tenant config was not found.");
      }
      response = jsonResponse(200, { tenantConfig: config });
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const tenantReadinessMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/readiness$/);
    if (request.method === "GET" && tenantReadinessMatch?.[1]) {
      const tenantId = decodeURIComponent(tenantReadinessMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      if (!tenantConfigStore) {
        throw new ApiError(404, "TENANT_CONFIG_NOT_FOUND", "Tenant config was not found.");
      }
      const config = await tenantConfigStore.get(tenantId);
      if (!config) {
        throw new ApiError(404, "TENANT_CONFIG_NOT_FOUND", "Tenant config was not found.");
      }
      response = jsonResponse(200, { readiness: evaluateTenantReadiness(config) });
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const tenantActivityMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/diagnostics\/activity$/);
    if (request.method === "GET" && tenantActivityMatch?.[1]) {
      const tenantId = decodeURIComponent(tenantActivityMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const input = { tenantId };
      addIfPresent(input, "limit", optionalPositiveIntegerFromQuery(url.searchParams.get("limit"), "limit"));
      response = jsonResponse(200, await service.listTenantActivity(input));
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const startMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions$/);
    if (request.method === "POST" && startMatch?.[1]) {
      const tenantId = decodeURIComponent(startMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const input = {
        tenantId,
      };
      addIfPresent(input, "callId", optionalString(body.callId, "callId"));
      addIfPresent(input, "sessionId", optionalString(body.sessionId, "sessionId"));
      addIfPresent(input, "callerPhone", optionalString(body.callerPhone, "callerPhone"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 201, body: await service.startSession(input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const telnyxWebhookMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/telephony\/telnyx\/webhook$/);
    if (request.method === "POST" && telnyxWebhookMatch?.[1]) {
      const tenantId = decodeURIComponent(telnyxWebhookMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const { body, rawBody } = await readWebJsonPayload(request);
      await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
        provider: "telnyx",
        method: request.method,
        path: url.pathname,
        rawBody,
        headers: request.headers,
      });
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({
          statusCode: 200,
          body: await handleTelnyxWebhook(service, telnyxClient, tenantId, body),
        }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const inboundCallMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/inbound-call$/);
    if (request.method === "POST" && inboundCallMatch?.[1] && inboundCallMatch[2]) {
      const tenantId = decodeURIComponent(inboundCallMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const provider = decodeURIComponent(inboundCallMatch[2]);
      const { body, rawBody } = await readWebJsonPayload(request);
      await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
        provider,
        method: request.method,
        path: url.pathname,
        rawBody,
        headers: request.headers,
      });
      const input = {
        tenantId,
        provider,
        providerCallId: requiredString(body.providerCallId, "providerCallId"),
      };
      addIfPresent(input, "fromPhone", optionalString(body.fromPhone, "fromPhone"));
      addIfPresent(input, "toPhone", optionalString(body.toPhone, "toPhone"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 201, body: await handleInboundTelephonyCall(service, input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const speechTurnMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/speech-turn$/,
    );
    if (request.method === "POST" && speechTurnMatch?.[1] && speechTurnMatch[2] && speechTurnMatch[3]) {
      const tenantId = decodeURIComponent(speechTurnMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const provider = decodeURIComponent(speechTurnMatch[2]);
      const { body, rawBody } = await readWebJsonPayload(request);
      await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
        provider,
        method: request.method,
        path: url.pathname,
        rawBody,
        headers: request.headers,
      });
      const input = {
        tenantId,
        provider,
        providerCallId: decodeURIComponent(speechTurnMatch[3]),
        transcript: requiredString(body.transcript, "transcript"),
      };
      addIfPresent(input, "confidence", optionalNumber(body.confidence, "confidence"));
      addIfPresent(input, "isFinal", optionalBoolean(body.isFinal, "isFinal"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 200, body: await handleTelephonySpeechTurn(service, input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const audioTurnMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/audio-turn$/,
    );
    if (request.method === "POST" && audioTurnMatch?.[1] && audioTurnMatch[2] && audioTurnMatch[3]) {
      const tenantId = decodeURIComponent(audioTurnMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const provider = decodeURIComponent(audioTurnMatch[2]);
      const { body, rawBody } = await readWebJsonPayload(request);
      await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
        provider,
        method: request.method,
        path: url.pathname,
        rawBody,
        headers: request.headers,
      });
      const input = {
        tenantId,
        provider,
        providerCallId: decodeURIComponent(audioTurnMatch[3]),
        audio: {
          contentType: requiredString(body.audioContentType, "audioContentType"),
          bytesBase64: requiredString(body.audioBytesBase64, "audioBytesBase64"),
        },
      };
      addIfPresent(input, "languageCode", optionalString(body.languageCode, "languageCode"));
      addIfPresent(input, "voice", optionalString(body.voice, "voice"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 200, body: await handleTelephonyAudioTurn(service, speechAdapters, input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const interruptMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/interrupt$/,
    );
    if (request.method === "POST" && interruptMatch?.[1] && interruptMatch[2] && interruptMatch[3]) {
      const tenantId = decodeURIComponent(interruptMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const provider = decodeURIComponent(interruptMatch[2]);
      const { body, rawBody } = await readWebJsonPayload(request);
      await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
        provider,
        method: request.method,
        path: url.pathname,
        rawBody,
        headers: request.headers,
      });
      const input = {
        tenantId,
        provider,
        providerCallId: decodeURIComponent(interruptMatch[3]),
        reason: requiredString(body.reason, "reason"),
      };
      addIfPresent(input, "interruptedOutput", optionalString(body.interruptedOutput, "interruptedOutput"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 200, body: await handleTelephonyInterrupt(service, input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const callEndMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/end$/,
    );
    if (request.method === "POST" && callEndMatch?.[1] && callEndMatch[2] && callEndMatch[3]) {
      const tenantId = decodeURIComponent(callEndMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const provider = decodeURIComponent(callEndMatch[2]);
      const { body, rawBody } = await readWebJsonPayload(request);
      await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
        provider,
        method: request.method,
        path: url.pathname,
        rawBody,
        headers: request.headers,
      });
      const input = {
        tenantId,
        provider,
        providerCallId: decodeURIComponent(callEndMatch[3]),
      };
      addIfPresent(input, "reason", optionalString(body.reason, "reason"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 200, body: await handleTelephonyCallEnd(service, input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const transcriptMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/transcript$/,
    );
    if (request.method === "POST" && transcriptMatch?.[1] && transcriptMatch[2]) {
      const tenantId = decodeURIComponent(transcriptMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const transcript = requiredString(body.transcript, "transcript");
      const input = {
        tenantId,
        sessionId: decodeURIComponent(transcriptMatch[2]),
        transcript,
      };
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await resolveIdempotentOperation({
        store: idempotencyStore,
        tenantId,
        key: idempotencyKeyFromHeaders(request.headers),
        method: request.method,
        path: url.pathname,
        body,
        execute: async () => ({ statusCode: 200, body: await service.handleTranscript(input) }),
      });
      response = idempotentJsonResponse(output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const eventsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/events$/);
    if (request.method === "GET" && eventsMatch?.[1] && eventsMatch[2]) {
      const tenantId = decodeURIComponent(eventsMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const output = await service.listEvents({
        tenantId,
        sessionId: decodeURIComponent(eventsMatch[2]),
      });
      response = jsonResponse(200, output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    const replayMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/replay$/);
    if (request.method === "GET" && replayMatch?.[1] && replayMatch[2]) {
      const tenantId = decodeURIComponent(replayMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const output = await service.replaySession({
        tenantId,
        sessionId: decodeURIComponent(replayMatch[2]),
      });
      response = jsonResponse(200, output);
      response.headers.set("x-request-id", requestId);
      return response;
    }

    errorCode = "ROUTE_NOT_FOUND";
    response = jsonResponse(404, {
      error: "ROUTE_NOT_FOUND",
      message: "No route matched the request.",
    });
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      errorCode = error.code;
      response = jsonResponse(error.statusCode, { error: error.code, message: error.message }, error.headers);
      response.headers.set("x-request-id", requestId);
      return response;
    }
    if (error instanceof IdempotencyConflictError) {
      errorCode = "IDEMPOTENCY_KEY_CONFLICT";
      response = jsonResponse(409, {
        error: "IDEMPOTENCY_KEY_CONFLICT",
        message: error.message,
      });
      response.headers.set("x-request-id", requestId);
      return response;
    }
    if (error instanceof WebhookSignatureError) {
      errorCode = "WEBHOOK_SIGNATURE_INVALID";
      response = jsonResponse(401, {
        error: "WEBHOOK_SIGNATURE_INVALID",
        message: error.message,
      });
      response.headers.set("x-request-id", requestId);
      return response;
    }
    if (error instanceof FirstCallServiceError) {
      errorCode = error.code;
      response = jsonResponse(firstCallServiceStatusCode(error), { error: error.code, message: error.message });
      response.headers.set("x-request-id", requestId);
      return response;
    }
    errorCode = "INTERNAL_SERVER_ERROR";
    response = jsonResponse(500, {
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    });
    response.headers.set("x-request-id", requestId);
    return response;
  } finally {
    logger.request(
      createApiRequestLog({
        method: request.method,
        path: url.pathname,
        requestId,
        statusCode: response?.status ?? 500,
        startedAt,
        errorCode,
      }),
    );
  }
}

async function routeRequest(
  service: FirstCallService,
  apiKeyVerifier: TenantApiKeyVerifier,
  speechAdapters: SpeechAdapters,
  tenantConfigStore: TenantConfigStore,
  buildInfo: BuildInfo,
  idempotencyStore: IdempotencyStore,
  webhookSignatureVerifier: WebhookSignatureVerifier,
  telnyxClient: TelnyxCallControlClient,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/version") {
    sendJson(response, 200, { build: buildInfo });
    return;
  }

  const tenantConfigMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/config$/);
  if (method === "GET" && tenantConfigMatch?.[1]) {
    const tenantId = decodeURIComponent(tenantConfigMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const config = await tenantConfigStore.get(tenantId);
    if (!config) {
      throw new ApiError(404, "TENANT_CONFIG_NOT_FOUND", "Tenant config was not found.");
    }
    sendJson(response, 200, { tenantConfig: config });
    return;
  }

  const tenantReadinessMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/readiness$/);
  if (method === "GET" && tenantReadinessMatch?.[1]) {
    const tenantId = decodeURIComponent(tenantReadinessMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const config = await tenantConfigStore.get(tenantId);
    if (!config) {
      throw new ApiError(404, "TENANT_CONFIG_NOT_FOUND", "Tenant config was not found.");
    }
    sendJson(response, 200, { readiness: evaluateTenantReadiness(config) });
    return;
  }

  const tenantActivityMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/diagnostics\/activity$/);
  if (method === "GET" && tenantActivityMatch?.[1]) {
    const tenantId = decodeURIComponent(tenantActivityMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const input = { tenantId };
    addIfPresent(input, "limit", optionalPositiveIntegerFromQuery(url.searchParams.get("limit"), "limit"));
    sendJson(response, 200, await service.listTenantActivity(input));
    return;
  }

  const startMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions$/);
  if (method === "POST" && startMatch?.[1]) {
    const tenantId = decodeURIComponent(startMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const input = {
      tenantId,
    };
    addIfPresent(input, "callId", optionalString(body.callId, "callId"));
    addIfPresent(input, "sessionId", optionalString(body.sessionId, "sessionId"));
    addIfPresent(input, "callerPhone", optionalString(body.callerPhone, "callerPhone"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 201, body: await service.startSession(input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const telnyxWebhookMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/telephony\/telnyx\/webhook$/);
  if (method === "POST" && telnyxWebhookMatch?.[1]) {
    const tenantId = decodeURIComponent(telnyxWebhookMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const { body, rawBody } = await readJsonPayload(request);
    await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
      provider: "telnyx",
      method,
      path: url.pathname,
      rawBody,
      headers: headersFromIncomingMessage(request),
    });
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({
        statusCode: 200,
        body: await handleTelnyxWebhook(service, telnyxClient, tenantId, body),
      }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const inboundCallMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/inbound-call$/);
  if (method === "POST" && inboundCallMatch?.[1] && inboundCallMatch[2]) {
    const tenantId = decodeURIComponent(inboundCallMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const provider = decodeURIComponent(inboundCallMatch[2]);
    const { body, rawBody } = await readJsonPayload(request);
    await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
      provider,
      method,
      path: url.pathname,
      rawBody,
      headers: headersFromIncomingMessage(request),
    });
    const input = {
      tenantId,
      provider,
      providerCallId: requiredString(body.providerCallId, "providerCallId"),
    };
    addIfPresent(input, "fromPhone", optionalString(body.fromPhone, "fromPhone"));
    addIfPresent(input, "toPhone", optionalString(body.toPhone, "toPhone"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 201, body: await handleInboundTelephonyCall(service, input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const speechTurnMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/speech-turn$/,
  );
  if (method === "POST" && speechTurnMatch?.[1] && speechTurnMatch[2] && speechTurnMatch[3]) {
    const tenantId = decodeURIComponent(speechTurnMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const provider = decodeURIComponent(speechTurnMatch[2]);
    const { body, rawBody } = await readJsonPayload(request);
    await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
      provider,
      method,
      path: url.pathname,
      rawBody,
      headers: headersFromIncomingMessage(request),
    });
    const input = {
      tenantId,
      provider,
      providerCallId: decodeURIComponent(speechTurnMatch[3]),
      transcript: requiredString(body.transcript, "transcript"),
    };
    addIfPresent(input, "confidence", optionalNumber(body.confidence, "confidence"));
    addIfPresent(input, "isFinal", optionalBoolean(body.isFinal, "isFinal"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 200, body: await handleTelephonySpeechTurn(service, input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const audioTurnMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/audio-turn$/,
  );
  if (method === "POST" && audioTurnMatch?.[1] && audioTurnMatch[2] && audioTurnMatch[3]) {
    const tenantId = decodeURIComponent(audioTurnMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const provider = decodeURIComponent(audioTurnMatch[2]);
    const { body, rawBody } = await readJsonPayload(request);
    await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
      provider,
      method,
      path: url.pathname,
      rawBody,
      headers: headersFromIncomingMessage(request),
    });
    const input = {
      tenantId,
      provider,
      providerCallId: decodeURIComponent(audioTurnMatch[3]),
      audio: {
        contentType: requiredString(body.audioContentType, "audioContentType"),
        bytesBase64: requiredString(body.audioBytesBase64, "audioBytesBase64"),
      },
    };
    addIfPresent(input, "languageCode", optionalString(body.languageCode, "languageCode"));
    addIfPresent(input, "voice", optionalString(body.voice, "voice"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 200, body: await handleTelephonyAudioTurn(service, speechAdapters, input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const interruptMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/interrupt$/,
  );
  if (method === "POST" && interruptMatch?.[1] && interruptMatch[2] && interruptMatch[3]) {
    const tenantId = decodeURIComponent(interruptMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const provider = decodeURIComponent(interruptMatch[2]);
    const { body, rawBody } = await readJsonPayload(request);
    await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
      provider,
      method,
      path: url.pathname,
      rawBody,
      headers: headersFromIncomingMessage(request),
    });
    const input = {
      tenantId,
      provider,
      providerCallId: decodeURIComponent(interruptMatch[3]),
      reason: requiredString(body.reason, "reason"),
    };
    addIfPresent(input, "interruptedOutput", optionalString(body.interruptedOutput, "interruptedOutput"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 200, body: await handleTelephonyInterrupt(service, input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const callEndMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/end$/,
  );
  if (method === "POST" && callEndMatch?.[1] && callEndMatch[2] && callEndMatch[3]) {
    const tenantId = decodeURIComponent(callEndMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const provider = decodeURIComponent(callEndMatch[2]);
    const { body, rawBody } = await readJsonPayload(request);
    await verifyTelephonyWebhookSignature(webhookSignatureVerifier, {
      provider,
      method,
      path: url.pathname,
      rawBody,
      headers: headersFromIncomingMessage(request),
    });
    const input = {
      tenantId,
      provider,
      providerCallId: decodeURIComponent(callEndMatch[3]),
    };
    addIfPresent(input, "reason", optionalString(body.reason, "reason"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 200, body: await handleTelephonyCallEnd(service, input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const transcriptMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/transcript$/,
  );
  if (method === "POST" && transcriptMatch?.[1] && transcriptMatch[2]) {
    const tenantId = decodeURIComponent(transcriptMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const transcript = requiredString(body.transcript, "transcript");
    const input = {
      tenantId,
      sessionId: decodeURIComponent(transcriptMatch[2]),
      transcript,
    };
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await resolveIdempotentOperation({
      store: idempotencyStore,
      tenantId,
      key: idempotencyKeyFromIncomingMessage(request),
      method,
      path: url.pathname,
      body,
      execute: async () => ({ statusCode: 200, body: await service.handleTranscript(input) }),
    });
    sendIdempotentJson(response, output);
    return;
  }

  const eventsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch?.[1] && eventsMatch[2]) {
    const tenantId = decodeURIComponent(eventsMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const output = await service.listEvents({
      tenantId,
      sessionId: decodeURIComponent(eventsMatch[2]),
    });
    sendJson(response, 200, output);
    return;
  }

  const replayMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/replay$/);
  if (method === "GET" && replayMatch?.[1] && replayMatch[2]) {
    const tenantId = decodeURIComponent(replayMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const output = await service.replaySession({
      tenantId,
      sessionId: decodeURIComponent(replayMatch[2]),
    });
    sendJson(response, 200, output);
    return;
  }

  sendJson(response, 404, {
    error: "ROUTE_NOT_FOUND",
    message: "No route matched the request.",
  });
}

async function handleTelnyxWebhook(
  service: FirstCallService,
  telnyxClient: TelnyxCallControlClient,
  tenantId: string,
  body: Record<string, unknown>,
): Promise<object> {
  const translated = translateTelnyxWebhook({
    tenantId,
    payload: body,
  });
  if (translated.kind === "ignored") {
    return {
      provider: "telnyx",
      eventType: translated.eventType,
      ignored: true,
    };
  }
  if (translated.kind === "inbound_call") {
    const output = await handleInboundTelephonyCall(service, translated.input);
    const commands = createTelnyxCommandsInput(
      translated.input.providerCallId,
      output.voiceResponse,
      translated.input.correlationId,
      true,
    );
    return {
      provider: "telnyx",
      eventType: "call.initiated",
      result: output,
      telnyxCommands: commands,
      telnyxCommandResults: await telnyxClient.execute(commands),
    };
  }
  if (translated.kind === "speech_turn") {
    const output = await handleTelephonySpeechTurn(service, translated.input);
    const commands = createTelnyxCommandsInput(
      translated.input.providerCallId,
      output.voiceResponse,
      translated.input.correlationId,
      false,
    );
    return {
      provider: "telnyx",
      eventType: "call.ai_gather.ended",
      result: output,
      telnyxCommands: commands,
      telnyxCommandResults: await telnyxClient.execute(commands),
    };
  }
  const output = await handleTelephonyCallEnd(service, translated.input);
  const commands = createTelnyxCommandsInput(
    translated.input.providerCallId,
    output.voiceResponse,
    translated.input.correlationId,
    false,
  );
  return {
    provider: "telnyx",
    eventType: "call.hangup",
    result: output,
    telnyxCommands: commands,
    telnyxCommandResults: await telnyxClient.execute(commands),
  };
}

function createTelnyxCommandsInput(
  callControlId: string,
  voiceResponse: Parameters<typeof createTelnyxCommands>[0]["voiceResponse"],
  commandIdPrefix: string | undefined,
  answerFirst: boolean,
): ReturnType<typeof createTelnyxCommands> {
  const input = {
    callControlId,
    voiceResponse,
    answerFirst,
  };
  addIfPresent(input, "commandIdPrefix", commandIdPrefix);
  return createTelnyxCommands(input);
}

async function readJsonObject(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  return (await readJsonPayload(request)).body;
}

async function readJsonPayload(request: http.IncomingMessage): Promise<{ body: Record<string, unknown>; rawBody: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return {
    body: parseJsonObject(raw),
    rawBody: raw,
  };
}

async function readWebJsonObject(request: Request): Promise<Record<string, unknown>> {
  return (await readWebJsonPayload(request)).body;
}

async function readWebJsonPayload(request: Request): Promise<{ body: Record<string, unknown>; rawBody: string }> {
  const raw = (await request.text()).trim();
  return {
    body: parseJsonObject(raw),
    rawBody: raw,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError(400, "INVALID_JSON_BODY", "Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON_BODY", "Request body must contain valid JSON.");
  }
}

async function verifyTelephonyWebhookSignature(
  verifier: WebhookSignatureVerifier,
  input: {
    provider: string;
    method: string;
    path: string;
    rawBody: string;
    headers: Headers;
  },
): Promise<void> {
  await verifier.verify(input);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} is required.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a non-empty string when provided.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a finite number when provided.`);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a boolean when provided.`);
  }
  return value;
}

function optionalPositiveIntegerFromQuery(value: string | null, field: string): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a positive integer when provided.`);
  }
  return parsed;
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

async function requireTenantApiKey(
  verifier: TenantApiKeyVerifier,
  tenantId: string,
  apiKey: string | undefined,
): Promise<void> {
  if (!apiKey) {
    throw new ApiError(401, "API_KEY_REQUIRED", "A tenant API key is required.");
  }
  const valid = await verifier.verify(tenantId, apiKey);
  if (!valid) {
    throw new ApiError(403, "API_KEY_FORBIDDEN", "The tenant API key is not valid for this tenant.");
  }
}

function extractApiKeyFromIncomingMessage(request: http.IncomingMessage): string | undefined {
  const direct = headerValue(request.headers["x-api-key"]);
  if (direct?.trim()) return direct.trim();

  const authorization = headerValue(request.headers.authorization);
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || undefined;
}

function idempotencyKeyFromIncomingMessage(request: http.IncomingMessage): string | undefined {
  return headerValue(request.headers["idempotency-key"])?.trim() || undefined;
}

function idempotencyKeyFromHeaders(headers: Headers): string | undefined {
  return headers.get("idempotency-key")?.trim() || undefined;
}

function headersFromIncomingMessage(request: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    const normalized = headerValue(value);
    if (normalized !== undefined) headers.set(key, normalized);
  }
  return headers;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sendIdempotentJson(
  response: http.ServerResponse,
  output: { statusCode: number; body: object; idempotencyStatus?: "stored" | "replayed" },
): void {
  const headers: Record<string, string> = {};
  if (output.idempotencyStatus) headers["x-idempotency-status"] = output.idempotencyStatus;
  sendJson(response, output.statusCode, output.body, headers);
}

function sendJson(
  response: http.ServerResponse,
  statusCode: number,
  body: object,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function idempotentJsonResponse(output: {
  statusCode: number;
  body: object;
  idempotencyStatus?: "stored" | "replayed";
}): Response {
  const headers: Record<string, string> = {};
  if (output.idempotencyStatus) headers["x-idempotency-status"] = output.idempotencyStatus;
  return jsonResponse(output.statusCode, output.body, headers);
}

function jsonResponse(statusCode: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function firstCallServiceStatusCode(error: FirstCallServiceError): number {
  if (error.code === "TENANT_FEATURE_DISABLED") return 403;
  return 404;
}

function createApiRequestLog(input: {
  method: string;
  path: string;
  requestId: string;
  statusCode: number;
  startedAt: number;
  errorCode?: string | undefined;
}): Parameters<Logger["request"]>[0] {
  const entry: Parameters<Logger["request"]>[0] = {
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    durationMs: Math.max(0, Date.now() - input.startedAt),
  };
  addIfPresent(entry, "tenantId", tenantIdFromPath(input.path));
  addIfPresent(entry, "errorCode", input.errorCode);
  return entry;
}

function tenantIdFromPath(path: string): string | undefined {
  const match = path.match(/^\/v1\/tenants\/([^/]+)/);
  if (!match?.[1]) return undefined;
  return decodeURIComponent(match[1]);
}

function isPublicOperationalPath(method: string, path: string): boolean {
  return method === "GET" && (path === "/health" || path === "/version");
}

function requestIdFromIncomingMessage(request: http.IncomingMessage): string {
  return headerValue(request.headers["x-request-id"])?.trim() || crypto.randomUUID();
}

function requestIdFromHeaders(headers: Headers): string {
  return headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

function enforceRateLimit(input: {
  limiter: RateLimiter;
  method: string;
  path: string;
  requestKey: string;
}): RateLimitDecision {
  const decision = input.limiter.check({
    key: input.requestKey,
    method: input.method,
    path: input.path,
  });
  if (!decision.allowed) {
    throw new ApiError(429, "RATE_LIMIT_EXCEEDED", "Too many requests.", {
      "retry-after": String(decision.retryAfterSeconds ?? 1),
      "x-rate-limit-limit": String(decision.limit),
      "x-rate-limit-remaining": String(decision.remaining),
      "x-rate-limit-reset": decision.resetAt,
    });
  }
  return decision;
}

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
