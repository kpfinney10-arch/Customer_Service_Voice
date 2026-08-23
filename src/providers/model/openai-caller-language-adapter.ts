import { createHash } from "node:crypto";
import {
  CallerLanguageGenerationError,
} from "../../orchestrator/caller-language.js";
import type {
  CallerLanguageGenerator,
  CallerLanguageModelRequest,
  CallerLanguageModelResponse,
  CallerLanguagePurpose,
  CallerLanguageUsage,
} from "../../orchestrator/caller-language.js";

export type OpenAiCallerLanguageAdapterOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createOpenAiCallerLanguageAdapter(
  options: OpenAiCallerLanguageAdapterOptions,
): CallerLanguageGenerator {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new CallerLanguageGenerationError(
      "provider_error",
      "OpenAI API key is required for caller-language generation.",
    );
  }
  if (/^https?:\/\//i.test(apiKey)) {
    throw new CallerLanguageGenerationError(
      "provider_error",
      "OpenAI API key appears to be a URL.",
    );
  }

  const model = options.model?.trim() || "gpt-5.6-luna";
  const baseUrl = (options.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 1_200;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generate(request): Promise<CallerLanguageModelResponse> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/responses`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(createResponseRequest(model, request)),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => undefined)) as
          | OpenAiCallerLanguageResponse
          | undefined;
        if (!response.ok) {
          throw new CallerLanguageGenerationError(
            "provider_error",
            `OpenAI caller-language request failed (${response.status}).`,
          );
        }
        if (body?.status && body.status !== "completed") {
          throw new CallerLanguageGenerationError(
            "provider_error",
            "OpenAI caller-language response did not complete.",
          );
        }

        const outputText = outputTextFromResponse(body);
        if (!outputText) {
          throw new CallerLanguageGenerationError(
            "invalid_output",
            "OpenAI caller-language response did not include output text.",
          );
        }
        const output = parseStructuredLanguage(outputText);
        return {
          text: output.spoken_text,
          purpose: output.purpose,
          provider: "openai",
          model: body?.model?.trim() || model,
          usage: usageFromResponse(body?.usage),
        };
      } catch (error) {
        if (error instanceof CallerLanguageGenerationError) throw error;
        if (controller.signal.aborted || isAbortError(error)) {
          throw new CallerLanguageGenerationError(
            "timeout",
            "OpenAI caller-language request timed out.",
          );
        }
        throw new CallerLanguageGenerationError(
          "provider_error",
          "OpenAI caller-language request failed.",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createResponseRequest(model: string, request: CallerLanguageModelRequest): object {
  return {
    model,
    store: false,
    safety_identifier: safetyIdentifier(request.tenantId, request.callId),
    reasoning: { effort: "none" },
    max_output_tokens: 120,
    input: [
      {
        role: "system",
        content:
          "You rewrite one pre-approved funeral-home receptionist prompt so it sounds warm, calm, and natural when spoken aloud. " +
          "Preserve the exact request and ask for no additional information. Use one or two short sentences with exactly one question. " +
          "Do not introduce names, addresses, phone numbers, prices, promises, transfers, operational decisions, medical advice, or legal advice. " +
          "Do not use numeric digits. Return only the required structured output.",
      },
      {
        role: "user",
        content: JSON.stringify({
          purpose: request.purpose,
          approved_prompt: request.canonicalText,
        }),
      },
    ],
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "caller_language_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            spoken_text: { type: "string" },
            purpose: { type: "string", enum: [request.purpose] },
          },
          required: ["spoken_text", "purpose"],
          additionalProperties: false,
        },
      },
    },
    tools: [],
  };
}

function safetyIdentifier(tenantId: string, callId: string): string {
  return `call_${createHash("sha256").update(`${tenantId}:${callId}`).digest("hex").slice(0, 32)}`;
}

function parseStructuredLanguage(outputText: string): {
  spoken_text: string;
  purpose: CallerLanguagePurpose;
} {
  let value: unknown;
  try {
    value = JSON.parse(outputText);
  } catch {
    throw new CallerLanguageGenerationError(
      "invalid_output",
      "OpenAI caller-language output was not valid JSON.",
    );
  }
  if (
    !isObject(value) ||
    typeof value.spoken_text !== "string" ||
    typeof value.purpose !== "string"
  ) {
    throw new CallerLanguageGenerationError(
      "invalid_output",
      "OpenAI caller-language output did not match the required shape.",
    );
  }
  return {
    spoken_text: value.spoken_text,
    purpose: value.purpose as CallerLanguagePurpose,
  };
}

type OpenAiCallerLanguageResponse = {
  status?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
    };
    output_tokens?: number;
    total_tokens?: number;
  };
};

function outputTextFromResponse(body: OpenAiCallerLanguageResponse | undefined): string | undefined {
  if (!body) return undefined;
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }
  return undefined;
}

function usageFromResponse(
  usage: OpenAiCallerLanguageResponse["usage"],
): CallerLanguageUsage {
  return {
    inputTokens: tokenCount(usage?.input_tokens),
    cachedInputTokens: tokenCount(usage?.input_tokens_details?.cached_tokens),
    cacheWriteTokens: tokenCount(usage?.input_tokens_details?.cache_write_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    totalTokens: tokenCount(usage?.total_tokens),
  };
}

function tokenCount(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? -1) >= 0 ? value ?? 0 : 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
