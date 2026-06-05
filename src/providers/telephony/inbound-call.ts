import type { CallEvent } from "../../events/call-event.js";
import type { CallSession } from "../../session/call-session.js";
import { firstCallPromptForStep } from "../../verticals/funeral-home/first-call-flow.js";
import type { FirstCallService } from "../../api/first-call-service.js";

export type InboundTelephonyCallInput = {
  tenantId: string;
  provider: string;
  providerCallId: string;
  fromPhone?: string;
  toPhone?: string;
  correlationId?: string;
};

export type InboundTelephonyCallOutput = {
  session: CallSession;
  events: CallEvent[];
  responseText: string;
  provider: string;
  providerCallId: string;
  route: "first_call_intake";
  nextExpectedInput: "caller_speech";
};

export async function handleInboundTelephonyCall(
  service: FirstCallService,
  input: InboundTelephonyCallInput,
): Promise<InboundTelephonyCallOutput> {
  const sessionInput = {
    tenantId: input.tenantId,
    callId: input.providerCallId,
    sessionId: input.providerCallId,
  };
  addIfPresent(sessionInput, "callerPhone", input.fromPhone);
  addIfPresent(sessionInput, "correlationId", input.correlationId);
  const started = await service.startSession(sessionInput);

  return {
    session: started.session,
    events: started.events,
    responseText: firstCallPromptForStep("acknowledge"),
    provider: input.provider,
    providerCallId: input.providerCallId,
    route: "first_call_intake",
    nextExpectedInput: "caller_speech",
  };
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
