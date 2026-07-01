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
  assert.equal(extraction.factConfidence?.caller_name, 0.86);
  assert.equal(extraction.factConfidence?.caller_phone, 0.92);
  assert.equal(extraction.factConfidence?.pickup_address, 0.8);
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor treats pronoun name answers as decedent names", () => {
  const extraction = extractFirstCallFactsDeterministic("His name is John.");

  assert.equal(extraction.facts.decedent_name, "John");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor handles capitalized patient release phrasing", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "This is Megan Walsh from North Ridge Hospital. Patient Samuel Price was pronounced and is ready for release.",
  );

  assert.equal(extraction.facts.decedent_name, "Samuel Price");
  assert.equal(extraction.facts.facility_name, "North Ridge Hospital");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor handles live hospital release phrasing", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi. This is David Carter from Sunrise Hospital. We have Helen Brooks ready for release my call. Back number is 214-639-5723.",
  );

  assert.equal(extraction.facts.caller_name, "David Carter");
  assert.equal(extraction.facts.caller_phone, "214-639-5723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.decedent_name, "Helen Brooks");
  assert.equal(extraction.facts.facility_name, "Sunrise Hospital");
  assert.equal(extraction.facts.place_of_death_type, "hospital");
  assert.equal(extraction.facts.urgency, "urgent");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor treats negated death pricing calls as routine inquiries", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi, I'm calling to ask about cremation pricing. No one has passed away right now. I'm just trying to understand your basic direct cremation cost and what is included.",
  );

  assert.equal(extraction.intent, "pricing_or_billing");
  assert.equal(extraction.facts.death_reported, false);
  assert.equal(extraction.facts.urgency, "routine");
  assert.equal(extraction.facts.decedent_name, undefined);
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
});

test("first-call extractor treats existing-family office-hours calls as routine inquiries", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Uh, hi. My name's Kyle finny. I'm calling about my father. Robert, finny funeral home is already helping our family. This is not a new death call, not an emergency. Just want to know what time the office opens up tomorrow, whether I can drop off clothing for him in the morning, my call back number is 603-731-5845.",
  );

  assert.equal(extraction.intent, "service_schedule_question");
  assert.equal(extraction.facts.caller_name, "Kyle Finny");
  assert.equal(extraction.facts.caller_phone, "603-731-5845");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "father");
  assert.equal(extraction.facts.decedent_name, "Robert Finny");
  assert.equal(extraction.facts.death_reported, false);
  assert.equal(extraction.facts.place_of_death_type, "unknown");
  assert.equal(extraction.facts.urgency, "routine");
  assert.equal(extraction.facts.dropoff_preference, "Caller asked about dropping off clothing.");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
});

test("first-call extractor treats live visitation schedule phrasing as routine", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi, my name is Kyle penny. I'm calling about my father Robert Finny, the funeral home is already helping our family. This is not a new death, call an emergency. I just wanted to confirm what time the visitation is tomorrow, whether the service is still scheduled for Friday. Morning my call back number is 603-731-5845.",
  );

  assert.equal(extraction.intent, "service_schedule_question");
  assert.equal(extraction.facts.caller_name, "Kyle Penny");
  assert.equal(extraction.facts.caller_phone, "603-731-5845");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "father");
  assert.equal(extraction.facts.decedent_name, "Robert Finny");
  assert.equal(extraction.facts.death_reported, false);
  assert.equal(extraction.facts.place_of_death_type, "unknown");
  assert.equal(extraction.facts.urgency, "routine");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
});

test("first-call extractor handles live hospice staff phrasing", () => {
  const caller = extractFirstCallFactsDeterministic(
    "This is Nurse Sarah at Green Valley. Hospice, my phone here is 214. 639 5723.",
  );

  assert.equal(caller.facts.caller_name, "Sarah");
  assert.equal(caller.facts.caller_phone, "214. 639 5723");
  assert.equal(caller.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(caller.facts.facility_contact_role, "nurse");
  assert.equal(caller.facts.facility_name, "Green Valley Hospice");
  assert.equal(caller.facts.place_of_death_type, "hospice");
  assert.equal(caller.warnings.includes("caller_name_not_found"), false);
  assert.equal(caller.warnings.includes("pickup_context_not_found"), false);

  const decedent = extractFirstCallFactsDeterministic("I'm calling about Mr. Robert Jones in room 214.");

  assert.equal(decedent.facts.decedent_name, "Robert Jones");
  assert.equal(decedent.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor handles medical examiner investigator phrasing", () => {
  const caller = extractFirstCallFactsDeterministic(
    "This is investigator, Sarah Miller with the Terra County Medical examiner's Office, my call back. Number is 214. 639 5723.",
  );

  assert.equal(caller.facts.caller_name, "Sarah Miller");
  assert.equal(caller.facts.caller_phone, "214. 639 5723");
  assert.equal(caller.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(caller.facts.facility_contact_role, "investigator");
  assert.equal(caller.facts.facility_name, "Terra County Medical Examiner's Office");
  assert.equal(caller.facts.place_of_death_type, "medical_examiner");
  assert.equal(caller.warnings.includes("caller_name_not_found"), false);
  assert.equal(caller.warnings.includes("pickup_context_not_found"), false);

  const decedent = extractFirstCallFactsDeterministic("Calling about Robert Jones case. Number 2611232,");

  assert.equal(decedent.facts.decedent_name, "Robert Jones");
  assert.equal(decedent.facts.crm_existing_case_reference, "2611232");
  assert.equal(decedent.warnings.includes("decedent_name_not_found"), false);
});

test("first-call extractor handles capitalized address is phrasing", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "My name is Amanda. My mother Patricia passed away. Address is 44 Cedar Road.",
  );

  assert.equal(extraction.facts.pickup_address, "44 Cedar Road");
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
});

function assertFacts(extraction: FirstCallExtraction, expectedFacts: Record<string, unknown>) {
  for (const [key, expected] of Object.entries(expectedFacts)) {
    assert.equal(extraction.facts[key as keyof typeof extraction.facts], expected, key);
  }
}
