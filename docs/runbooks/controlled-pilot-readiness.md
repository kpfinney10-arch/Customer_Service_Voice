# Controlled Pilot Readiness

- Review date: 2026-08-16
- Scope: LanternBell Voice only
- Target: one low-volume, actively monitored funeral-home pilot

## Current Decision

- **Go:** continued owner-operated demo calls using the production Render deployment, managed PostgreSQL, signed Twilio webhook, simulated handoffs, and the named operator console.
- **No-go:** accepting real funeral-home customer data or enabling live handoffs today.

The service is technically stable enough for continued controlled testing. The no-go is caused by a small set of explicit launch gates, not by unfinished core call orchestration.

## Evidence Review

| Area | Status | Evidence |
| --- | --- | --- |
| Production availability | Pass | `https://voice.lanternbell.com/health/calls` returned HTTP 200 with zero failures in the 1,800-second window on 2026-08-16. |
| Signed call scenarios | Pass | The deployed signed Twilio matrix passed `7/7` under run ID `render-handoff-release-1785681418`. |
| Core real-audio lanes | Pass for demo containment; real-customer pricing remains blocked | The scenario matrix records prior real-phone passes across hospice, ME, hospital, police, family residence, pricing, and existing-family lanes. Final pricing call `CAb263deda9817bf9960c6720c11cce0d8` passed against `f34e848`: the difficult `No 1 has passed away` speech result selected the pricing guard, gave the clarified simulation-only closure, and ended with no further gather or dial. |
| Dispatch safety | Pass | Family-residence calls remain CRM/human-only; official-source lanes require their minimum facts before dispatch review. Scenario and regression coverage pin both paths. |
| Handoff outcomes | Conditional | Signed acceptance and terminal outcome callbacks, persistence, redaction, caller fallback, and alert classification are automated and production-tested. Render remains intentionally set to `TWILIO_HANDOFF_MODE=simulate`. |
| Durable persistence and recovery | Pass | Managed PostgreSQL is active. A point-in-time restore to an isolated database, aggregate integrity validation, access-rule removal, and temporary-database deletion were completed on 2026-08-01. |
| Availability and failure alerting | Pass | UptimeRobot checks `/health/calls`. Incident `347421514523615151` recorded the controlled `repeated_prompt` HTTP 503 and automatic recovery over 5 minutes 5 seconds on 2026-08-16; the configured notification contact remained attached, and the owner confirmed receipt of both the down and recovery emails. |
| Named staff access | Pass | Production login, tenant-scoped activity, redacted call detail, secure cookie handling, and durable access-audit writes were verified on 2026-08-02. |
| Operator privacy boundary | Pass | The browser receives operational categories and outcomes only, with no transcript text, captured values, raw event payloads, or browser-stored API key. |
| Release identification | Pass | Production `/version` reports exact Render commit `f34e848046f4e91a71ed55c123f5674dfa0ad894` and build time `2026-08-16T23:38:23.985Z`. |
| Long-latency and repeated-prompt alerting | Pass | Persisted orchestration turns at or above 1,500 ms and three consecutive no-progress or empty-speech prompts are classified by `/health/calls` without public caller or tenant data. Automated coverage passed, and the controlled `repeated_prompt` external down/recovery drill completed. |
| Data retention and deletion | Engineering and owner activation passed; legal review blocked | The owner approved the pilot policy on 2026-08-16. Commit `b5a0525` is deployed, migration `004` completed, the three protected lifecycle variables are configured, and production purge/retention dry-runs completed without deletion. Kyle Finney is assigned as the manual daily retention owner during any real-data pilot; the successful production dry-run verified access. Appropriate legal/privacy review remains required. |
| First customer onboarding | Blocked | `fh-demo` uses environment-loaded demo configuration and simulated destinations. A real pilot requires customer-specific routing, secrets, feature flags, staff users, support contacts, and approved data settings. |
| Incident response | Pass | `pilot-incident-response.md` defines ownership, severity, safe evidence, traffic stop, rollback, database recovery, communications, verification, and closure. |

## Ordered Launch Gates

### 1. Approve and enforce the pilot data-handling policy

Status: policy approved, implementation deployed, protected variables configured, safe production dry-runs completed, and the manual daily retention owner assigned and access-verified on 2026-08-16. Appropriate legal/privacy review remains required before real customer data is accepted.

Acceptance criteria:

