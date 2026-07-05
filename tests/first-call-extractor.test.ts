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

test("first-call extractor handles latest live hospital release punctuation", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi. This is David Carter from Sunrise Hospital. Uh, we have Helen Brooks ready here at our hospital. For release family. Has requested your funeral home. Our pickup address, here is 500 Medical Center, Drive in Fort Worth Texas. And my call back is 214 6395723.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.death_reported, true);
  assert.equal(extraction.facts.caller_name, "David Carter");
  assert.equal(extraction.facts.caller_phone, "214 6395723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.decedent_name, "Helen Brooks");
  assert.equal(extraction.facts.facility_name, "Sunrise Hospital");
  assert.equal(extraction.facts.pickup_address, "500 Medical Center Drive Fort Worth Texas");
  assert.equal(extraction.facts.place_of_death_type, "hospital");
  assert.equal(extraction.facts.requested_funeral_home, "Your Funeral Home");
  assert.equal(extraction.facts.urgency, "urgent");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead", "dispatch.create_removal_request"]);
});

test("first-call extractor handles dotted live hospital release decedent", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi. This is David Carter from Sunrise Hospital. We have Helen. Brooks ready for release. The family has requested. Your funeral home. Pick up. Address is 500. Medical Center. Drive in Fort Worth Texas. My call back is 214 6395723.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.death_reported, true);
  assert.equal(extraction.facts.caller_name, "David Carter");
  assert.equal(extraction.facts.caller_phone, "214 6395723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.decedent_name, "Helen Brooks");
  assert.equal(extraction.facts.facility_name, "Sunrise Hospital");
  assert.equal(extraction.facts.pickup_address, "500 Medical Center Drive Fort Worth Texas");
  assert.equal(extraction.facts.place_of_death_type, "hospital");
  assert.equal(extraction.facts.requested_funeral_home, "Your Funeral Home");
  assert.equal(extraction.facts.urgency, "urgent");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead", "dispatch.create_removal_request"]);
});

test("first-call extractor strips courtesy titles from decedent name answers", () => {
  const extraction = extractFirstCallFactsDeterministic("Her name is Miss. Helen Brooks.");

  assert.equal(extraction.facts.decedent_name, "Helen Brooks");
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

test("first-call extractor captures routine location hours and parking notes", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "My name is Kyle. Vinnie uh, no 1 has passed away and this is not an emergency. I'm just calling to ask where the funeral home is located. And what time the office opens tomorrow and where visitors should Park my call back. Number is 603-731-5845.",
  );

  assert.equal(extraction.intent, "service_schedule_question");
  assert.equal(extraction.facts.caller_name, "Kyle");
  assert.equal(extraction.facts.caller_phone, "603-731-5845");
  assert.equal(extraction.facts.death_reported, false);
  assert.equal(extraction.facts.place_of_death_type, "unknown");
  assert.equal(extraction.facts.urgency, "routine");
  assert.equal(
    extraction.facts.special_handling_notes,
    "Routine family inquiry about office hours, directions/location, and parking; caller requested office-hours follow-up.",
  );
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
});

test("first-call extractor drops filler words from routine family decedent names", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi, my name is Kyle finny. I'm calling about my father. Robert finny, uh, the funeral home is already helping our family. This is not a new death call. Not an emergency. I don't need someone tonight, but I would like the funeral director to call me tomorrow about a question. I have on the arrangements, my call back number is 637315845.",
  );

  assert.equal(extraction.intent, "family_question");
  assert.equal(extraction.facts.caller_name, "Kyle Finny");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "father");
  assert.equal(extraction.facts.decedent_name, "Robert Finny");
  assert.equal(extraction.facts.death_reported, false);
  assert.equal(extraction.facts.place_of_death_type, "unknown");
  assert.equal(extraction.facts.urgency, "routine");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
});

test("first-call extractor captures obituary and flower routine notes", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi, my name is Kyle finny, I'm calling about my father. Robert, Finny the funeral home is already helping out our family. It's not a new death call or an emergency. I just wanted to ask Um, how we submit obituary wording, uh, and whether flower delivery should go to the funeral home or the church. I can be reached at, I mean, my call back is 603-731-5845.",
  );

  assert.equal(extraction.intent, "family_question");
  assert.equal(extraction.facts.caller_name, "Kyle Finny");
  assert.equal(extraction.facts.caller_phone, "603-731-5845");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "father");
  assert.equal(extraction.facts.decedent_name, "Robert Finny");
  assert.equal(extraction.facts.death_reported, false);
  assert.equal(extraction.facts.place_of_death_type, "unknown");
  assert.equal(extraction.facts.urgency, "routine");
  assert.equal(
    extraction.facts.special_handling_notes,
    "Routine family inquiry about obituary wording and flower delivery; caller requested office-hours follow-up.",
  );
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

