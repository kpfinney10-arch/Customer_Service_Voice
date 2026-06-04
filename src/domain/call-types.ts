export const CALL_STATES = [
  "GREETING",
  "AUTH",
  "IDENTIFY_INTENT",
  "VERIFY_ACCOUNT",
  "RESOLVE_REQUEST",
  "UPSELL",
  "WRAPUP",
  "END_CALL",
  "ESCALATE",
] as const;

export type CallState = (typeof CALL_STATES)[number];

export const CALL_EVENT_TYPES = [
  "CALL_STARTED",
  "AUDIO_STREAM_CONNECTED",
  "TRANSCRIPT_RECEIVED",
  "INTENT_DETECTED",
  "STATE_TRANSITIONED",
  "RULE_EVALUATED",
  "TOOL_REQUESTED",
  "TOOL_EXECUTED",
  "TOOL_FAILED",
  "ESCALATION_TRIGGERED",
  "TTS_STARTED",
  "CALL_INTERRUPTED",
  "CALL_ENDED",
] as const;

export type CallEventType = (typeof CALL_EVENT_TYPES)[number];

export type Sentiment = "calm" | "confused" | "frustrated" | "angry" | "unknown";

export type RedactionStatus = "not_required" | "redacted" | "contains_sensitive_data";

export type StructuredFacts = Record<string, string | number | boolean | null>;

export type CallIntent =
  | "first_call_intake"
  | "death_report"
  | "family_question"
  | "service_schedule_question"
  | "pricing_or_billing"
  | "dispatch_status"
  | "after_hours_support"
  | "unsupported"
  | "unknown";

export type EscalationReason =
  | "urgent_death_report"
  | "medical_or_legal_question"
  | "caller_distress"
  | "unsupported_intent"
  | "authentication_failed"
  | "tool_failure"
  | "retry_budget_exhausted"
  | "policy_required";

