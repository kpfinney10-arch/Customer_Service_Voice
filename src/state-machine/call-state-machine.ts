import type { CallState } from "../domain/call-types.js";

const allowedTransitions: Record<CallState, readonly CallState[]> = {
  GREETING: ["IDENTIFY_INTENT", "AUTH", "ESCALATE", "END_CALL"],
  AUTH: ["IDENTIFY_INTENT", "VERIFY_ACCOUNT", "ESCALATE", "END_CALL"],
  IDENTIFY_INTENT: ["VERIFY_ACCOUNT", "RESOLVE_REQUEST", "ESCALATE", "END_CALL"],
  VERIFY_ACCOUNT: ["RESOLVE_REQUEST", "ESCALATE", "END_CALL"],
  RESOLVE_REQUEST: ["WRAPUP", "ESCALATE", "END_CALL"],
  UPSELL: ["WRAPUP", "END_CALL"],
  WRAPUP: ["END_CALL", "ESCALATE"],
  END_CALL: [],
  ESCALATE: ["END_CALL"],
};

export function getAllowedTransitions(state: CallState): readonly CallState[] {
  return allowedTransitions[state];
}

export function canTransition(from: CallState, to: CallState): boolean {
  return allowedTransitions[from].includes(to);
}

export function assertTransition(from: CallState, to: CallState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid call state transition from ${from} to ${to}`);
  }
}

