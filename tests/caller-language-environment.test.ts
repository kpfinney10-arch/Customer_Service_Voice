import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CallerLanguageEnvironmentError,
  createCallerLanguageRuntimeFromEnv,
} from "../src/config/caller-language-environment.js";

test("caller-language environment defaults to deterministic mode", () => {
  const runtime = createCallerLanguageRuntimeFromEnv({});
  assert.deepEqual(runtime, { mode: "deterministic" });
});

test("caller-language environment enables OpenAI with current Luna pricing", () => {
  const runtime = createCallerLanguageRuntimeFromEnv({
    CALLER_LANGUAGE_MODE: "openai",
    OPENAI_API_KEY: "test-openai-key",
  });

  assert.equal(runtime.mode, "openai");
  if (runtime.mode !== "openai") assert.fail("Expected OpenAI runtime.");
  assert.deepEqual(runtime.pricing, {
    inputUsdPerMillion: 0.2,
    cachedInputUsdPerMillion: 0.02,
    cacheWriteUsdPerMillion: 0.25,
    outputUsdPerMillion: 1.2,
    version: "openai-public-2026-07-30",
  });
});

test("caller-language environment requires a key and bounded timeout", () => {
  assert.throws(
    () => createCallerLanguageRuntimeFromEnv({ CALLER_LANGUAGE_MODE: "openai" }),
    (error: unknown) =>
      error instanceof CallerLanguageEnvironmentError &&
      error.code === "OPENAI_API_KEY_REQUIRED",
  );
  const runtime = createCallerLanguageRuntimeFromEnv({
    CALLER_LANGUAGE_MODE: "openai",
    OPENAI_API_KEY: "test-openai-key",
    CALLER_LANGUAGE_OPENAI_TIMEOUT_MS: "10000",
  });
  assert.equal(runtime.mode, "openai");

  assert.throws(
    () => createCallerLanguageRuntimeFromEnv({
      CALLER_LANGUAGE_MODE: "openai",
      OPENAI_API_KEY: "test-openai-key",
      CALLER_LANGUAGE_OPENAI_TIMEOUT_MS: "10001",
    }),
    /CALLER_LANGUAGE_OPENAI_TIMEOUT_MS/,
  );
});

test("caller-language environment requires explicit pricing for a model override", () => {
  assert.throws(
    () => createCallerLanguageRuntimeFromEnv({
      CALLER_LANGUAGE_MODE: "openai",
      OPENAI_API_KEY: "test-openai-key",
      CALLER_LANGUAGE_OPENAI_MODEL: "another-model",
    }),
    (error: unknown) =>
      error instanceof CallerLanguageEnvironmentError &&
      error.code === "CALLER_LANGUAGE_PRICING_REQUIRED",
  );
  assert.throws(
    () => createCallerLanguageRuntimeFromEnv({
      CALLER_LANGUAGE_MODE: "openai",
      OPENAI_API_KEY: "test-openai-key",
      CALLER_LANGUAGE_OPENAI_MODEL: "another-model",
      CALLER_LANGUAGE_OPENAI_INPUT_USD_PER_MILLION: "1",
      CALLER_LANGUAGE_OPENAI_CACHED_INPUT_USD_PER_MILLION: "0.1",
      CALLER_LANGUAGE_OPENAI_CACHE_WRITE_USD_PER_MILLION: "1.25",
      CALLER_LANGUAGE_OPENAI_OUTPUT_USD_PER_MILLION: "6",
    }),
    /PRICING_VERSION/,
  );

  const runtime = createCallerLanguageRuntimeFromEnv({
    CALLER_LANGUAGE_MODE: "openai",
    OPENAI_API_KEY: "test-openai-key",
    CALLER_LANGUAGE_OPENAI_MODEL: "another-model",
    CALLER_LANGUAGE_OPENAI_INPUT_USD_PER_MILLION: "1",
    CALLER_LANGUAGE_OPENAI_CACHED_INPUT_USD_PER_MILLION: "0.1",
    CALLER_LANGUAGE_OPENAI_CACHE_WRITE_USD_PER_MILLION: "1.25",
    CALLER_LANGUAGE_OPENAI_OUTPUT_USD_PER_MILLION: "6",
    CALLER_LANGUAGE_OPENAI_PRICING_VERSION: "operator-test",
  });

  assert.equal(runtime.mode, "openai");
  if (runtime.mode !== "openai") assert.fail("Expected OpenAI runtime.");
  assert.equal(runtime.pricing.version, "operator-test");
});

test("caller-language environment rejects unknown mode and partial rates", () => {
  assert.throws(
    () => createCallerLanguageRuntimeFromEnv({ CALLER_LANGUAGE_MODE: "chatbot" }),
    /CALLER_LANGUAGE_MODE/,
  );
  assert.throws(
    () => createCallerLanguageRuntimeFromEnv({
      CALLER_LANGUAGE_MODE: "openai",
      OPENAI_API_KEY: "test-openai-key",
      CALLER_LANGUAGE_OPENAI_INPUT_USD_PER_MILLION: "0.2",
    }),
    /pricing rates are required/i,
  );
});
