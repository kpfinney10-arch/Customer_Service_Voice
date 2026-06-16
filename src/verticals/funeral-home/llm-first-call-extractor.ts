import type { StructuredOutputAdapter } from "../../providers/model/structured-output-adapter.js";
import type { FirstCallExtraction, FirstCallExtractor } from "./first-call-extractor.js";
import { deterministicFirstCallExtractor } from "./first-call-extractor.js";
import type { FirstCallFacts } from "./first-call-facts.js";

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
    place_of_death_type: { type: ["string", "null"] },
    urgency: { type: ["string", "null"] },
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
      const facts = mergeMissingFacts(base.facts, structured.output);
      return {
        ...base,
        facts,
        confidence: Math.max(base.confidence, structured.confidence),
        warnings: [
          ...base.warnings.filter((warning) => !isResolvedWarning(warning, facts)),
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
