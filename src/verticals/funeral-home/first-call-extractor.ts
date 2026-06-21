import type { CallIntent, Sentiment } from "../../domain/call-types.js";
import { classifyFuneralHomeIntent } from "./intents.js";
import type { FirstCallFacts, FirstCallUrgency, PlaceOfDeathType } from "./first-call-facts.js";

export type FirstCallExtraction = {
  intent: CallIntent;
  facts: Partial<FirstCallFacts>;
  sentiment: Sentiment;
  confidence: number;
  warnings: string[];
};

export type FirstCallExtractor = {
  extract: (
    transcript: string,
    context?: FirstCallExtractionContext,
  ) => Promise<FirstCallExtraction> | FirstCallExtraction;
};

export type FirstCallExtractionContext = {
  tenantId?: string;
  currentFacts?: Partial<FirstCallFacts>;
  activeStep?: string;
  missingTargetFacts?: string[];
};

const phonePattern = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;

const placeTerms: Array<[PlaceOfDeathType, RegExp]> = [
  ["hospital", /\b(hospital|medical center|er|emergency room)\b/i],
  ["hospice", /\b(hospice)\b/i],
  ["nursing_home", /\b(nursing home|care center|long[-\s]?term care|skilled nursing)\b/i],
  ["medical_examiner", /\b(medical examiner|coroner|county morgue)\b/i],
  ["residence", /\b(home|house|apartment|residence|address)\b/i],
];

export const deterministicFirstCallExtractor: FirstCallExtractor = {
  extract(transcript: string): FirstCallExtraction {
    return extractFirstCallFactsDeterministic(transcript);
  },
};

export function extractFirstCallFactsDeterministic(transcript: string): FirstCallExtraction {
  const text = transcript.trim();
  const lower = text.toLowerCase();
  const facts: Partial<FirstCallFacts> = {};
  const warnings: string[] = [];

  const intent = classifyFuneralHomeIntent(text);
  facts.death_reported = /\b(passed away|died|death|deceased|pronounced|body|removal|ready for release|release to)\b/i.test(text);

  const callerName = matchFirst(text, [
    /\b[Mm]y name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\b)/,
    /\b[Tt]his is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+from\b/,
    /\b[Tt]his is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\b)/,
    /\b[Ii] am\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\b)/,
  ]);
  if (callerName) facts.caller_name = callerName;

  const phone = text.match(phonePattern)?.[0];
  if (phone) {
    facts.caller_phone = phone;
    facts.preferred_callback_number = phone;
    facts.pickup_contact_phone = phone;
  }

  const relationship = matchRelationship(lower);
  if (relationship) facts.caller_relationship_to_decedent = normalizeRelationship(relationship);

  const decedentName = matchFirst(text, [
    /\b(?:[Ff]ather|[Mm]other|[Dd]ad|[Mm]om|[Hh]usband|[Ww]ife|[Bb]rother|[Ss]ister|[Ss]on|[Dd]aughter),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}),?\s+(?:just\s+)?(?:passed away|died)\b/,
    /\b(?:[Hh]is|[Hh]er|[Tt]heir)\s+name\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})(?=[,.]|\b)/,
    /\b(?:[Tt]he\s+)?(?:[Dd]ecedent|[Pp]erson who passed|[Pp]erson that passed)\s+(?:is|was|named)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/,
    /\b(?:decedent|patient|resident)\s+(?:is|was|named)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/,
    /\b(?:[Pp]atient|[Rr]esident)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:was\s+)?(?:pronounced|released|ready)\b/,
    /\b(?:decedent|patient|resident)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:was\s+)?(?:pronounced|released|ready)\b/,
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/,
  ]);
  if (decedentName) facts.decedent_name = decedentName;

  const facilityName = matchFirst(text, [
    /\bat\s+([A-Z][A-Za-z\s]+(?:Hospital|Hospice|Care Center|Medical Center|Nursing Home))\b/,
    /\bfrom\s+([A-Z][A-Za-z\s]+(?:Hospital|Hospice|Care Center|Medical Center|Nursing Home))\b/,
  ]);
  if (facilityName) facts.facility_name = facilityName.trim();

  const address = matchFirst(text, [
    /\bat\s+(\d{1,3}:\d{2}\s+[A-Z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct)\b(?:,\s*[A-Z][A-Za-z\s]+)*)/,
    /\bat\s+(\d{2,6}\s+[A-Z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct)\b(?:,\s*[A-Z][A-Za-z\s]+)*)/,
    /\b[Aa]ddress is\s+(\d{2,6}\s+[A-Z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct)\b(?:,\s*[A-Z][A-Za-z\s]+)*)/,
  ]);
  if (address) facts.pickup_address = normalizeSpokenStreetNumber(address.trim());

  const placeOfDeath = placeTerms.find(([, pattern]) => pattern.test(text))?.[0] ?? (address ? "residence" : undefined);
  facts.place_of_death_type = placeOfDeath ?? "unknown";

  if (/\b(i am|we are|family is|nurse is)\s+(here|with)\b/i.test(text)) {
    facts.currently_with_decedent = true;
  }

  const requestedFuneralHome = matchFirst(text, [
    /\brelease to\s+([A-Z][A-Za-z\s]+?Funeral Home)\b/,
    /\b(?:calling|called|need|want)\s+([A-Z][A-Za-z\s]+Funeral Home)\b/,
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4}\s+Funeral Home)\b/,
  ]);
  if (requestedFuneralHome) facts.requested_funeral_home = requestedFuneralHome.trim();

  facts.urgency = inferUrgency(lower);
  const callerEmotion = inferCallerEmotion(lower);
  if (callerEmotion) facts.caller_emotional_state = callerEmotion;
  if (facts.caller_name) facts.pickup_contact_name = facts.caller_name;

  if (!facts.caller_name) warnings.push("caller_name_not_found");
  if (!facts.caller_phone) warnings.push("caller_phone_not_found");
  if (!facts.decedent_name) warnings.push("decedent_name_not_found");
  if (!facts.pickup_address && !facts.facility_name) warnings.push("pickup_context_not_found");

  return {
    intent,
    facts,
    sentiment: inferSentiment(lower),
    confidence: warnings.length === 0 ? 0.85 : Math.max(0.45, 0.8 - warnings.length * 0.1),
    warnings,
  };
}

