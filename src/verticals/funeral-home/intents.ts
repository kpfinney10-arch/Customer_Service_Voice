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
  if (firstCallTerms.some((term) => text.includes(term))) return "first_call_intake";
  if (billingTerms.some((term) => text.includes(term))) return "pricing_or_billing";
  if (dispatchTerms.some((term) => text.includes(term))) return "dispatch_status";
  if (familyQuestionTerms.some((term) => text.includes(term))) return "family_question";
  return "unknown";
}