test("first-call extractor handles live hospice at-home transcript in one turn", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi, this is Nurse Emily Johnson with Gentle Care. Hospice. Uh I'm out here at a house with Mr. Robert Jones at the family's home. He's passed away in the family is real quick. Requested, your Funeral Home The address here is 636 Commerce, a and Keller, Texas. And my call back is 214 6395723.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.caller_name, "Emily Johnson");
  assert.equal(extraction.facts.caller_phone, "214 6395723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.facility_contact_role, "nurse");
  assert.equal(extraction.facts.facility_name, "Gentle Care Hospice");
  assert.equal(extraction.facts.decedent_name, "Robert Jones");
  assert.equal(extraction.facts.pickup_address, "636 Commerce Ave Keller Texas");
  assert.equal(extraction.facts.currently_with_decedent, true);
  assert.equal(extraction.facts.requested_funeral_home, "Your Funeral Home");
  assert.equal(extraction.facts.place_of_death_type, "hospice");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead", "dispatch.create_removal_request"]);
});

test("first-call extractor handles latest live hospice nurse punctuation", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi, yes. Um, this is Nurse. Emily Johnson with Gentle Care, Hospice. I'm at the family's home with Mr. Robert Jones who was passed away. The family has requested, your funeral home. The address here is 636 Commerce a Keller Texas. You might call back is 214 6395723.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.caller_name, "Emily Johnson");
  assert.equal(extraction.facts.caller_phone, "214 6395723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.facility_contact_role, "nurse");
  assert.equal(extraction.facts.facility_name, "Gentle Care Hospice");
  assert.equal(extraction.facts.decedent_name, "Robert Jones");
  assert.equal(extraction.facts.pickup_address, "636 Commerce Ave Keller Texas");
  assert.equal(extraction.facts.currently_with_decedent, true);
  assert.equal(extraction.facts.requested_funeral_home, "Your Funeral Home");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead", "dispatch.create_removal_request"]);
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

test("first-call extractor handles live medical examiner false friends", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Hi this is investigator Sarah Miller with the Terry County medical examiner's office. So I'm calling about Robert Jones case. Number 2611232, He is ready for release to your Funeral Home. Pick up address is 200. Felix glows place in Fort Worth Texas. My call back is 214 6395723.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.caller_name, "Sarah Miller");
  assert.equal(extraction.facts.caller_phone, "214 6395723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.facility_contact_role, "investigator");
  assert.equal(extraction.facts.facility_name, "Tarrant County Medical Examiner's Office");
  assert.equal(extraction.facts.decedent_name, "Robert Jones");
  assert.equal(extraction.facts.crm_existing_case_reference, "2611232");
  assert.equal(extraction.facts.pickup_address, "200 Feliks Gwozdz Place Fort Worth Texas");
  assert.equal(extraction.facts.place_of_death_type, "medical_examiner");
  assert.equal(extraction.facts.requested_funeral_home, "Your Funeral Home");
  assert.equal(extraction.warnings.includes("decedent_name_not_found"), false);
  assert.equal(extraction.warnings.includes("pickup_context_not_found"), false);
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead", "dispatch.create_removal_request"]);
});

test("first-call extractor handles police officer residence death reports", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "This is Officer Sarah Miller with Keller Police. We have Robert Jones deceased at 636 Commerce Ave in Keller. My number is 214-639-5723.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.caller_name, "Sarah Miller");
  assert.equal(extraction.facts.caller_phone, "214-639-5723");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(extraction.facts.facility_contact_role, "officer");
  assert.equal(extraction.facts.decedent_name, "Robert Jones");
  assert.equal(extraction.facts.pickup_address, "636 Commerce Ave");
  assert.equal(extraction.facts.place_of_death_type, "residence");
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead", "dispatch.create_removal_request"]);
});

test("first-call extractor captures family caller presence without dispatching residence calls", () => {
  const extraction = extractFirstCallFactsDeterministic(
    "Um yes hi my name is Kyle finny my call back. Number is 603-731-5845 my Father Robert Jones just passed away at home, I'm with him now. The address is 636 Commerce Avenue. Keller Texas.",
  );
  const decision = decideFirstCallNextStep(extraction.facts);

  assert.equal(extraction.intent, "first_call_intake");
  assert.equal(extraction.facts.caller_name, "Kyle Finny");
  assert.equal(extraction.facts.caller_phone, "603-731-5845");
  assert.equal(extraction.facts.caller_relationship_to_decedent, "father");
  assert.equal(extraction.facts.decedent_name, "Robert Jones");
  assert.equal(extraction.facts.currently_with_decedent, true);
  assert.equal(extraction.facts.pickup_address, "636 Commerce Avenue Keller Texas");
  assert.equal(extraction.facts.place_of_death_type, "residence");
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead"]);
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
