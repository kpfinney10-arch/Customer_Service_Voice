import assert from "node:assert/strict";
import test from "node:test";
import { decideFirstCallNextStep, firstCallPromptForStep } from "../src/index.js";

test("first-call flow starts by collecting caller identity and callback", () => {
  const decision = decideFirstCallNextStep({ urgency: "urgent", death_reported: true });

  assert.equal(decision.step, "collect_caller");
  assert.equal(decision.nextState, "RESOLVE_REQUEST");
  assert.deepEqual(decision.toolNames, []);
  assert.match(firstCallPromptForStep(decision.step), /name/i);
});

test("first-call flow can create CRM intake before dispatch facts are complete", () => {
  const decision = decideFirstCallNextStep({
    caller_name: "Jane Caller",
    caller_phone: "555-0100",
    decedent_name: "John Smith",
    death_reported: true,
    urgency: "urgent",
  });

  assert.equal(decision.step, "collect_location");
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead"]);
});

test("first-call flow escalates family residence calls without dispatch review", () => {
  const decision = decideFirstCallNextStep({
    caller_name: "Jane Caller",
    caller_phone: "555-0100",
    caller_relationship_to_decedent: "daughter",
    decedent_name: "John Smith",
    pickup_address: "100 Main St",
    death_reported: true,
    place_of_death_type: "residence",
    urgency: "urgent",
  });

  assert.equal(decision.step, "escalate");
  assert.equal(decision.nextState, "ESCALATE");
  assert.deepEqual(decision.toolNames, ["crm.create_intake_lead"]);
  assert.equal(decision.escalationReason, "urgent_death_report");
});

test("first-call flow creates dispatch review for official residence reports", () => {
  const decision = decideFirstCallNextStep({
    caller_name: "Officer Jane Caller",
    caller_phone: "555-0100",
    caller_relationship_to_decedent: "facility_staff",
    facility_contact_role: "police_officer",
    decedent_name: "John Smith",
    pickup_address: "100 Main St",
    death_reported: true,
    place_of_death_type: "residence",
    urgency: "urgent",
  });

  assert.equal(decision.step, "escalate");
  assert.equal(decision.nextState, "ESCALATE");
  assert.deepEqual(decision.toolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);
  assert.equal(decision.escalationReason, "urgent_death_report");
});
