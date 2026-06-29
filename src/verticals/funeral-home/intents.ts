import type { CallIntent } from "../../domain/call-types.js";

const firstCallTerms = [
  "death",
  "passed away",
  "died",
  "body",
  "decedent",
  "removal",
  "pickup",
  "pronounced",
  "ready for release",
  "release to",
];
const familyQuestionTerms = ["service", "visitation", "arrangements", "obituary", "flowers", "family"];
const billingTerms = ["price", "cost", "bill", "invoice", "payment", "insurance"];
const dispatchTerms = ["driver", "pickup", "arrival", "transport", "where are they"];

export function classifyFuneralHomeIntent(transcript: string): CallIntent {
  const text = transcript.toLowerCase();
  const hasFirstCallTerm = firstCallTerms.some((term) => text.includes(term));
  const hasBillingTerm = billingTerms.some((term) => text.includes(term));
  if (hasFirstCallTerm && !hasNegatedDeathReport(text)) return "first_call_intake";
  if (hasBillingTerm) return "pricing_or_billing";
  if (dispatchTerms.some((term) => text.includes(term))) return "dispatch_status";
  if (familyQuestionTerms.some((term) => text.includes(term))) return "family_question";
  return "unknown";
}

export function hasNegatedDeathReport(transcript: string): boolean {
  const text = transcript
    .toLowerCase()
    .replace(/\bno\s+1\b/g, "no one")
    .replace(/\s+/g, " ");
  return /\b(?:no one|nobody|no-one)\s+(?:has\s+)?(?:passed away|died)\b/.test(text) ||
    /\b(?:no|not)\s+(?:death|deaths)\b/.test(text) ||
    /\b(?:hasn'?t|has not|didn'?t|did not)\s+(?:passed away|pass away|died|die)\b/.test(text);
}
