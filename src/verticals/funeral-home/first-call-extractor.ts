import type { CallIntent, Sentiment } from "../../domain/call-types.js";
import { classifyFuneralHomeIntent, hasNegatedDeathReport } from "./intents.js";
import type { FirstCallFacts, FirstCallUrgency, PlaceOfDeathType } from "./first-call-facts.js";

export type FirstCallExtraction = {
  intent: CallIntent;
  facts: Partial<FirstCallFacts>;
  sentiment: Sentiment;
  confidence: number;
  factConfidence?: FirstCallFactConfidence;
  warnings: string[];
};

export type FirstCallFactConfidence = Partial<Record<keyof FirstCallFacts, number>>;

export type FirstCallExtractor = {
  extract: (
    transcript: string,
    context?: FirstCallExtractionContext,
  ) => Promise<FirstCallExtraction> | FirstCallExtraction;
};

export type FirstCallExtractionContext = {
  tenantId?: string;
  currentFacts?: Partial<FirstCallFacts>;
  currentFactConfidence?: FirstCallFactConfidence;
  localFacts?: Partial<FirstCallFacts>;
  localFactConfidence?: FirstCallFactConfidence;
  activeStep?: string;
  missingTargetFacts?: string[];
};

const phonePattern = /\b(?:\+?1[-.\s]*)?(?:\(?\d{3}\)?[-.\s]*)\d{3}[-.\s]*\d{4}\b/;

