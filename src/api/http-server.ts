import http from "node:http";
import type { AddressInfo } from "node:net";
import { InMemoryEventStore } from "../events/in-memory-event-store.js";
import { createFakeSpeechAdapters } from "../providers/speech/fake-speech-adapters.js";
import type { SpeechAdapters } from "../providers/speech/speech-adapters.js";
import {
  createTenantApiKeyVerifierFromEnv,
  extractApiKeyFromHeaders,
} from "../security/tenant-auth.js";
import type { TenantApiKeyVerifier } from "../security/tenant-auth.js";
import { InMemorySessionStore } from "../session/in-memory-session-store.js";
import {
  handleTelephonyAudioTurn,
  handleInboundTelephonyCall,
  handleTelephonyCallEnd,
  handleTelephonyInterrupt,
  handleTelephonySpeechTurn,
} from "../providers/telephony/inbound-call.js";
import { createFirstCallService, FirstCallServiceError } from "./first-call-service.js";
import type { FirstCallService } from "./first-call-service.js";

export type ApiServerOptions = {
  service?: FirstCallService;
  apiKeyVerifier?: TenantApiKeyVerifier;
  speechAdapters?: SpeechAdapters;
};

export function createApiServer(options: ApiServerOptions = {}): http.Server {
  const service =
    options.service ??
    createFirstCallService({
      store: new InMemorySessionStore(),
      eventStore: new InMemoryEventStore(),
    });
  const apiKeyVerifier = options.apiKeyVerifier ?? createTenantApiKeyVerifierFromEnv();
  const speechAdapters = options.speechAdapters ?? createFakeSpeechAdapters();

  return http.createServer(async (request, response) => {
    try {
      await routeRequest(service, apiKeyVerifier, speechAdapters, request, response);
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(response, error.statusCode, { error: error.code, message: error.message });
        return;
      }
      if (error instanceof FirstCallServiceError) {
        sendJson(response, 404, { error: error.code, message: error.message });
        return;
      }
      sendJson(response, 500, {
        error: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred.",
      });
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
): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(200, { ok: true });
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
      const output = await service.startSession(input);
      return jsonResponse(201, output);
    }

    const inboundCallMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/inbound-call$/);
    if (request.method === "POST" && inboundCallMatch?.[1] && inboundCallMatch[2]) {
      const tenantId = decodeURIComponent(inboundCallMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const input = {
        tenantId,
        provider: decodeURIComponent(inboundCallMatch[2]),
        providerCallId: requiredString(body.providerCallId, "providerCallId"),
      };
      addIfPresent(input, "fromPhone", optionalString(body.fromPhone, "fromPhone"));
      addIfPresent(input, "toPhone", optionalString(body.toPhone, "toPhone"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await handleInboundTelephonyCall(service, input);
      return jsonResponse(201, output);
    }

    const speechTurnMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/speech-turn$/,
    );
    if (request.method === "POST" && speechTurnMatch?.[1] && speechTurnMatch[2] && speechTurnMatch[3]) {
      const tenantId = decodeURIComponent(speechTurnMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const input = {
        tenantId,
        provider: decodeURIComponent(speechTurnMatch[2]),
        providerCallId: decodeURIComponent(speechTurnMatch[3]),
        transcript: requiredString(body.transcript, "transcript"),
      };
      addIfPresent(input, "confidence", optionalNumber(body.confidence, "confidence"));
      addIfPresent(input, "isFinal", optionalBoolean(body.isFinal, "isFinal"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await handleTelephonySpeechTurn(service, input);
      return jsonResponse(200, output);
    }

    const audioTurnMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/audio-turn$/,
    );
    if (request.method === "POST" && audioTurnMatch?.[1] && audioTurnMatch[2] && audioTurnMatch[3]) {
      const tenantId = decodeURIComponent(audioTurnMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const input = {
        tenantId,
        provider: decodeURIComponent(audioTurnMatch[2]),
        providerCallId: decodeURIComponent(audioTurnMatch[3]),
        audio: {
          contentType: requiredString(body.audioContentType, "audioContentType"),
          bytesBase64: requiredString(body.audioBytesBase64, "audioBytesBase64"),
        },
      };
      addIfPresent(input, "languageCode", optionalString(body.languageCode, "languageCode"));
      addIfPresent(input, "voice", optionalString(body.voice, "voice"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await handleTelephonyAudioTurn(service, speechAdapters, input);
      return jsonResponse(200, output);
    }

    const interruptMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/interrupt$/,
    );
    if (request.method === "POST" && interruptMatch?.[1] && interruptMatch[2] && interruptMatch[3]) {
      const tenantId = decodeURIComponent(interruptMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const input = {
        tenantId,
        provider: decodeURIComponent(interruptMatch[2]),
        providerCallId: decodeURIComponent(interruptMatch[3]),
        reason: requiredString(body.reason, "reason"),
      };
      addIfPresent(input, "interruptedOutput", optionalString(body.interruptedOutput, "interruptedOutput"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await handleTelephonyInterrupt(service, input);
      return jsonResponse(200, output);
    }

    const callEndMatch = url.pathname.match(
      /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/end$/,
    );
    if (request.method === "POST" && callEndMatch?.[1] && callEndMatch[2] && callEndMatch[3]) {
      const tenantId = decodeURIComponent(callEndMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const body = await readWebJsonObject(request);
      const input = {
        tenantId,
        provider: decodeURIComponent(callEndMatch[2]),
        providerCallId: decodeURIComponent(callEndMatch[3]),
      };
      addIfPresent(input, "reason", optionalString(body.reason, "reason"));
      addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
      const output = await handleTelephonyCallEnd(service, input);
      return jsonResponse(200, output);
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
      const output = await service.handleTranscript(input);
      return jsonResponse(200, output);
    }

    const eventsMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/events$/);
    if (request.method === "GET" && eventsMatch?.[1] && eventsMatch[2]) {
      const tenantId = decodeURIComponent(eventsMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const output = await service.listEvents({
        tenantId,
        sessionId: decodeURIComponent(eventsMatch[2]),
      });
      return jsonResponse(200, output);
    }

    const replayMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/first-call\/sessions\/([^/]+)\/replay$/);
    if (request.method === "GET" && replayMatch?.[1] && replayMatch[2]) {
      const tenantId = decodeURIComponent(replayMatch[1]);
      await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromHeaders(request.headers));
      const output = await service.replaySession({
        tenantId,
        sessionId: decodeURIComponent(replayMatch[2]),
      });
      return jsonResponse(200, output);
    }

    return jsonResponse(404, {
      error: "ROUTE_NOT_FOUND",
      message: "No route matched the request.",
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return jsonResponse(error.statusCode, { error: error.code, message: error.message });
    }
    if (error instanceof FirstCallServiceError) {
      return jsonResponse(404, { error: error.code, message: error.message });
    }
    return jsonResponse(500, {
      error: "INTERNAL_SERVER_ERROR",
      message: "An unexpected error occurred.",
    });
  }
}

async function routeRequest(
  service: FirstCallService,
  apiKeyVerifier: TenantApiKeyVerifier,
  speechAdapters: SpeechAdapters,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
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
    const output = await service.startSession(input);
    sendJson(response, 201, output);
    return;
  }

  const inboundCallMatch = url.pathname.match(/^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/inbound-call$/);
  if (method === "POST" && inboundCallMatch?.[1] && inboundCallMatch[2]) {
    const tenantId = decodeURIComponent(inboundCallMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const input = {
      tenantId,
      provider: decodeURIComponent(inboundCallMatch[2]),
      providerCallId: requiredString(body.providerCallId, "providerCallId"),
    };
    addIfPresent(input, "fromPhone", optionalString(body.fromPhone, "fromPhone"));
    addIfPresent(input, "toPhone", optionalString(body.toPhone, "toPhone"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await handleInboundTelephonyCall(service, input);
    sendJson(response, 201, output);
    return;
  }

  const speechTurnMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/speech-turn$/,
  );
  if (method === "POST" && speechTurnMatch?.[1] && speechTurnMatch[2] && speechTurnMatch[3]) {
    const tenantId = decodeURIComponent(speechTurnMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const input = {
      tenantId,
      provider: decodeURIComponent(speechTurnMatch[2]),
      providerCallId: decodeURIComponent(speechTurnMatch[3]),
      transcript: requiredString(body.transcript, "transcript"),
    };
    addIfPresent(input, "confidence", optionalNumber(body.confidence, "confidence"));
    addIfPresent(input, "isFinal", optionalBoolean(body.isFinal, "isFinal"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await handleTelephonySpeechTurn(service, input);
    sendJson(response, 200, output);
    return;
  }

  const audioTurnMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/audio-turn$/,
  );
  if (method === "POST" && audioTurnMatch?.[1] && audioTurnMatch[2] && audioTurnMatch[3]) {
    const tenantId = decodeURIComponent(audioTurnMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const input = {
      tenantId,
      provider: decodeURIComponent(audioTurnMatch[2]),
      providerCallId: decodeURIComponent(audioTurnMatch[3]),
      audio: {
        contentType: requiredString(body.audioContentType, "audioContentType"),
        bytesBase64: requiredString(body.audioBytesBase64, "audioBytesBase64"),
      },
    };
    addIfPresent(input, "languageCode", optionalString(body.languageCode, "languageCode"));
    addIfPresent(input, "voice", optionalString(body.voice, "voice"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await handleTelephonyAudioTurn(service, speechAdapters, input);
    sendJson(response, 200, output);
    return;
  }

  const interruptMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/interrupt$/,
  );
  if (method === "POST" && interruptMatch?.[1] && interruptMatch[2] && interruptMatch[3]) {
    const tenantId = decodeURIComponent(interruptMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const input = {
      tenantId,
      provider: decodeURIComponent(interruptMatch[2]),
      providerCallId: decodeURIComponent(interruptMatch[3]),
      reason: requiredString(body.reason, "reason"),
    };
    addIfPresent(input, "interruptedOutput", optionalString(body.interruptedOutput, "interruptedOutput"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await handleTelephonyInterrupt(service, input);
    sendJson(response, 200, output);
    return;
  }

  const callEndMatch = url.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/([^/]+)\/calls\/([^/]+)\/end$/,
  );
  if (method === "POST" && callEndMatch?.[1] && callEndMatch[2] && callEndMatch[3]) {
    const tenantId = decodeURIComponent(callEndMatch[1]);
    await requireTenantApiKey(apiKeyVerifier, tenantId, extractApiKeyFromIncomingMessage(request));
    const body = await readJsonObject(request);
    const input = {
      tenantId,
      provider: decodeURIComponent(callEndMatch[2]),
      providerCallId: decodeURIComponent(callEndMatch[3]),
    };
    addIfPresent(input, "reason", optionalString(body.reason, "reason"));
    addIfPresent(input, "correlationId", optionalString(body.correlationId, "correlationId"));
    const output = await handleTelephonyCallEnd(service, input);
    sendJson(response, 200, output);
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
    const output = await service.handleTranscript(input);
    sendJson(response, 200, output);
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

async function readJsonObject(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
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

async function readWebJsonObject(request: Request): Promise<Record<string, unknown>> {
  const raw = (await request.text()).trim();
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

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function sendJson(response: http.ServerResponse, statusCode: number, body: object): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function jsonResponse(statusCode: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
