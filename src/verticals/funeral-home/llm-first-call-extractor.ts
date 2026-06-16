import type { StructuredOutputAdapter } from "../../providers/model/structured-output-adapter.js";
import type { FirstCallExtraction, FirstCallExtractor } from "./first-call-extractor.js";
import { deterministicFirstCallExtractor } from "./first-call-extractor.js";
import type { FirstCallFacts, FirstCallUrgency, PlaceOfDeathType } from "./first-call-facts.js";

export type LlmFallbackFirstCallExtractorOptions = {
  tenantId: string;
  adapter: StructuredOutputAdapter;
  baseExtractor?: FirstCallExtractor;
  minBaseConfidenceForSkip?: number;
};

export const firstCallFactsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "caller_name",
    "caller_phone",
    "caller_relationship_to_decedent",
    "decedent_name",
    "pickup_address",
    "facility_name",
    "place_of_death_type",
    "urgency",
  ],
  properties: {
    caller_name: { type: ["string", "null"] },
    caller_phone: { type: ["string", "null"] },
    caller_relationship_to_decedent: { type: ["string", "null"] },
    decedent_name: { type: ["string", "null"] },
    pickup_address: { type: ["string", "null"] },
    facility_name: { type: ["string", "null"] },
    place_of_death_type: {
      anyOf: [
        { type: "string", enum: ["residence", "hospital", "hospice", "nursing_home", "medical_examiner", "other", "unknown"] },
        { type: "null" },
      ],
    },
    urgency: {
      anyOf: [
        { type: "string", enum: ["routine", "urgent", "emergency", "unknown"] },
        { type: "null" },
      ],
    },
  },
};

export function createLlmFallbackFirstCallExtractor(
  options: LlmFallbackFirstCallExtractorOptions,
): FirstCallExtractor {
  const baseExtractor = options.baseExtractor ?? deterministicFirstCallExtractor;
  const minBaseConfidenceForSkip = options.minBaseConfidenceForSkip ?? 0.8;

  return {
    async extract(transcript: string): Promise<FirstCallExtraction> {
      const base = await baseExtractor.extract(transcript);
      if (base.confidence >= minBaseConfidenceForSkip && base.warnings.length === 0) {
        return base;
      }

      const structured = await generateFallbackFacts(options.adapter, {
        tenantId: options.tenantId,
        transcript,
      });
      const sanitizedOutput = sanitizeFallbackFacts(structured.output);
      const facts = mergeMissingFacts(base.facts, sanitizedOutput.facts);
      return {
        ...base,
        facts,
        confidence: Math.max(base.confidence, structured.confidence),
        warnings: [
          ...base.warnings.filter((warning) => !isResolvedWarning(warning, facts)),
          ...sanitizedOutput.warnings.map((warning) => `llm:${warning}`),
          ...structured.warnings.map((warning) => `llm:${warning}`),
        ],
      };
    },
  };
}

async function generateFallbackFacts(
  adapter: StructuredOutputAdapter,
  input: {
    tenantId: string;
    transcript: string;
  },
) {
  try {
    return await adapter.generateStructuredOutput<Partial<FirstCallFacts>>({
      tenantId: input.tenantId,
      taskName: "funeral_home.first_call_fact_extraction",
      transcript: input.transcript,
      schema: firstCallFactsSchema,
    });
  } catch (error) {
    return {
      output: {},
      confidence: 0,
      provider: "structured-output-error",
      warnings: [`provider_error:${error instanceof Error ? error.name : "unknown"}`],
    };
  }
}

function mergeMissingFacts(
  baseFacts: Partial<FirstCallFacts>,
  fallbackFacts: Partial<FirstCallFacts>,
): Partial<FirstCallFacts> {
  const merged: Partial<FirstCallFacts> = { ...baseFacts };
  for (const [key, value] of Object.entries(fallbackFacts) as Array<[keyof FirstCallFacts, FirstCallFacts[keyof FirstCallFacts]]>) {
    if (merged[key] == null && value != null) {
      setFact(merged, key, value);
    }
  }
  return merged;
}

function sanitizeFallbackFacts(input: Partial<FirstCallFacts>): {
  facts: Partial<FirstCallFacts>;
  warnings: string[];
} {
  const facts: Partial<FirstCallFacts> = {};
  const warnings: string[] = [];

  copyStringFact(input, facts, "caller_name");
  copyStringFact(input, facts, "caller_phone");
  copyStringFact(input, facts, "decedent_name");
  copyStringFact(input, facts, "pickup_address");
  copyStringFact(input, facts, "facility_name");

  const relationship = normalizeRelationship(input.caller_relationship_to_decedent);
  if (relationship) facts.caller_relationship_to_decedent = relationship;
  else if (input.caller_relationship_to_decedent) warnings.push("discarded_invalid_relationship");

  const place = normalizePlaceOfDeath(input.place_of_death_type);
  if (place) facts.place_of_death_type = place;
  else if (input.place_of_death_type) warnings.push("discarded_invalid_place_of_death_type");

  const urgency = normalizeUrgency(input.urgency);
  if (urgency) facts.urgency = urgency;
  else if (input.urgency) warnings.push("discarded_invalid_urgency");

  return { facts, warnings };
}

function copyStringFact<K extends keyof FirstCallFacts>(
  input: Partial<FirstCallFacts>,
  output: Partial<FirstCallFacts>,
  key: K,
): void {
  const value = input[key];
  if (typeof value === "string" && value.trim()) {
    setFact(output, key, value.trim() as FirstCallFacts[K]);
  }
}

function normalizeRelationship(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_");
  if (!normalized) return undefined;
  const allowed = new Set([
    "father",
    "mother",
    "husband",
    "wife",
    "brother",
    "sister",
    "son",
    "daughter",
    "aunt",
    "uncle",
    "grandfather",
    "grandmother",
    "spouse",
    "partner",
    "friend",
    "caregiver",
    "nurse",
    "facility_staff",
    "other",
  ]);
  if (normalized === "dad") return "father";
  if (normalized === "mom") return "mother";
  if (normalized === "hospital_staff" || normalized === "hospice_staff" || normalized === "staff") return "facility_staff";
  return allowed.has(normalized) ? normalized : undefined;
}

function normalizePlaceOfDeath(value: string | undefined): PlaceOfDeathType | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!normalized) return undefined;
  if (isPlaceOfDeathType(normalized)) return normalized;
  return undefined;
}

function normalizeUrgency(value: string | undefined): FirstCallUrgency | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "routine" || normalized === "urgent" || normalized === "emergency" || normalized === "unknown") {
    return normalized;
  }
  return undefined;
}

function isPlaceOfDeathType(value: string): value is PlaceOfDeathType {
  return (
    value === "residence" ||
    value === "hospital" ||
    value === "hospice" ||
    value === "nursing_home" ||
    value === "medical_examiner" ||
    value === "other" ||
    value === "unknown"
  );
}

function setFact<K extends keyof FirstCallFacts>(
  facts: Partial<FirstCallFacts>,
  key: K,
  value: FirstCallFacts[K],
): void {
  facts[key] = value;
}

function isResolvedWarning(warning: string, facts: Partial<FirstCallFacts>): boolean {
  if (warning === "caller_name_not_found") return Boolean(facts.caller_name);
  if (warning === "caller_phone_not_found") return Boolean(facts.caller_phone);
  if (warning === "decedent_name_not_found") return Boolean(facts.decedent_name);
  if (warning === "pickup_context_not_found") return Boolean(facts.pickup_address || facts.facility_name);
  return false;
}
