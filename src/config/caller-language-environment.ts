import type {
  CallerLanguagePricing,
  CallerLanguageRuntime,
} from "../orchestrator/caller-language.js";
import { createCallerLanguageCache } from "../orchestrator/caller-language.js";
import { createOpenAiCallerLanguageAdapter } from "../providers/model/openai-caller-language-adapter.js";

export const DEFAULT_CALLER_LANGUAGE_MODEL = "gpt-5.6-luna";

const defaultLunaPricing: CallerLanguagePricing = {
  inputUsdPerMillion: 0.2,
  cachedInputUsdPerMillion: 0.02,
  cacheWriteUsdPerMillion: 0.25,
  outputUsdPerMillion: 1.2,
  version: "openai-public-2026-07-30",
};

export class CallerLanguageEnvironmentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CallerLanguageEnvironmentError";
  }
}

export function createCallerLanguageRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
  dependencies: { fetchImpl?: typeof fetch; nowMs?: () => number } = {},
): CallerLanguageRuntime {
  const mode = parseMode(env.CALLER_LANGUAGE_MODE);
  if (mode === "deterministic") {
    const runtime: CallerLanguageRuntime = { mode };
    if (dependencies.nowMs) runtime.nowMs = dependencies.nowMs;
    return runtime;
  }

  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new CallerLanguageEnvironmentError(
      "OPENAI_API_KEY_REQUIRED",
      "OPENAI_API_KEY is required when CALLER_LANGUAGE_MODE=openai.",
    );
  }
  const model = env.CALLER_LANGUAGE_OPENAI_MODEL?.trim() || DEFAULT_CALLER_LANGUAGE_MODEL;
  const adapterOptions = {
    apiKey,
    model,
    timeoutMs: parseTimeout(env.CALLER_LANGUAGE_OPENAI_TIMEOUT_MS),
  };
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  if (baseUrl) Object.assign(adapterOptions, { baseUrl });
  if (dependencies.fetchImpl) Object.assign(adapterOptions, { fetchImpl: dependencies.fetchImpl });

  const runtime: CallerLanguageRuntime = {
    mode,
    generator: createOpenAiCallerLanguageAdapter(adapterOptions),
    pricing: parsePricing(env, model),
    cache: createCallerLanguageCache(),
  };
  if (dependencies.nowMs) runtime.nowMs = dependencies.nowMs;
  return runtime;
}

function parseMode(value: string | undefined): CallerLanguageRuntime["mode"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "deterministic") return "deterministic";
  if (normalized === "openai") return normalized;
  throw new CallerLanguageEnvironmentError(
    "INVALID_CALLER_LANGUAGE_MODE",
    "CALLER_LANGUAGE_MODE must be deterministic or openai.",
  );
}

function parseTimeout(value: string | undefined): number {
  if (!value?.trim()) return 1_200;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 250 || parsed > 10_000) {
    throw new CallerLanguageEnvironmentError(
      "INVALID_CALLER_LANGUAGE_TIMEOUT",
      "CALLER_LANGUAGE_OPENAI_TIMEOUT_MS must be an integer from 250 through 10000.",
    );
  }
  return parsed;
}

function parsePricing(
  env: Record<string, string | undefined>,
  model: string,
): CallerLanguagePricing {
  const values = [
    env.CALLER_LANGUAGE_OPENAI_INPUT_USD_PER_MILLION,
    env.CALLER_LANGUAGE_OPENAI_CACHED_INPUT_USD_PER_MILLION,
    env.CALLER_LANGUAGE_OPENAI_CACHE_WRITE_USD_PER_MILLION,
    env.CALLER_LANGUAGE_OPENAI_OUTPUT_USD_PER_MILLION,
  ];
  const hasAnyOverride = values.some((value) => Boolean(value?.trim()));
  if (!hasAnyOverride && model === DEFAULT_CALLER_LANGUAGE_MODEL) {
    return { ...defaultLunaPricing };
  }
  if (values.some((value) => !value?.trim())) {
    throw new CallerLanguageEnvironmentError(
      "CALLER_LANGUAGE_PRICING_REQUIRED",
      "All caller-language OpenAI pricing rates are required when overriding the model or a rate.",
    );
  }
  const pricingVersion = env.CALLER_LANGUAGE_OPENAI_PRICING_VERSION?.trim();
  if (model !== DEFAULT_CALLER_LANGUAGE_MODEL && !pricingVersion) {
    throw new CallerLanguageEnvironmentError(
      "CALLER_LANGUAGE_PRICING_VERSION_REQUIRED",
      "CALLER_LANGUAGE_OPENAI_PRICING_VERSION is required when overriding the caller-language model.",
    );
  }

  return {
    inputUsdPerMillion: parseRate(values[0], "CALLER_LANGUAGE_OPENAI_INPUT_USD_PER_MILLION"),
    cachedInputUsdPerMillion: parseRate(
      values[1],
      "CALLER_LANGUAGE_OPENAI_CACHED_INPUT_USD_PER_MILLION",
    ),
    cacheWriteUsdPerMillion: parseRate(
      values[2],
      "CALLER_LANGUAGE_OPENAI_CACHE_WRITE_USD_PER_MILLION",
    ),
    outputUsdPerMillion: parseRate(
      values[3],
      "CALLER_LANGUAGE_OPENAI_OUTPUT_USD_PER_MILLION",
    ),
    version: pricingVersion || "operator-configured",
  };
}

function parseRate(value: string | undefined, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000) {
    throw new CallerLanguageEnvironmentError(
      "INVALID_CALLER_LANGUAGE_PRICING",
      `${name} must be a non-negative number no greater than 1000.`,
    );
  }
  return parsed;
}