- [x] Inventory the stored session facts, transcript events, tool outcomes, operator access audits, request logs, idempotency records, provider records, and backups.
- [x] Record owner-approved retention periods, disabled recording, no durable transcript text, access boundaries, and deletion handling in `pilot-data-handling-policy.md`.
- [ ] Obtain appropriate legal/privacy review for the selected policy using `docs/legal/pilot-legal-privacy-review-packet.md`; this engineering checklist does not make that legal determination. The packet identifies automated telephone pricing as a confirmed pre-pilot engineering/legal gap.
- [x] Prove the intent-first opening and fail-closed pricing guard requires no contact details and runs no CRM, dispatch, gather, or dial action. Automated regressions cover the initial failures, and final real-phone call `CAb263deda9817bf9960c6720c11cce0d8` passed against deployed commit `f34e848` with no follow-up gather or dial. This verifies demo containment only; approved price data or an approved live human route is still required for a real tenant.
- [x] Implement a tenant-scoped, idempotent, audited purge process with a safe dry-run mode and tests proving it cannot delete another tenant's data.
- [x] Implement fixed retention cleanup and a Twilio call-resource deletion boundary.
- [x] Document how expired/deleted data is reconciled after a restore and how managed-backup retention differs from active-database retention.
- [x] Deploy migration `004`, configure protected lifecycle secrets, and record safe production dry-run evidence.
- [x] Assign and verify the daily retention execution owner or approve a reviewed scheduler. Kyle Finney is the primary manual owner for the owner-operated pilot; production dry-run access was verified on 2026-08-16.

### 2. Close the operational observability gaps

This is the next engineering increment that can proceed without another phone or customer account.

Status: complete. Implementation, controlled external alerting, automatic recovery, and delivery of both owner notifications were verified on 2026-08-16.

Acceptance criteria:

- [x] Populate `/version` with the actual Render commit and deployment/build timestamp, while retaining safe local defaults.
- [x] Extend persisted call health to classify excessive webhook latency and repeated-prompt/retry exhaustion using documented thresholds that avoid caller or tenant data in the public response.
- [x] Add focused unit, HTTP, PostgreSQL, privacy, and environment tests.
- [x] Create a short pilot incident runbook covering alert receipt, triage, traffic stop, rollback, database recovery, customer communication ownership, and incident closure.
- [x] Repeat the external down/recovery drill because the health contract now includes two additional failure categories, and confirm delivery of both owner notifications.

### 3. Complete the real handoff drill

External prerequisite: a second approved phone and an approved transfer destination.

Acceptance criteria:

- Keep production in simulation mode until the drill begins.
- Validate accepted screening and connection, rejected or unanswered screening, and no-answer/busy terminal behavior through real phones.
- Confirm caller-safe fallback, redacted operator detail, durable outcome events, and expected `/health/calls` behavior.
- Return to simulation immediately after the drill unless the first pilot customer and operating coverage are ready.

### 4. Configure the first pilot tenant

Acceptance criteria:

- Create a stable non-demo tenant identifier, display name, timezone, real on-call routing, and approved feature flags.
- Create tenant-specific machine secrets and named staff accounts with least-privilege roles.
- Record the customer support contact, LanternBell incident owner, pilot hours, call-volume limit, and stop-traffic procedure.
- Verify tenant isolation for call activity, call detail, access audit, configuration, API keys, and webhook routing.
- Run signed readiness without exposing secrets or caller data.

### 5. Rebaseline the release and make the go/no-go decision

Acceptance criteria:

- Typecheck, build, and run the complete automated suite on the exact candidate commit.
- Pass the signed production scenario matrix `7/7` after all launch-gate changes.
- Complete one clean and one noisy real-audio pass for each high-value pilot lane, or explicitly document why a lane is excluded from the pilot.
- Run a bounded concurrency check sized to the agreed pilot call limit; a broad scale test is not required for a single low-volume monitored pilot.
- Confirm health, alerts, operator access, audit persistence, backup/recovery status, data policy, handoff mode, and tenant configuration.
- Record an explicit **Go**, **Conditional Go**, or **No-go** decision with the owner and evidence links in `docs/SESSION_HANDOFF.md`.

## Deliberately Deferred

These are useful future improvements but are not launch blockers for one low-volume, monitored pilot:

- General-purpose customer self-service onboarding UI.
- Cross-product shared identity provider selection before the CRM and Dispatch audits.
- Advanced operator filtering, assignment, notes, and case-status workflow that would duplicate future CRM ownership.
- Broad multi-region or high-concurrency architecture.
- Enabling the OpenAI extractor when deterministic extraction remains the approved pilot configuration.

## Change Control

- No real customer data enters the system until gate 1 is complete.
- No live transfer destination is enabled until gate 3 is complete.
- No first customer is onboarded until gates 1 through 4 are complete.
- Material changes to these gates require an explicit roadmap/scope decision.
