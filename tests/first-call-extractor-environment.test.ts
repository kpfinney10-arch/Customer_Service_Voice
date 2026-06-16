import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFirstCallExtractorFromEnv,
  FirstCallExtractorEnvironmentError,
} from "../src/config/first-call-extractor-environment.js";

test("first-call extractor env defaults to deterministic extraction", async () => {
  const extractor = createFirstCallExtractorFromEnv({});
  const output = await extractor.extract("My name is Sarah Miller. My father Robert Miller passed away.");

  assert.equal(output.facts.caller_name, "Sarah Miller");
  assert.equal(output.facts.decedent_name, "Robert Miller");
});

test("first-call extractor env can enable fake LLM fallback", async () => {
  const extractor = createFirstCallExtractorFromEnv({
    FIRST_CALL_EXTRACTOR: "fake_llm",
    FIRST_CALL_FAKE_LLM_OUTPUT_JSON: JSON.stringify({
      caller_name: "Amanda Reed",
      decedent_name: "Thomas Reed",
      pickup_address: "22 Cedar Street, Plano",
    }),
  });

  const output = await extractor.extract("Hi, this is hard. Dad passed and I need help.");

  assert.equal(output.facts.caller_name, "Amanda Reed");
  assert.equal(output.facts.decedent_name, "Thomas Reed");
  assert.equal(output.facts.pickup_address, "22 Cedar Street, Plano");
});

test("first-call extractor env requires OpenAI key for OpenAI mode", () => {
  assert.throws(
    () =>
      createFirstCallExtractorFromEnv({
        FIRST_CALL_EXTRACTOR: "openai",
      }),
    FirstCallExtractorEnvironmentError,
  );
});

test("first-call extractor env rejects invalid mode and invalid fake output", () => {
  assert.throws(
    () =>
      createFirstCallExtractorFromEnv({
        FIRST_CALL_EXTRACTOR: "nope",
      }),
    FirstCallExtractorEnvironmentError,
  );
  assert.throws(
    () =>
      createFirstCallExtractorFromEnv({
        FIRST_CALL_EXTRACTOR: "fake_llm",
        FIRST_CALL_FAKE_LLM_OUTPUT_JSON: "[]",
      }),
    FirstCallExtractorEnvironmentError,
  );
});
