export type CallerLanguagePurpose =
  | "collect_caller"
  | "collect_phone"
  | "collect_name"
  | "collect_decedent"
  | "collect_case_reference"
  | "collect_location"
  | "retry_phone_digits"
  | "retry_address_format";

export type CallerLanguageUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type CallerLanguageModelRequest = {
  tenantId: string;
  callId: string;
  purpose: CallerLanguagePurpose;
  canonicalText: string;
};

export type CallerLanguageModelResponse = {
  text: string;
  purpose: CallerLanguagePurpose;
  provider: "openai";
  model: string;
  usage: CallerLanguageUsage;
};

export type CallerLanguageGenerator = {
  generate: (request: CallerLanguageModelRequest) => Promise<CallerLanguageModelResponse>;
};

export type CallerLanguagePricing = {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  outputUsdPerMillion: number;
  version: string;
};

export type CallerLanguageRuntime =
  | {
      mode: "deterministic";
      nowMs?: () => number;
    }
  | {
      mode: "openai";
      generator: CallerLanguageGenerator;
      pricing: CallerLanguagePricing;
      nowMs?: () => number;
    };

export type CallerLanguageStatus = "deterministic" | "generated" | "skipped" | "fallback";

export type CallerLanguageFallbackReason =
  | "unapproved_canonical_text"
  | "timeout"
  | "provider_error"
  | "invalid_output";

export type CallerLanguageOutcome = {
  text: string;
  mode: CallerLanguageRuntime["mode"];
  status: CallerLanguageStatus;
  provider: "deterministic" | "openai";
  purpose?: CallerLanguagePurpose;
  model?: string;
  fallbackReason?: CallerLanguageFallbackReason;
  latencyMs: number;
  usage: CallerLanguageUsage;
  estimatedCostMicrousd: number;
  pricingVersion?: string;
};

export class CallerLanguageGenerationError extends Error {
  constructor(
    public readonly code: "timeout" | "provider_error" | "invalid_output",
    message: string,
  ) {
    super(message);
    this.name = "CallerLanguageGenerationError";
  }
}

const zeroUsage: CallerLanguageUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

const approvedCanonicalText = new Map<string, CallerLanguagePurpose>([
  [
    "May I have your name and the best phone number in case we are disconnected?",
    "collect_caller",
  ],
  ["What is the best phone number in case we are disconnected?", "collect_phone"],
  ["I have the callback number. May I have your name?", "collect_name"],
  ["May I have the name of the person who passed away?", "collect_decedent"],
  ["May I have the medical examiner case number?", "collect_case_reference"],
  ["Where is your loved one located right now?", "collect_location"],
  [
    "I heard a phone number, but I want to make sure I have all 10 digits correctly. Please say the best callback number one digit at a time.",
    "retry_phone_digits",
  ],
  [
    "I am sorry, I still do not have the address clearly. Please say only the house number one digit at a time, followed by the street name and city.",
    "retry_address_format",
  ],
]);

const requiredLanguagePatterns: Record<CallerLanguagePurpose, RegExp[]> = {
  collect_caller: [/\bname\b/i, /\b(?:phone|callback)\b/i],
  collect_phone: [/\b(?:phone|callback)\b/i, /\bnumber\b/i],
  collect_name: [/\bname\b/i],
  collect_decedent: [/\bname\b/i, /\b(?:passed away|died|decedent|loved one|person)\b/i],
  collect_case_reference: [/\b(?:medical examiner|case)\b/i, /\b(?:number|reference)\b/i],
  collect_location: [/\b(?:where|address|location|located)\b/i],
  retry_phone_digits: [/\b(?:phone|callback)\b/i, /\bdigit/i],
  retry_address_format: [/\bhouse\b/i, /\bstreet\b/i, /\bcity\b/i],
};

const forbiddenPurposePatterns: Record<CallerLanguagePurpose, RegExp> = {
  collect_caller: /(?:\b(?:where|address|location|located|passed away|died|decedent)\b|\bcase (?:number|reference)\b)/i,
  collect_phone: /(?:\b(?:where|name|address|location|located|passed away|died|decedent)\b|\bcase (?:number|reference)\b)/i,
  collect_name: /(?:\b(?:where|phone|callback|address|location|located|passed away|died|decedent)\b|\bcase (?:number|reference)\b)/i,
  collect_decedent: /(?:\b(?:where|phone|callback|address|location|located)\b|\bcase (?:number|reference)\b)/i,
  collect_case_reference: /\b(?:where|phone|callback|address|location|located)\b/i,
  collect_location: /(?:\b(?:phone|callback)\b|\bcase (?:number|reference)\b)/i,
  retry_phone_digits: /(?:\b(?:where|name|address|location|located)\b|\bcase (?:number|reference)\b)/i,
  retry_address_format: /(?:\b(?:phone|callback)\b|\bcase (?:number|reference)\b)/i,
};

