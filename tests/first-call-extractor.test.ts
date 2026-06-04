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

function assertFacts(extraction: FirstCallExtraction, expectedFacts: Record<string, unknown>) {
  for (const [key, expected] of Object.entries(expectedFacts)) {
    assert.equal(extraction.facts[key as keyof typeof extraction.facts], expected, key);
  }
}

