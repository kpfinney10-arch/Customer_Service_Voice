# Voice Pilot Incident Response

Scope: LanternBell Voice controlled pilot
Default incident owner: LanternBell owner until explicitly delegated
Production service: `lanternbell-voice` on Render
Public health: `https://voice.lanternbell.com/health/calls`

## Purpose

Use this runbook when an availability alert, persisted call-health alert, operator report, provider error, privacy concern, or suspicious access event indicates that the Voice pilot may not be operating safely.

The first priority is caller and customer safety. Preserve evidence without copying caller data into chat, email, tickets, or screenshots.

## Alert Sources

- UptimeRobot down or recovery email for `/health/calls`.
- Render deployment, service-health, or runtime-failure notification.
- Operator console showing failed tools, abnormal call end, handoff failure, repeated prompts, or an unexpected state.
- Twilio delivery or signature errors.
- Operator access-audit anomaly.
- A customer or caller reporting incorrect routing, missing information, unsafe dispatch, or exposed sensitive data.

The aggregate call-health categories are:

- `tool_failure`
- `provider_command_failure`
- `handoff_failure`
- `abnormal_call_end`
- `long_turn_latency`
- `repeated_prompt`

The public endpoint contains counts, categories, the alert window, and the latest failure time only. Use authenticated operator detail or engineering diagnostics for investigation.

## Severity

### Severity 1 — stop traffic

Examples:

- Suspected cross-tenant or public disclosure of caller data.
- Unauthorized dispatch or a repeatable unsafe routing decision.
- Compromised Twilio, Render, database, tenant API, or operator credential.
- Database corruption or incorrect customer configuration affecting live calls.
- The service is repeatedly failing callers with no safe fallback.

Action: begin containment immediately and stop affected tenant traffic.

### Severity 2 — urgent degradation

Examples:

- Failed handoff, provider command, tool execution, or abnormal call end.
- Repeated-prompt or long-turn alert affecting more than one call.
- Operator console unavailable while calls continue.
- A deployment regression with a known-good rollback available.

Action: investigate immediately during pilot coverage; stop traffic if caller safety or data integrity is uncertain.

### Severity 3 — monitored issue

Examples:

- One isolated latency or repeated-prompt event with a successful final outcome.
- Operator display polish that does not affect routing or stored facts.
- A noncritical workflow variance with a safe human handoff.

Action: record evidence, monitor recurrence, and create a regression test before the next release when appropriate.

## Response Procedure

### 1. Acknowledge and capture safe evidence

Record:

- Alert received time and source.
- Severity and incident owner.
- Production `/version` response.
- Aggregate `/health/calls` response.
- Render deployment ID and status.
- Shortened call/session reference from the operator console, if relevant.
- Whether calls remain enabled and whether handoffs are simulated or live.

Do not record transcripts, caller names, phone numbers, addresses, decedent details, secrets, cookies, or raw event payloads in the incident summary.

### 2. Decide whether to stop traffic

Stop traffic for Severity 1 or whenever safe behavior is uncertain.

Current controlled-pilot stop procedure:

1. In Render, update the affected tenant entry in `TENANT_CONFIGS_JSON` so `features.voiceIntake` is `false`.
2. Save, rebuild, and deploy the environment change.
3. Confirm the tenant readiness endpoint reports blocked and a signed test call cannot create a session.
4. If Render cannot be reached, change the Twilio number's inbound voice handler away from the LanternBell webhook using the pre-approved customer/provider fallback procedure.
5. Notify the pilot customer that automated intake is temporarily unavailable and identify the approved manual call path.

This stops new intake processing. It is not a caller-friendly maintenance message; a dedicated provider fallback should be agreed during first-tenant onboarding.

### 3. Triage without exposing sensitive data

1. Check `/health`, `/health/calls`, and `/version`.
2. Check the most recent Render deploy and application logs by request ID, event type, tenant ID, shortened session reference, status, and duration only.
3. Use the named operator console for the redacted call timeline.
4. Use API-key engineering diagnostics only when the operator view is insufficient.
5. Confirm Twilio signature failures, webhook delivery status, and handoff result without copying request bodies.
6. For database concerns, use aggregate recovery validation; do not query or export caller rows into an incident document.

### 4. Recover

Choose the smallest safe recovery:

- Configuration problem: correct the tenant configuration or rotate the affected secret, then redeploy.
- Code regression: deploy the last known-good commit through Render and verify its exact commit through `/version`.
- Provider problem: keep intake stopped or simulated until Twilio delivery is stable.
- Database problem: keep traffic stopped, restore to an isolated database, run `npm run validate:postgres-recovery`, and cut over only after an explicit integrity review.
- Operator credential concern: disable or replace the account in `OPERATOR_USERS_JSON`, redeploy, and confirm existing sessions can no longer authorize.

Never restore production over the active database as the first diagnostic step.

### 5. Verify before reopening

Require all applicable checks:

- `/health` and `/health/calls` return HTTP 200.
- `/version` reports the intended commit and build timestamp.
- Typecheck, build, and full automated tests pass on that commit.
- Signed Twilio readiness and the relevant focused scenario pass.
- Redacted operator activity and detail load successfully.
- The failure is represented by a regression test or documented non-code cause.
- Tenant configuration, handoff mode, monitoring, and support coverage are correct.

Re-enable `voiceIntake` only after the incident owner records the decision.

### 6. Communicate and close

The incident owner records:

- Start, containment, recovery, and closure times.
- Customer impact stated without caller details.
- Root cause and contributing conditions.
- Release/configuration used for recovery.
- Evidence that health and the focused scenario passed.
- Required follow-up owner and due date.

For any suspected privacy, legal, or contractual incident, obtain appropriate counsel and customer-notification guidance; this engineering runbook does not determine notification obligations.

## Controlled Drills

- Availability: UptimeRobot down/recovery drill completed 2026-08-01.
- Database: isolated point-in-time restore and aggregate validation completed 2026-08-01.
- Access: named login, authorization, redacted detail, and access-audit persistence completed 2026-08-02.
- Call-quality health: repeat the external alert drill after `long_turn_latency` and `repeated_prompt` are deployed.
- Traffic stop: rehearse with the first non-demo tenant configuration before accepting customer data.