const placeTerms: Array<[PlaceOfDeathType, RegExp]> = [
  ["medical_examiner", /\b(medical examiner|coroner|county morgue)\b/i],
  ["hospital", /\b(hospital|medical center|er|emergency room)\b/i],
  ["hospice", /\b(hospice)\b/i],
  ["nursing_home", /\b(nursing home|care center|long[-\s]?term care|skilled nursing)\b/i],
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
  const factConfidence: FirstCallFactConfidence = {};
  const warnings: string[] = [];

  const intent = classifyFuneralHomeIntent(text);
  const negatedDeathReport = hasNegatedDeathReport(text);
  const deathReportMentioned = /\b(passed away|died|death|deceased|pronounced|body|removal|ready for release|release to|medical examiner|coroner|morgue)\b/i.test(
    text,
  );
  if (negatedDeathReport) {
    facts.death_reported = false;
    factConfidence.death_reported = 0.9;
  } else if (deathReportMentioned) {
    facts.death_reported = true;
    factConfidence.death_reported = 0.9;
  } else {
    factConfidence.death_reported = 0.35;
  }
  if (intent === "pricing_or_billing") {
    facts.special_handling_notes = "Pricing inquiry; caller requested office-hours follow-up.";
    factConfidence.special_handling_notes = 0.78;
  } else if (isRoutineInquiryIntent(intent)) {
    facts.special_handling_notes = "Routine family inquiry; caller requested office-hours follow-up.";
    factConfidence.special_handling_notes = 0.78;
  }
  if (/\b(?:drop off|bring)\s+(?:clothing|clothes)\b/i.test(text)) {
    facts.dropoff_preference = "Caller asked about dropping off clothing.";
    factConfidence.dropoff_preference = 0.78;
  }

  const facilityContactRole = matchFacilityContactRole(text);
  if (facilityContactRole) {
    facts.facility_contact_role = facilityContactRole;
    factConfidence.facility_contact_role = 0.82;
  }

  const callerName = matchFirst(text, [
    /\bthis is\s+(?:Nurse|RN|Registered Nurse|Doctor|Dr\.?|Social Worker|Chaplain|Case Manager|Investigator|Medical Examiner|Coroner|Deputy Coroner),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\s+(?:at|from|with)\b|\s*$)/i,
    /\bmy name(?:\s+is|'s)\s+((?!and\b|my\b|call\b|callback\b|phone\b|number\b)[A-Z][a-z]+(?:[,\s]+(?!and\b|my\b|call\b|callback\b|phone\b|number\b)[A-Z][a-z]+){0,2})(?=[,.]|\s+(?:and\s+)?(?:at|from|my|call|callback|phone|number)\b|\s*$)/i,
    /\b[Mm]y name is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\s+(?:at|from)\b|\s*$)/,
    /\b[Tt]his is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+from\b/,
    /\b[Tt]his is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\s+at\b|\s*$)/,
    /\b[Ii] am\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.]|\s*$)/,
  ]);
  if (callerName) {
    facts.caller_name = normalizeSpokenName(callerName);
    factConfidence.caller_name = 0.86;
  }

  const phone = text.match(phonePattern)?.[0];
  if (phone) {
    facts.caller_phone = phone;
    facts.preferred_callback_number = phone;
    facts.pickup_contact_phone = phone;
    factConfidence.caller_phone = 0.92;
    factConfidence.preferred_callback_number = 0.92;
    factConfidence.pickup_contact_phone = 0.92;
  }

  const relationship = matchRelationship(lower);
  if (relationship) {
    facts.caller_relationship_to_decedent = normalizeRelationship(relationship);
    factConfidence.caller_relationship_to_decedent = 0.82;
  } else if (facilityContactRole) {
    facts.caller_relationship_to_decedent = "facility_staff";
    factConfidence.caller_relationship_to_decedent = 0.82;
  }

  const decedentName = matchFirst(text, [
    /\b(?:[Cc]alling|[Cc]alled)\s+about\s+(?:Mr\.?|Mrs\.?|Ms\.?|Miss|Dr\.?)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})(?=\s+(?:in|at|from|room|case)\b|[,.]|\s*$)/,
    /\b(?:[Cc]alling|[Cc]alled)\s+about\s+(?:my|our)\s+(?:father|mother|dad|mom|husband|wife|brother|sister|son|daughter|aunt|uncle|grandfather|grandmother)[,.]?\s+((?!the\b|funeral\b|home\b)[A-Z][a-z]+(?:[,\s]+(?!the\b|funeral\b|home\b|is\b|was\b|and\b)[A-Z][a-z]+){0,3})(?=[,.]|\s+(?:the\s+)?funeral home\b|\s+(?:is|was|and)\b|\s*$)/i,
    /\b(?:we\s+have|we'?ve\s+got)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}?)(?=\s+(?:ready\s+for\s+release|ready\s+to\s+release|for\s+release)\b)/i,
    /\b(?:[Ff]ather|[Mm]other|[Dd]ad|[Mm]om|[Hh]usband|[Ww]ife|[Bb]rother|[Ss]ister|[Ss]on|[Dd]aughter),?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}),?\s+(?:just\s+)?(?:passed away|died)\b/,
    /\b(?:[Hh]is|[Hh]er|[Tt]heir)\s+name\s+is\s+([A-Z][a-z]+(?:[.\s]+[A-Z][a-z]+){0,3})(?=[,.]|\b)/,
    /\b(?:[Tt]he\s+)?(?:[Dd]ecedent|[Pp]erson who passed|[Pp]erson that passed)\s+(?:is|was|named)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/,
    /\b(?:decedent|patient|resident)\s+(?:is|was|named)?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/,
    /\b(?:[Pp]atient|[Rr]esident)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:was\s+)?(?:pronounced|released|ready)\b/,
    /\b(?:decedent|patient|resident)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\s+(?:was\s+)?(?:pronounced|released|ready)\b/,
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/,
  ]);
  if (decedentName) {
    facts.decedent_name = normalizeSpokenName(decedentName);
    factConfidence.decedent_name = 0.84;
  }

  const caseReference = matchFirst(text, [
    /\bcase[.,:;]?\s*(?:number|no\.?|#)?\s*([A-Za-z0-9][A-Za-z0-9-]{2,})\b/i,
  ]);
  if (caseReference) {
    facts.crm_existing_case_reference = caseReference;
    factConfidence.crm_existing_case_reference = 0.84;
  }

  const facilityName = extractFacilityName(text);
  if (facilityName) {
    facts.facility_name = facilityName;
    factConfidence.facility_name = 0.84;
    if (!facts.caller_relationship_to_decedent && facts.caller_name) {
      facts.caller_relationship_to_decedent = "facility_staff";
      factConfidence.caller_relationship_to_decedent = 0.8;
    }
  }

  const address = matchFirst(text, [
    /\bat\s+(\d{1,3}:\d{2}\s+[A-Z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)\b(?:,\s*[A-Z][A-Za-z\s]+)*)/,
    /\bat\s+(\d{2,6}\s+[A-Z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)\b(?:,\s*[A-Z][A-Za-z\s]+)*)/,
    /\b[Aa]ddress is\s+(\d{2,6}\s+[A-Z0-9][A-Za-z0-9\s.-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl|Terrace|Ter|Parkway|Pkwy)\b(?:,\s*[A-Z][A-Za-z\s]+)*)/,
  ]);
  if (address) {
    facts.pickup_address = normalizeSpokenStreetNumber(address.trim());
    factConfidence.pickup_address = 0.8;
  }

  let placeOfDeath = placeTerms.find(([, pattern]) => pattern.test(text))?.[0] ?? (address ? "residence" : undefined);
  if (isRoutineInquiryIntent(intent) && placeOfDeath === "residence" && !address && !facts.facility_name) {
    placeOfDeath = undefined;
  }
  facts.place_of_death_type = placeOfDeath ?? "unknown";
  factConfidence.place_of_death_type = placeOfDeath ? 0.72 : 0.3;

  if (/\b(i am|we are|family is|nurse is)\s+(here|with)\b/i.test(text)) {
    facts.currently_with_decedent = true;
    factConfidence.currently_with_decedent = 0.78;
  }

  const requestedFuneralHome = matchFirst(text, [
    /\brelease to\s+([A-Z][A-Za-z\s]+?Funeral Home)\b/,
    /\b(?:calling|called|need|want)\s+([A-Z][A-Za-z\s]+Funeral Home)\b/,
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,4}\s+Funeral Home)\b/,
  ]);
  if (requestedFuneralHome) {
    facts.requested_funeral_home = requestedFuneralHome.trim();
    factConfidence.requested_funeral_home = 0.84;
  }

  facts.urgency = inferUrgency(lower, intent);
  factConfidence.urgency = facts.urgency === "unknown" ? 0.35 : 0.76;
  const callerEmotion = inferCallerEmotion(lower);
  if (callerEmotion) {
    facts.caller_emotional_state = callerEmotion;
    factConfidence.caller_emotional_state = 0.7;
  }
  if (facts.caller_name) {
    facts.pickup_contact_name = facts.caller_name;
    factConfidence.pickup_contact_name = factConfidence.caller_name ?? 0.78;
  }

  if (!facts.caller_name) warnings.push("caller_name_not_found");
  if (!facts.caller_phone) warnings.push("caller_phone_not_found");
  if (!isRoutineInquiryIntent(intent)) {
    if (!facts.decedent_name) warnings.push("decedent_name_not_found");
    if (!facts.pickup_address && !facts.facility_name) warnings.push("pickup_context_not_found");
  }

  return {
    intent,
    facts,
    sentiment: inferSentiment(lower),
    confidence: warnings.length === 0 ? 0.85 : Math.max(0.45, 0.8 - warnings.length * 0.1),
    factConfidence,
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

function normalizeSpokenName(value: string): string {
  return value
    .replace(/[.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .filter((word) => !isSpokenNameFiller(word))
    .map(normalizeNameWord)
    .join(" ");
}

function isSpokenNameFiller(word: string): boolean {
  return /^(?:uh|um|umm|er|ah)$/i.test(word);
}

function normalizeNameWord(word: string): string {
  if (/^[A-Z]{2,3}$/.test(word)) return word;
  if (/^mc[a-z]+$/i.test(word) && word.length > 2) {
    return `Mc${word[2]?.toUpperCase() ?? ""}${word.slice(3).toLowerCase()}`;
  }
  return `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`;
}

function matchFacilityContactRole(input: string): string | undefined {
  const role = input.match(
    /\b(?:this is|i am|i'm)\s+(nurse|rn|registered nurse|doctor|dr\.?|social worker|chaplain|case manager|investigator|medical examiner|coroner|deputy coroner)\b/i,
  )?.[1];
  if (!role) return undefined;
  return normalizeFacilityContactRole(role);
}

function normalizeFacilityContactRole(value: string): string {
  const normalized = value.toLowerCase().replace(".", "").replace(/\s+/g, "_");
  if (normalized === "rn" || normalized === "registered_nurse") return "nurse";
  if (normalized === "dr" || normalized === "doctor") return "doctor";
  return normalized;
}

function extractFacilityName(input: string): string | undefined {
  const patterns = [
    /\b(?:at|from|with)\s+(?:the\s+)?([A-Z][A-Za-z']*(?:\s+[A-Z][A-Za-z']*){0,6})[,.]?\s+(medical examiner'?s office|medical examiner office|coroner'?s office|county morgue)\b/i,
    /\b(?:at|from|with)\s+(?:the\s+)?([A-Z][A-Za-z']*(?:\s+[A-Z][A-Za-z']*){0,5})[,.]?\s+(hospital|hospice|care center|medical center|nursing home)\b/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    const facilityPrefix = match?.[1]?.trim();
    if (match && facilityPrefix && !/^the$/i.test(facilityPrefix)) {
      return normalizeFacilityName(`${facilityPrefix} ${match[2] ?? ""}`);
    }
  }
  return undefined;
}

function normalizeFacilityName(value: string): string {
  return value
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
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

function inferUrgency(text: string, intent: CallIntent): FirstCallUrgency {
  if (isRoutineInquiryIntent(intent) || hasNegatedDeathReport(text)) return "routine";
  if (/\b(911|emergency|unsafe|police|fire|medical examiner|coroner)\b/.test(text)) return "emergency";
  if (/\b(just passed|passed away|died|death|body|removal|pronounced|ready for release|release to)\b/.test(text)) return "urgent";
  return "unknown";
}

function isRoutineInquiryIntent(intent: CallIntent): boolean {
  return intent === "pricing_or_billing" || intent === "family_question" || intent === "service_schedule_question";
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
