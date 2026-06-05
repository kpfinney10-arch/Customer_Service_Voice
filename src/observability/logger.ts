import type { CallEvent } from "../events/call-event.js";

export type ApiRequestLog = {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  tenantId?: string;
  errorCode?: string;
};

export type Logger = {
  event: (event: CallEvent) => void;
  request: (entry: ApiRequestLog) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
};

export function createConsoleLogger(): Logger {
  return {
    event(event) {
      console.log(
        JSON.stringify({
          level: "info",
          type: "call_event",
          eventType: event.eventType,
          eventId: event.eventId,
          callId: event.callId,
          sessionId: event.sessionId,
          tenantId: event.tenantId,
          correlationId: event.correlationId,
          redactionStatus: event.redactionStatus,
        }),
      );
    },
    request(entry) {
      console.log(
        JSON.stringify({
          level: entry.statusCode >= 500 ? "error" : "info",
          type: "api_request",
          ...entry,
        }),
      );
    },
    error(message, context = {}) {
      console.error(JSON.stringify({ level: "error", message, ...context }));
    },
  };
}

export function createNoopLogger(): Logger {
  return {
    event() {},
    request() {},
    error() {},
  };
}
