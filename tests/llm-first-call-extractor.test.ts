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
  assert.equal(output.factConfidence?.caller_name, 0.78);
  assert.equal(output.factConfidence?.pickup_address, 0.78);
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

test("LLM fallback normalizes controlled fact values", async () => {
  const transcript = "This is Megan from the hospital. The patient died and we need help.";
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      outputByTranscript: {
        [transcript]: {
          caller_relationship_to_decedent: "hospital staff",
          place_of_death_type: "nursing home",
          urgency: "URGENT",
        },
      },
    }),
  });

  const output = await extractor.extract(transcript);

  assert.equal(output.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(output.facts.place_of_death_type, "hospital");
  assert.equal(output.facts.urgency, "urgent");
});

test("LLM fallback discards invalid controlled fact values", async () => {
  const transcript = "The caller gave a confusing report and I need help.";
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      outputByTranscript: {
        [transcript]: {
          caller_relationship_to_decedent: "billing manager",
          place_of_death_type: "spaceship",
          urgency: "eventually",
        },
      },
    }),
  });

  const output = await extractor.extract(transcript);

  assert.equal(output.facts.caller_relationship_to_decedent, undefined);
  assert.equal(output.facts.place_of_death_type, "unknown");
  assert.equal(output.facts.urgency, "unknown");
  assert.equal(output.warnings.includes("llm:discarded_invalid_relationship"), true);
  assert.equal(output.warnings.includes("llm:discarded_invalid_place_of_death_type"), true);
  assert.equal(output.warnings.includes("llm:discarded_invalid_urgency"), true);
});

test("LLM fallback sends active intake context to structured adapter", async () => {
  const transcript = "The name is Amy Lee.";
  let seenContext: Record<string, unknown> | undefined;
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      defaultOutput: {
        decedent_name: "Amy Lee",
      },
      onRequest: (request) => {
        seenContext = request.context;
      },
    }),
  });

  const output = await extractor.extract(transcript, {
    tenantId: "fh-demo",
    activeStep: "collect_decedent",
    currentFacts: {
      caller_name: "Kyle Finny",
      caller_phone: "817-463-5280",
    },
    missingTargetFacts: ["decedent_name", "pickup_address"],
  });

  assert.equal(output.facts.decedent_name, "Amy Lee");
  assert.equal(seenContext?.activeStep, "collect_decedent");
  assert.deepEqual((seenContext?.currentFacts as Record<string, string>).caller_name, "Kyle Finny");
  assert.deepEqual(seenContext?.missingTargetFacts, ["decedent_name", "pickup_address"]);
});

test("LLM fallback skips structured adapter when local facts resolve active slot", async () => {
  const transcript = "The name is Amy Lee.";
  let requestCount = 0;
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      defaultOutput: {
        decedent_name: "Should Not Be Used",
      },
      onRequest: () => {
        requestCount += 1;
      },
    }),
  });

  const output = await extractor.extract(transcript, {
    tenantId: "fh-demo",
    activeStep: "collect_decedent",
    currentFacts: {
      caller_name: "Kyle Finny",
      caller_phone: "817-463-5280",
    },
    localFacts: {
      decedent_name: "Amy Lee",
    },
    missingTargetFacts: ["decedent_name", "pickup_address"],
  });

  assert.equal(output.facts.decedent_name, "Amy Lee");
  assert.equal(requestCount, 0);
});

test("LLM fallback still calls structured adapter when local facts do not resolve active slot", async () => {
  const transcript = "It is confusing.";
  let requestCount = 0;
  const extractor = createLlmFallbackFirstCallExtractor({
    tenantId: "fh-demo",
    adapter: createFakeStructuredOutputAdapter({
      defaultOutput: {
        decedent_name: "Amy Lee",
      },
      onRequest: () => {
        requestCount += 1;
      },
    }),
  });

  const output = await extractor.extract(transcript, {
    tenantId: "fh-demo",
    activeStep: "collect_decedent",
    currentFacts: {
      caller_name: "Kyle Finny",
      caller_phone: "817-463-5280",
    },
    localFacts: {
      caller_name: "Kyle Finny",
    },
    missingTargetFacts: ["decedent_name", "pickup_address"],
  });

  assert.equal(output.facts.decedent_name, "Amy Lee");
  assert.equal(requestCount, 1);
});
