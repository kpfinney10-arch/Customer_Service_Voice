import { createFakeStructuredOutputAdapter } from "../providers/model/fake-structured-output-adapter.js";
import { createOpenAiStructuredOutputAdapter } from "../providers/model/openai-structured-output-adapter.js";
import type { FirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import { deterministicFirstCallExtractor } from "../verticals/funeral-home/first-call-extractor.js";
import { createLlmFallbackFirstCallExtractor } from "../verticals/funeral-home/llm-first-call-extractor.js";

export type FirstCallExtractorMode = "deterministic" | "fake_llm" | "openai";

export class FirstCallExtractorEnvironmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FirstCallExtractorEnvironmentError";
  }
}

export function createFirstCallExtractorFromEnv(
  env: Record<string, string | undefined> = process.env,
): FirstCallExtractor {
  const mode = parseMode(env.FIRST_CALL_EXTRACTOR);
  if (mode === "deterministic") return deterministicFirstCallExtractor;

  if (mode === "fake_llm") {
    const extractorOptions = {
      tenantId: env.FIRST_CALL_EXTRACTOR_TENANT_ID?.trim() || "fh-demo",
      adapter: createFakeStructuredOutputAdapter({
        defaultOutput: parseFakeOutput(env.FIRST_CALL_FAKE_LLM_OUTPUT_JSON),
      }),
    };
    addIfPresent(
      extractorOptions,
      "minBaseConfidenceForSkip",
      parseOptionalNumber(env.FIRST_CALL_LLM_MIN_BASE_CONFIDENCE),
    );
    return createLlmFallbackFirstCallExtractor(extractorOptions);
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new FirstCallExtractorEnvironmentError(
      "OPENAI_API_KEY_REQUIRED",
      "OPENAI_API_KEY is required when FIRST_CALL_EXTRACTOR=openai.",
    );
  }

  const adapterOptions = {
    apiKey,
  };
  addIfPresent(adapterOptions, "model", optionalTrimmed(env.OPENAI_MODEL));
  addIfPresent(adapterOptions, "baseUrl", optionalTrimmed(env.OPENAI_BASE_URL));
  addIfPresent(adapterOptions, "timeoutMs", parseOptionalPositiveInteger(env.OPENAI_TIMEOUT_MS));

  const extractorOptions = {
    tenantId: env.FIRST_CALL_EXTRACTOR_TENANT_ID?.trim() || "fh-demo",
    adapter: createOpenAiStructuredOutputAdapter(adapterOptions),
  };
  addIfPresent(
    extractorOptions,
    "minBaseConfidenceForSkip",
    parseOptionalNumber(env.FIRST_CALL_LLM_MIN_BASE_CONFIDENCE),
  );
  return createLlmFallbackFirstCallExtractor(extractorOptions);
}

function parseMode(value: string | undefined): FirstCallExtractorMode {
  if (!value?.trim()) return "deterministic";
  const normalized = value.trim();
  if (normalized === "deterministic" || normalized === "fake_llm" || normalized === "openai") return normalized;
  throw new FirstCallExtractorEnvironmentError(
    "INVALID_FIRST_CALL_EXTRACTOR",
    "FIRST_CALL_EXTRACTOR must be deterministic, fake_llm, or openai.",
  );
}

function parseFakeOutput(value: string | undefined): object {
  if (!value?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new FirstCallExtractorEnvironmentError(
        "INVALID_FIRST_CALL_FAKE_LLM_OUTPUT_JSON",
        "FIRST_CALL_FAKE_LLM_OUTPUT_JSON must be a JSON object.",
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof FirstCallExtractorEnvironmentError) throw error;
    throw new FirstCallExtractorEnvironmentError(
      "INVALID_FIRST_CALL_FAKE_LLM_OUTPUT_JSON",
      "FIRST_CALL_FAKE_LLM_OUTPUT_JSON must be valid JSON.",
    );
  }
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new FirstCallExtractorEnvironmentError(
      "INVALID_FIRST_CALL_LLM_MIN_BASE_CONFIDENCE",
      "FIRST_CALL_LLM_MIN_BASE_CONFIDENCE must be a number between 0 and 1.",
    );
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new FirstCallExtractorEnvironmentError(
      "INVALID_OPENAI_TIMEOUT_MS",
      "OPENAI_TIMEOUT_MS must be a positive integer.",
    );
  }
  return parsed;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
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
