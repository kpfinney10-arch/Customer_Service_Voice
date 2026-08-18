import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { FirstCallService } from "../../api/first-call-service.js";
import type { Logger } from "../../observability/logger.js";
import type { WebhookSignatureVerifier } from "../../security/webhook-signature.js";
import {
  handleTelephonyCallEnd,
  handleTelephonyInterrupt,
  handleTelephonySpeechTurn,
} from "./inbound-call.js";
import {
  twilioConversationRelaySocketPath,
  twilioConversationRelaySocketUrl,
} from "./twilio-conversation-relay-config.js";
import type { TwilioConversationRelayConfig } from "./twilio-conversation-relay-config.js";

type RelaySetupMessage = {
  type: "setup";
  callSid: string;
  customParameters: Record<string, string>;
};

type RelayPromptMessage = {
  type: "prompt";
  voicePrompt: string;
  last: boolean;
};

type RelayInterruptMessage = {
  type: "interrupt";
};

type RelayErrorMessage = {
  type: "error";
};

type RelayIgnoredMessage = {
  type: "dtmf";
};

type RelayIncomingMessage =
  | RelaySetupMessage
  | RelayPromptMessage
  | RelayInterruptMessage
  | RelayErrorMessage
  | RelayIgnoredMessage;

export type RelayEndReason = "handoff" | "pricing_blocked" | "completed" | "technical_failure";

export type TwilioConversationRelayServerOptions = {
  server: http.Server;
  service: FirstCallService;
  config: TwilioConversationRelayConfig;
  webhookSignatureVerifier: WebhookSignatureVerifier;
  logger: Pick<Logger, "error">;
  maxConnections?: number;
};

export function attachTwilioConversationRelayServer(
  options: TwilioConversationRelayServerOptions,
): void {
  if (options.config.mode !== "conversation_relay") return;

  const socketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const maxConnections = options.maxConnections ?? 5;

  options.server.on("upgrade", (request, socket, head) => {
    void acceptUpgrade({ ...options, socketServer, maxConnections, request, socket, head });
  });
  options.server.on("close", () => {
    for (const client of socketServer.clients) client.terminate();
    socketServer.close();
  });
}

async function acceptUpgrade(
  input: TwilioConversationRelayServerOptions & {
    socketServer: WebSocketServer;
    maxConnections: number;
    request: http.IncomingMessage;
    socket: import("node:stream").Duplex;
    head: Buffer;
  },
): Promise<void> {
  const requestUrl = new URL(input.request.url ?? "/", "http://localhost");
  const match = requestUrl.pathname.match(
    /^\/v1\/tenants\/([^/]+)\/telephony\/twilio\/conversation-relay$/,
  );
  if (!match?.[1]) {
    rejectUpgrade(input.socket, 404, "Not Found");
    return;
  }
  if (input.socketServer.clients.size >= input.maxConnections) {
    rejectUpgrade(input.socket, 503, "Service Unavailable");
    return;
  }

  const tenantId = decodeURIComponent(match[1]);
  const expectedPath = twilioConversationRelaySocketPath(tenantId);
  if (requestUrl.pathname !== expectedPath || requestUrl.search) {
    rejectUpgrade(input.socket, 400, "Bad Request");
    return;
  }

  try {
    await input.webhookSignatureVerifier.verify({
      provider: "twilio",
      method: "GET",
      path: expectedPath,
      url: twilioConversationRelaySocketUrl(input.config, tenantId),
      rawBody: "",
      headers: headersFromIncomingMessage(input.request),
    });
  } catch {
    input.logger.error("ConversationRelay WebSocket signature validation failed.", {
      type: "conversation_relay_upgrade_rejected",
      reason: "invalid_signature",
    });
    rejectUpgrade(input.socket, 401, "Unauthorized");
    return;
  }

  input.socketServer.handleUpgrade(input.request, input.socket, input.head, (webSocket) => {
    input.socketServer.emit("connection", webSocket, input.request);
    handleConnection({
      webSocket,
      tenantId,
      service: input.service,
      logger: input.logger,
    });
  });
}

