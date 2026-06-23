# First-Call Death Report Intake

## Purpose

This is the first MVP call flow for the voice AI platform.

The workflow handles a caller reporting that someone has died or that a removal/transport may be needed. This is a sensitive, high-risk workflow. The AI should gather only minimum necessary information, create durable intake context, and escalate to a human funeral home team member quickly.

## Product Goal

The first MVP should prove that the voice system can:

- Recognize a death-report or first-call intake.
- Respond with calm, concise, empathetic language.
- Collect key facts without over-interrogating the caller.
- Avoid medical, legal, pricing, or operational promises.
- Create a CRM intake record.
- Create a dispatch-review request only when sufficient pickup information exists.
- Escalate to a human for final handling.
- Preserve a redacted event trail for debugging and audit.

## Non-Goals

The AI must not:

- Pronounce death.
- Give medical or legal advice.
- Promise pickup ETA.
- Assign a driver or vehicle.
- Confirm pricing or insurance coverage.
- Create final case disposition.
- Decide embalming, cremation, or service arrangements.
- Continue if the caller is distressed and needs a human.

## Call State Flow

```text
GREETING
  -> IDENTIFY_INTENT
  -> RESOLVE_REQUEST
  -> ESCALATE
  -> END_CALL
```

Optional states:

- `AUTH`: only if tenant policy requires account/family verification before details.
- `VERIFY_ACCOUNT`: only if matching an existing CRM family/case.
- `WRAPUP`: only after a human handoff or if the caller is routed to a callback queue.

## Target Facts

The workflow should try to collect these facts, but it must not delay escalation just to complete every field:

- `caller_name`
- `caller_phone`
- `caller_relationship_to_decedent`
- `decedent_name`
- `death_reported`
- `place_of_death_type`
- `pickup_address`
- `pickup_contact_name`
- `pickup_contact_phone`
- `currently_with_decedent`
- `requested_funeral_home`
- `preferred_callback_number`
- `urgency`

## Additional Useful Facts

- `date_of_death`
- `time_of_death`
- `facility_name`
- `facility_contact_role`
- `dropoff_preference`
- `special_handling_notes`
- `religious_or_cultural_notes`
- `caller_emotional_state`
- `crm_existing_case_reference`

## Minimum Tool Conditions

### CRM Intake

The system may request `crm.create_intake_lead` when it has:

- reason for call
- urgency

Useful but not strictly required:

- caller name
- caller phone
- relationship to decedent
- decedent name

### Dispatch Review Request

The system may request `dispatch.create_removal_request` only when it has:

- pickup address or facility name with enough routing context

Useful but not strictly required:

- decedent name
- pickup contact
- pickup contact phone
- dropoff preference

The dispatch tool creates a review request, not a final driver assignment.

## Escalation Rules

Always escalate when:

- Caller reports a death or removal need.
- Caller is angry, panicked, severely distressed, or confused.
- Caller asks medical or legal questions.
- Caller asks for emergency advice.
- Caller requests pricing commitments in a death-report context.
- Caller cannot provide enough information after retry budget.
- CRM or dispatch tool fails.
- Tenant policy requires human handling.

## Caller Tone

Voice should be:

- Calm
- Brief
- Empathetic
- Non-clinical
- Non-promising
- Action-oriented

Example:

```text
I am assisting the funeral director with gathering call information. I need just a few details, and then I will connect you with our team.
```

## Scenario Coverage

Initial test scenarios:

- Family member reports death at home.
- Hospice nurse reports death at residence.
- Hospital calls for release/removal.
- Caller has no pickup address yet.
- Caller is distressed.
- Caller asks for pricing during death report.
- Caller asks legal or medical question.
- Caller provides enough data for CRM but not dispatch.
- CRM tool failure.
- Dispatch tool failure.

## Fact Extraction Contract

The first implementation uses a deterministic no-LLM extractor at:

```text
src/verticals/funeral-home/first-call-extractor.ts
```

The extractor returns:

- `intent`
- `facts`
- `sentiment`
- `confidence`
- `warnings`

This is the contract a future LLM structured-output adapter must satisfy. The deterministic extractor is intentionally conservative and exists to make workflow behavior testable before provider integration.

The deterministic extractor is not intended to understand every natural-language variation. It is a baseline fixture runner and contract validator. Production extraction should use a structured-output model adapter that is tested against the same fixtures and should never bypass the flow, rules, or tool contracts.

Fixtures live in:

```text
tests/fixtures/first-call/
```

## Audit And Observability

Every call should emit:

- `CALL_STARTED`
- `TRANSCRIPT_RECEIVED`
- `INTENT_DETECTED`
- `RULE_EVALUATED`
- `TOOL_REQUESTED` when applicable
- `TOOL_EXECUTED` or `TOOL_FAILED` when applicable
- `ESCALATION_TRIGGERED`
- `CALL_ENDED`

Sensitive details should be redacted from logs and only stored in approved durable systems.