const prohibitedLanguagePattern =
  /(?:\$|\b(?:price|pricing|cost|fee|dollar|guarantee|promise|transfer|connect|medical advice|legal advice|911)\b)/i;

export function createDeterministicCallerLanguageRuntime(): CallerLanguageRuntime {
  return { mode: "deterministic" };
}

export async function generateCallerLanguage(
  runtime: CallerLanguageRuntime,
  input: { tenantId: string; callId: string; canonicalText: string },
): Promise<CallerLanguageOutcome> {
  if (runtime.mode === "deterministic") {
    return deterministicOutcome(input.canonicalText, "deterministic", 0);
  }

  const purpose = approvedCanonicalText.get(input.canonicalText);
  if (!purpose) {
    return deterministicOutcome(
      input.canonicalText,
      "skipped",
      0,
      "unapproved_canonical_text",
    );
  }

  const nowMs = runtime.nowMs ?? Date.now;
  const startedAt = nowMs();
  try {
    const generated = await runtime.generator.generate({
      tenantId: input.tenantId,
      callId: input.callId,
      purpose,
      canonicalText: input.canonicalText,
    });
    const text = validateGeneratedText(generated, purpose);
    const usage = normalizeUsage(generated.usage);
    return {
      text,
      mode: "openai",
      status: "generated",
      provider: generated.provider,
      purpose,
      model: generated.model,
      latencyMs: Math.max(0, nowMs() - startedAt),
      usage,
      estimatedCostMicrousd: estimateCostMicrousd(usage, runtime.pricing),
      pricingVersion: runtime.pricing.version,
    };
  } catch (error) {
    const reason =
      error instanceof CallerLanguageGenerationError ? error.code : "provider_error";
    return deterministicOutcome(
      input.canonicalText,
      "fallback",
      Math.max(0, nowMs() - startedAt),
      reason,
      purpose,
    );
  }
}

function validateGeneratedText(
  generated: CallerLanguageModelResponse,
  purpose: CallerLanguagePurpose,
): string {
  const text = generated.text.trim().replace(/\s+/g, " ");
  if (generated.purpose !== purpose) {
    throw new CallerLanguageGenerationError("invalid_output", "Purpose did not match the request.");
  }
  if (!text || text.length > 280 || /[\r\n]/.test(generated.text)) {
    throw new CallerLanguageGenerationError("invalid_output", "Generated language length was invalid.");
  }
  if ((text.match(/\?/g) ?? []).length !== 1) {
    throw new CallerLanguageGenerationError(
      "invalid_output",
      "Generated language must contain exactly one question.",
    );
  }
  if (
    /\d/.test(text) ||
    prohibitedLanguagePattern.test(text) ||
    forbiddenPurposePatterns[purpose].test(text)
  ) {
    throw new CallerLanguageGenerationError(
      "invalid_output",
      "Generated language introduced prohibited content.",
    );
  }
  if (requiredLanguagePatterns[purpose].some((pattern) => !pattern.test(text))) {
    throw new CallerLanguageGenerationError(
      "invalid_output",
      "Generated language did not preserve the approved request.",
    );
  }
  return text;
}

function deterministicOutcome(
  text: string,
  status: Exclude<CallerLanguageStatus, "generated">,
  latencyMs: number,
  fallbackReason?: CallerLanguageFallbackReason,
  purpose?: CallerLanguagePurpose,
): CallerLanguageOutcome {
  const outcome: CallerLanguageOutcome = {
    text,
    mode: status === "deterministic" ? "deterministic" : "openai",
    status,
    provider: "deterministic",
    latencyMs,
    usage: { ...zeroUsage },
    estimatedCostMicrousd: 0,
  };
  if (fallbackReason) outcome.fallbackReason = fallbackReason;
  if (purpose) outcome.purpose = purpose;
  return outcome;
}

function normalizeUsage(usage: CallerLanguageUsage): CallerLanguageUsage {
  return {
    inputTokens: nonNegativeInteger(usage.inputTokens),
    cachedInputTokens: nonNegativeInteger(usage.cachedInputTokens),
    cacheWriteTokens: nonNegativeInteger(usage.cacheWriteTokens),
    outputTokens: nonNegativeInteger(usage.outputTokens),
    totalTokens: nonNegativeInteger(usage.totalTokens),
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function estimateCostMicrousd(
  usage: CallerLanguageUsage,
  pricing: CallerLanguagePricing,
): number {
  const uncachedInputTokens = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
  );
  return Math.max(
    0,
    Math.round(
      uncachedInputTokens * pricing.inputUsdPerMillion +
        usage.cachedInputTokens * pricing.cachedInputUsdPerMillion +
        usage.cacheWriteTokens * pricing.cacheWriteUsdPerMillion +
        usage.outputTokens * pricing.outputUsdPerMillion,
    ),
  );
}
