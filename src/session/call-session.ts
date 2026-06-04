import type { CallIntent, CallState, Sentiment, StructuredFacts } from "../domain/call-types.js";

export type CallSession = {
  callId: string;
  sessionId: string;
  tenantId: string;
  callerPhone?: string;
  customerId?: string;
  currentState: CallState;
  intent: CallIntent | null;
  authenticated: boolean;
  sentiment: Sentiment;
  retryCount: number;
  escalationScore: number;
  facts: StructuredFacts;
  createdAt: string;
  updatedAt: string;
};

export function createCallSession(params: {
  callId: string;
  sessionId: string;
  tenantId: string;
  callerPhone?: string;
  now?: string;
}): CallSession {
  const now = params.now ?? new Date().toISOString();
  const session: CallSession = {
    callId: params.callId,
    sessionId: params.sessionId,
    tenantId: params.tenantId,
    currentState: "GREETING",
    intent: null,
    authenticated: false,
    sentiment: "unknown",
    retryCount: 0,
    escalationScore: 0,
    facts: {},
    createdAt: now,
    updatedAt: now,
  };
  if (params.callerPhone) session.callerPhone = params.callerPhone;
  return session;
}

export function updateSession(
  session: CallSession,
  patch: Partial<Omit<CallSession, "callId" | "sessionId" | "tenantId" | "createdAt">>,
  now = new Date().toISOString(),
): CallSession {
  return {
    ...session,
    ...patch,
    updatedAt: now,
  };
}