function matchFirst(input: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const value = input.match(pattern)?.[1]?.trim();
    if (value) return value.replace(/[,.]$/, "");
  }
  return undefined;
}

function normalizeSpokenStreetNumber(value: string): string {
  return value
    .replace(/^(\d{1,3}):(\d{2})\b/, "$1$2")
    .replace(/^(\d{1,3})\s+(\d)\b/, "$1$2");
}

function matchRelationship(input: string): string | undefined {
  const possessive = input.match(
    /\b(?:my|our)\s+(father|mother|dad|mom|husband|wife|brother|sister|son|daughter|aunt|uncle|grandfather|grandmother)\b/,
  )?.[1];
  if (possessive) return possessive;

  return input.match(/\bi'?m (?:his|her|their)\s+(son|daughter|spouse|husband|wife|brother|sister)\b/)?.[1];
}

function normalizeRelationship(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "dad") return "father";
  if (lower === "mom") return "mother";
  return lower;
}

function inferUrgency(text: string): FirstCallUrgency {
  if (/\b(911|emergency|unsafe|police|fire|medical examiner|coroner)\b/.test(text)) return "emergency";
  if (/\b(just passed|passed away|died|death|body|removal|pronounced|ready for release|release to)\b/.test(text)) return "urgent";
  return "unknown";
}

function inferSentiment(text: string): Sentiment {
  if (/\b(panicking|hysterical|screaming|can't breathe|angry|furious)\b/.test(text)) return "angry";
  if (/\b(upset|crying|distressed|scared|overwhelmed)\b/.test(text)) return "frustrated";
  if (/\b(confused|not sure|don't know)\b/.test(text)) return "confused";
  return "unknown";
}

function inferCallerEmotion(text: string): string | undefined {
  const sentiment = inferSentiment(text);
  return sentiment === "unknown" ? undefined : sentiment;
}
