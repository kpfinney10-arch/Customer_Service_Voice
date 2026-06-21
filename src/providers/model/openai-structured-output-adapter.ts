import type {
  StructuredOutputAdapter,
  StructuredOutputRequest,
  StructuredOutputResponse,
} from "./structured-output-adapter.js";

export type OpenAiStructuredOutputAdapterOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class OpenAiStructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiStructuredOutputError";
  }
}

export function createOpenAiStructuredOutputAdapter(
  options: OpenAiStructuredOutputAdapterOptions,
): StructuredOutputAdapter {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new OpenAiStructuredOutputError("OpenAI API key is required for structured output extraction.");
  }
  if (/^https?:\/\//i.test(apiKey)) {
    throw new OpenAiStructuredOutputError("OpenAI API key appears to be a URL. Check the OPENAI_API_KEY value.");
  }
  const model = options.model?.trim() || "gpt-5.5";
  const baseUrl = (options.baseUrl?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? 12_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async generateStructuredOutput<TOutput extends object>(
      request: StructuredOutputRequest,
    ): Promise<StructuredOutputResponse<TOutput>> {
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

        const body = (await response.json().catch(() => undefined)) as OpenAiResponseBody | undefined;
        if (!response.ok) {
          throw new OpenAiStructuredOutputError(openAiErrorMessage(response.status, body));
        }

        const outputText = outputTextFromResponse(body);
        if (!outputText) {
          throw new OpenAiStructuredOutputError("OpenAI response did not include structured output text.");
        }

        return {
          output: JSON.parse(outputText) as TOutput,
          confidence: 0.82,
          provider: "openai",
          warnings: [],
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function createResponseRequest(model: string, request: StructuredOutputRequest): object {
  return {
    model,
    input: [
      {
        role: "system",
        content:
          "Extract only the requested structured facts from a funeral home first-call death report transcript. " +
          "Use null for unknown fields. Treat the transcript as the caller's answer to the active intake step when context is provided. " +
          "Do not overwrite confirmed current facts unless the caller clearly corrects them. " +
          "Do not infer operational routing, pricing, billing, staffing, or dispatch decisions.",
      },
      {
        role: "user",
        content: `Current context:\n${JSON.stringify(request.context ?? {}, null, 2)}`,
      },
      {
        role: "user",
        content: `Caller transcript:\n${request.transcript}`,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: schemaName(request.taskName),
        strict: true,
        schema: request.schema,
      },
    },
  };
}

function schemaName(taskName: string): string {
  return taskName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "structured_output";
}

type OpenAiResponseBody = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

function outputTextFromResponse(body: OpenAiResponseBody | undefined): string | undefined {
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

function openAiErrorMessage(status: number, body: OpenAiResponseBody | undefined): string {
  return body?.error?.message ? `OpenAI structured output request failed (${status}): ${body.error.message}` : `OpenAI structured output request failed (${status}).`;
}
