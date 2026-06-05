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

const firstCallFactsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    caller_name: { type: "string" },
    caller_phone: { type: "string" },
    caller_relationship_to_decedent: { type: "string" },
    decedent_name: { type: "string" },
    pickup_address: { type: "string" },
    facility_name: { type: "string" },
    place_of_death_type: { type: "string" },
    urgency: { type: "string" },
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

      const structured = await options.adapter.generateStructuredOutput<Partial<FirstCallFacts>>({
        tenantId: options.tenantId,
        taskName: "funeral_home.first_call_fact_extraction",
        transcript,
        schema: firstCallFactsSchema,
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
