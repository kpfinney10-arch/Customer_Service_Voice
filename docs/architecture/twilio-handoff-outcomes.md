# Twilio Handoff Outcomes

## Purpose

Live human transfers must have a deterministic, auditable outcome. A phone that rings, reaches voicemail, receives no acceptance digit, or returns a provider failure must not be treated as a successful staff handoff.

The Render demo remains in `TWILIO_HANDOFF_MODE=simulate`; this contract applies when a tenant is deliberately moved to live handoffs.

## Live Handoff Flow

1. The orchestrator escalates the call and selects a tenant-configured destination.
2. Twilio dials the destination with `answerOnBridge="true"` and a signed screening callback.
3. The called party hears a staff summary and must press `1` to accept.
4. The screening decision is recorded against the parent call session.
5. Twilio posts the final `<Dial>` result to a signed handoff-result callback.
6. The service treats `completed` as connected only when the screening-accepted event exists.
7. The final outcome is persisted and returned in replay and the redacted operator timeline.
8. A failed transfer gives the caller a safe message confirming urgent follow-up was recorded, then ends the call.

## Recorded Outcomes

Screening phase:

- `accepted`
- `rejected`
- `no_input`

Final dial phase:

- `connected`
- `screening_not_accepted`
- `busy`
- `no_answer`
- `failed`
- `canceled`

Each event uses `HANDOFF_OUTCOME_RECORDED` with only provider, phase, allowlisted outcome, success, and terminal flags. It does not contain caller details, phone numbers, transcripts, handoff summaries, or captured intake values.

Repeated provider delivery with the same correlation, phase, and outcome reuses the existing event rather than creating duplicate audit or alert records.

## Monitoring Behavior

The public aggregate call-health probe reports a `handoff_failure` for terminal outcomes that are not successful, except `canceled`. Caller cancellation remains visible in the call timeline but does not page the operator as a platform failure.

These outcomes trigger failed-call health:

- `screening_not_accepted`
- `busy`
- `no_answer`
- `failed`

## Security Requirements

- Screening, acceptance, and final-result callbacks require valid Twilio signatures whenever the provider secret is configured.
- The tenant and parent call session are resolved by server-controlled callback paths and Twilio fields.
- The LLM cannot select a destination, approve acceptance, classify provider status, or write handoff outcomes.
- Unsupported or malformed Twilio statuses fail closed.

## Validation Before Enabling Live Mode

- Configure a real tenant-approved on-call and fallback policy.
- Confirm signed readiness against the permanent hostname.
- Test accepted, rejected/no-input, busy/no-answer, provider-failed, and caller-canceled outcomes.
- Confirm the redacted operator timeline and aggregate health behavior for each result.
- Keep demo deployments in simulated mode until this drill is explicitly approved.
