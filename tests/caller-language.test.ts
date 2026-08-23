import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CallerLanguageGenerationError,
  generateCallerLanguage,
} from "../src/orchestrator/caller-language.js";
import type {
  CallerLanguageGenerator,
  CallerLanguageRuntime,
} from "../src/orchestrator/caller-language.js";

const canonicalDecedentPrompt = "May I have the name of the person who passed away?";

test("caller language remains deterministic when the feature is disabled", async () => {
  const output = await generateCallerLanguage(
    { mode: "deterministic" },
    {
      tenantId: "fh-demo",
      callId: "CAcallerlanguage0001",
      canonicalText: canonicalDecedentPrompt,
    },
  );

  assert.equal(output.text, canonicalDecedentPrompt);
  assert.equal(output.mode, "deterministic");
  assert.equal(output.status, "deterministic");
  assert.equal(output.estimatedCostMicrousd, 0);
  assert.equal(output.usage.totalTokens, 0);
});

test("caller language accepts a bounded rewrite and meters its estimated cost", async () => {
  const generator: CallerLanguageGenerator = {
    async generate(request) {
      assert.equal(request.purpose, "collect_decedent");
      return {
        text: "When you are ready, may I have the name of your loved one who passed away?",
        purpose: request.purpose,
        provider: "openai",
        model: "gpt-5.6-luna",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 20,
          cacheWriteTokens: 10,
          outputTokens: 20,
          totalTokens: 120,
        },
      };
    },
  };
  const clock = [100, 135];
  const runtime: CallerLanguageRuntime = {
    mode: "openai",
    generator,
    pricing: {
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      cacheWriteUsdPerMillion: 0.25,
      outputUsdPerMillion: 1.2,
      version: "test-pricing",
    },
    nowMs: () => clock.shift() ?? 135,
  };

  const output = await generateCallerLanguage(runtime, {
    tenantId: "fh-demo",
    callId: "CAcallerlanguage0002",
    canonicalText: canonicalDecedentPrompt,
  });

  assert.equal(output.status, "generated");
  assert.equal(output.provider, "openai");
  assert.equal(output.latencyMs, 35);
  assert.equal(output.estimatedCostMicrousd, 41);
  assert.equal(output.pricingVersion, "test-pricing");
});

test("caller language rejects extra questions and falls back to the canonical prompt", async () => {
  const output = await generateCallerLanguage(
    openAiRuntime({
      async generate(request) {
        return {
          text: "May I have the name of the person who passed away and your callback phone number?",
          purpose: request.purpose,
          provider: "openai",
          model: "gpt-5.6-luna",
          usage: emptyUsage(),
        };
      },
    }),
    {
      tenantId: "fh-demo",
      callId: "CAcallerlanguage0003",
      canonicalText: canonicalDecedentPrompt,
    },
  );

  assert.equal(output.text, canonicalDecedentPrompt);
  assert.equal(output.status, "fallback");
  assert.equal(output.fallbackReason, "invalid_output");
});

test("caller language never sends dynamic name or address confirmations to the model", async () => {
  let called = false;
  const runtime = openAiRuntime({
    async generate() {
      called = true;
      throw new Error("must not be called");
    },
  });
  const nameOutput = await generateCallerLanguage(
    runtime,
    {
      tenantId: "fh-demo",
      callId: "CAcallerlanguage0004",
      canonicalText:
        "I heard your name as Kyle Finney. Please spell your last name for the funeral director.",
    },
  );
  const addressOutput = await generateCallerLanguage(
    openAiRuntime({
      async generate() {
        called = true;
        throw new Error("must not be called");
      },
    }),
    {
      tenantId: "fh-demo",
      callId: "CAcallerlanguage0004address",
      canonicalText:
        "I heard 636 Commerce Avenue Keller Texas. Please repeat just the street name so I can make sure I have it right.",
    },
  );

  assert.equal(called, false);
  for (const output of [nameOutput, addressOutput]) {
    assert.equal(output.status, "skipped");
    assert.equal(output.fallbackReason, "unapproved_canonical_text");
    assert.equal(output.provider, "deterministic");
  }
});

test("caller language falls back on timeout without exposing the provider error", async () => {
  const output = await generateCallerLanguage(
    openAiRuntime({
      async generate() {
        throw new CallerLanguageGenerationError("timeout", "sensitive provider detail");
      },
    }),
    {
      tenantId: "fh-demo",
      callId: "CAcallerlanguage0005",
      canonicalText: "Where is your loved one located right now?",
    },
  );

  assert.equal(output.text, "Where is your loved one located right now?");
  assert.equal(output.status, "fallback");
  assert.equal(output.fallbackReason, "timeout");
  assert.equal("message" in output, false);
});

function openAiRuntime(generator: CallerLanguageGenerator): CallerLanguageRuntime {
  return {
    mode: "openai",
    generator,
    pricing: {
      inputUsdPerMillion: 0.2,
      cachedInputUsdPerMillion: 0.02,
      cacheWriteUsdPerMillion: 0.25,
      outputUsdPerMillion: 1.2,
      version: "test",
    },
  };
}

function emptyUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}
