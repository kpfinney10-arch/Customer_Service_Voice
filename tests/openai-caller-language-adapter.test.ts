import assert from "node:assert/strict";
import { test } from "node:test";
import { CallerLanguageGenerationError } from "../src/orchestrator/caller-language.js";
import { createOpenAiCallerLanguageAdapter } from "../src/providers/model/openai-caller-language-adapter.js";

test("OpenAI caller-language adapter sends a stateless constrained request and returns usage", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    assert.equal(String(input), "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      status: "completed",
      model: "gpt-5.6-luna-2026-07-30",
      output_text: JSON.stringify({
        spoken_text: "When you are ready, may I have the name of the person who passed away?",
        purpose: "collect_decedent",
      }),
      usage: {
        input_tokens: 88,
        input_tokens_details: {
          cached_tokens: 12,
          cache_write_tokens: 4,
        },
        output_tokens: 18,
        total_tokens: 106,
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const adapter = createOpenAiCallerLanguageAdapter({
    apiKey: "test-openai-key",
    fetchImpl,
  });

  const output = await adapter.generate({
    tenantId: "fh-demo",
    callId: "CAprivatecallidentifier0000000001",
    purpose: "collect_decedent",
    canonicalText: "May I have the name of the person who passed away?",
  });

  assert.equal(output.provider, "openai");
  assert.equal(output.model, "gpt-5.6-luna-2026-07-30");
  assert.equal(output.usage.inputTokens, 88);
  assert.equal(output.usage.cachedInputTokens, 12);
  assert.equal(output.usage.cacheWriteTokens, 4);
  assert.equal(output.usage.outputTokens, 18);
  assert.equal(output.usage.totalTokens, 106);

  assert.equal(requestBody?.model, "gpt-5.6-luna");
  assert.equal(requestBody?.store, false);
  assert.deepEqual(requestBody?.reasoning, { effort: "none" });
  assert.deepEqual(requestBody?.tools, []);
  assert.match(String(requestBody?.safety_identifier), /^call_[a-f0-9]{32}$/);
  const serialized = JSON.stringify(requestBody);
  assert.doesNotMatch(serialized, /CAprivatecallidentifier|fh-demo|caller transcript|current facts/i);
  assert.match(serialized, /May I have the name of the person who passed away/);
});

test("OpenAI caller-language adapter rejects malformed structured output", async () => {
  const adapter = createOpenAiCallerLanguageAdapter({
    apiKey: "test-openai-key",
    fetchImpl: async () => new Response(JSON.stringify({
      status: "completed",
      output_text: JSON.stringify({ spoken_text: "Hello" }),
    }), { status: 200 }),
  });

  await assert.rejects(
    () => adapter.generate({
      tenantId: "fh-demo",
      callId: "CAinvalidoutput0001",
      purpose: "collect_name",
      canonicalText: "I have the callback number. May I have your name?",
    }),
    (error: unknown) =>
      error instanceof CallerLanguageGenerationError && error.code === "invalid_output",
  );
});

test("OpenAI caller-language adapter converts aborts into a bounded timeout", async () => {
  const fetchImpl: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    });
  const adapter = createOpenAiCallerLanguageAdapter({
    apiKey: "test-openai-key",
    timeoutMs: 5,
    fetchImpl,
  });

  await assert.rejects(
    () => adapter.generate({
      tenantId: "fh-demo",
      callId: "CAtimeout0001",
      purpose: "collect_location",
      canonicalText: "Where is your loved one located right now?",
    }),
    (error: unknown) =>
      error instanceof CallerLanguageGenerationError && error.code === "timeout",
  );
});
