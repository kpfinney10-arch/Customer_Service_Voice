import type { CallEvent } from "../events/call-event.js";

export type Logger = {
  event: (event: CallEvent) => void;
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
    error(message, context = {}) {
      console.error(JSON.stringify({ level: "error", message, ...context }));
    },
  };
}

