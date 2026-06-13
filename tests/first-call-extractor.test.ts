import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  decideFirstCallNextStep,
  extractFirstCallFactsDeterministic,
  type FirstCallExtraction,
} from "../src/index.js";

type Fixture = {
  name: string;
  transcript: string;
  expected: {
    intent: string;
    sentiment?: string;
    facts: Record<string, unknown>;
    decision: {
      step: string;
      toolNames: string[];
    };
  };
};

const fixtureDir = "tests/fixtures/first-call";

for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith(".json"))) {
  const fixture = JSON.parse(readFileSync(join(fixtureDir, file), "utf8")) as Fixture;

  test(`first-call extractor fixture: ${fixture.name}`, () => {
    const extraction = extractFirstCallFactsDeterministic(fixture.transcript);
    assert.equal(extraction.intent, fixture.expected.intent);
    if (fixture.expected.sentiment) assert.equal(extraction.sentiment, fixture.expected.sentiment);
    assertFacts(extraction, fixture.expected.facts);

    const decision = decideFirstCallNextStep(extraction.facts);
    assert.equal(decision.step, fixture.expected.decision.step);
    assert.deepEqual(decision.toolNames, fixture.expected.decision.toolNames);
  });
}

test("first-call extractor handles Twilio speech callback phrasing for a father with first name only", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "My name is Kyle. My name is Kyle, My Father, John passed away at 1:23 Main Street. My phone is 603-731-5845.",
  );

  assert.equal(extraction.facts.caller_name, "Kyle");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "father");
  assert.equal(extraction.facts.decedent_name, "John");
  assert.equal(extraction.facts.pickup_address, "123 Main Street");
  assert.equal(extraction.facts.caller_phone, "603-731-5845");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor treats pronoun name answers as decedent names", () => {
  const extraction = extractFirstCallFactsDeterministic("His name is John.");

  assert.equal(extraction.facts.decedent_name, "John");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
});

function assertFacts(extraction: FirstCallExtraction, expectedFacts: Record<string, unknown>) {
  for (const [key, expected] of Object.entries(expectedFacts)) {
    assert.equal(extraction.facts[key as keyof typeof extraction.facts], expected, key);
  }
}
