import type { CallEventType, RedactionStatus } from "../domain/call-types.js";

export type CallEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> = {
  eventId: string;
  eventType: CallEventType;
  schemaVersion: number;
  occurredAt: string;
  callId: string;
  sessionId: string;
  tenantId: string;
  correlationId: string;
  redactionStatus: RedactionStatus;
  payload: TPayload;
};

export function createCallEvent<TPayload extends Record<string, unknown>>(params: {
  eventId: string;
  eventType: CallEventType;
  callId: string;
  sessionId: string;
  tenantId: string;
  correlationId: string;
  payload: TPayload;
  redactionStatus?: RedactionStatus;
  occurredAt?: string;
  schemaVersion?: number;
}): CallEvent<TPayload> {
  return {
    eventId: params.eventId,
    eventType: params.eventType,
    schemaVersion: params.schemaVersion ?? 1,
    occurredAt: params.occurredAt ?? new Date().toISOString(),
    callId: params.callId,
    sessionId: params.sessionId,
    tenantId: params.tenantId,
    correlationId: params.correlationId,
    redactionStatus: params.redactionStatus ?? "not_required",
    payload: params.payload,
  };
}