function handleConnection(input: {
  webSocket: WebSocket;
  tenantId: string;
  service: FirstCallService;
  logger: Pick<Logger, "error">;
}): void {
  let callSid: string | undefined;
  let ended = false;
  let pendingMessages = 0;
  let work = Promise.resolve();

  input.webSocket.on("message", (data, isBinary) => {
    if (ended) return;
    if (isBinary || pendingMessages >= 4) {
      input.webSocket.close(isBinary ? 1003 : 1013, isBinary ? "Text messages required" : "Try again later");
      return;
    }
    pendingMessages += 1;
    work = work
      .then(async () => {
        const message = parseRelayMessage(data.toString());
        if (message.type === "setup") {
          if (callSid || message.customParameters.tenantId !== input.tenantId) {
            throw new RelayProtocolError("Invalid setup message.");
          }
          callSid = message.callSid;
          return;
        }
        if (!callSid) throw new RelayProtocolError("Setup message is required first.");

        if (message.type === "prompt") {
          if (!message.last) return;
          if (!message.voicePrompt.trim()) {
            await input.service.recordPromptRepeat({
              tenantId: input.tenantId,
              sessionId: callSid,
              reason: "empty_speech",
              correlationId: callSid,
            });
            sendText(input.webSocket, "I am sorry, I did not catch that. Please say that again.");
            return;
          }
          const output = await handleTelephonySpeechTurn(input.service, {
            tenantId: input.tenantId,
            provider: "twilio_conversation_relay",
            providerCallId: callSid,
            transcript: message.voicePrompt,
            isFinal: true,
            correlationId: callSid,
          });
          if (output.nextExpectedInput === "human_handoff") {
            ended = true;
            sendEnd(input.webSocket, "handoff");
            return;
          }
          if (output.nextExpectedInput === "none") {
            ended = true;
            sendEnd(
              input.webSocket,
              output.decision.step === "pricing_blocked" ? "pricing_blocked" : "completed",
            );
            return;
          }
          sendText(input.webSocket, output.responseText);
          return;
        }

        if (message.type === "interrupt") {
          await handleTelephonyInterrupt(input.service, {
            tenantId: input.tenantId,
            provider: "twilio_conversation_relay",
            providerCallId: callSid,
            reason: "caller_barge_in",
            correlationId: callSid,
          });
          return;
        }

        if (message.type === "error") {
          ended = true;
          sendEnd(input.webSocket, "technical_failure");
        }
      })
      .catch((error: unknown) => {
        ended = true;
        input.logger.error("ConversationRelay message handling failed.", {
          type: "conversation_relay_message_failed",
          reason: error instanceof RelayProtocolError ? "invalid_protocol" : "processing_failure",
        });
        if (input.webSocket.readyState === WebSocket.OPEN) {
          sendEnd(input.webSocket, "technical_failure");
        }
      })
      .finally(() => {
        pendingMessages -= 1;
      });
  });

  input.webSocket.on("close", () => {
    if (!callSid || ended) return;
    ended = true;
    void handleTelephonyCallEnd(input.service, {
      tenantId: input.tenantId,
      provider: "twilio_conversation_relay",
      providerCallId: callSid,
      reason: "conversation_relay_closed",
      correlationId: callSid,
    }).catch(() => {
      input.logger.error("ConversationRelay disconnect could not be recorded.", {
        type: "conversation_relay_disconnect_record_failed",
      });
    });
  });

  input.webSocket.on("error", () => {
    input.logger.error("ConversationRelay WebSocket transport error.", {
      type: "conversation_relay_transport_error",
    });
  });
}

function parseRelayMessage(raw: string): RelayIncomingMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RelayProtocolError("Message must be valid JSON.");
  }
  if (!isObject(value) || typeof value.type !== "string") {
    throw new RelayProtocolError("Message type is required.");
  }
  if (value.type === "setup") {
    if (
      typeof value.callSid !== "string" ||
      !value.callSid.trim() ||
      !isStringRecord(value.customParameters)
    ) {
      throw new RelayProtocolError("Setup message is invalid.");
    }
    return { type: "setup", callSid: value.callSid, customParameters: value.customParameters };
  }
  if (value.type === "prompt") {
    if (typeof value.voicePrompt !== "string" || typeof value.last !== "boolean") {
      throw new RelayProtocolError("Prompt message is invalid.");
    }
    return { type: "prompt", voicePrompt: value.voicePrompt, last: value.last };
  }
  if (value.type === "interrupt" || value.type === "error" || value.type === "dtmf") {
    return { type: value.type };
  }
  throw new RelayProtocolError("Message type is not supported.");
}

function sendText(webSocket: WebSocket, token: string): void {
  webSocket.send(JSON.stringify({
    type: "text",
    token,
    last: true,
    interruptible: true,
    preemptible: true,
  }));
}

function sendEnd(webSocket: WebSocket, reasonCode: RelayEndReason): void {
  webSocket.send(JSON.stringify({
    type: "end",
    handoffData: JSON.stringify({ reasonCode }),
  }));
}

function headersFromIncomingMessage(request: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

function rejectUpgrade(socket: import("node:stream").Duplex, statusCode: number, statusText: string): void {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

class RelayProtocolError extends Error {}
