import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeStructuredOutputAdapter } from "../src/providers/model/fake-structured-output-adapter.js";
import { createLlmFallbackFirstCallExtractor } from "../src/verticals/funeral-home/llm-first-call-extractor.js";

test("LLM fallback fills missing first-call facts", async () => {
  const transcript = "Hi, this is hard. Dad passed and I need help.";
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      outputByTranscript: {
        [transcript]: {
          caller_name: "Amanda Reed",
          caller_phone: "555-909-1000",
          decedent_name: "Thomas Reed",
          pickup_address: "22 Cedar Street, Plano",
        },
      },
    }),
  });

  const output = await extractor.extract(transcript);

  assert.equal(output.facts.caller_name, "Amanda Reed");
  assert.equal(output.facts.caller_phone, "555-909-1000");
  assert.equal(output.facts.decedent_name, "Thomas Reed");
  assert.equal(output.facts.pickup_address, "22 Cedar Street, Plano");
  assert.equal(output.warnings.includes("caller_name_not_found"), false);
  assert.equal(output.warnings.includes("pickup_context_not_found"), false);
});

test("LLM fallback does not overwrite deterministic facts", async () => {
  const transcript = "My name is Sarah Miller. My father Robert Miller passed away. My number is 555-111-2222.";
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      outputByTranscript: {
        [transcript]: {
          caller_name: "Wrong Caller",
          decedent_name: "Wrong Decedent",
          pickup_address: "44 Birch Street, Frisco",
        },
      },
    }),
  });

  const output = await extractor.extract(transcript);

  assert.equal(output.facts.caller_name, "Sarah Miller");
  assert.equal(output.facts.decedent_name, "Robert Miller");
  assert.equal(output.facts.pickup_address, "44 Birch Street, Frisco");
});
