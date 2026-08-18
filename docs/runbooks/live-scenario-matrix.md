# Live Scenario Matrix

This matrix tracks whether the funeral-home voice workflow is ready for a monitored pilot and, later, production traffic.

The goal is not to make the AI collect every possible field. The goal is to prove that each high-value call lane routes safely, creates the right downstream work, avoids unsafe dispatch, and gives staff enough context to take over.

## Automated Scenario Smoke

Run from the project root while the local Twilio server is running:

```sh
npm run smoke:twilio-scenarios
```

To run the same matrix through a public tunnel:

```sh
API_BASE_URL=https://<current-cloudflare-subdomain>.trycloudflare.com npm run smoke:twilio-scenarios
```

The script validates:

- Twilio readiness.
- Initial TwiML gather.
- Prompt sequencing.
- Final call state.
- Key extracted facts.
- CRM and dispatch tool completion.
- Safety warnings for family residence calls.
- Routine-call wrapup without dispatch.

Latest permanent-host validation:

- On 2026-08-02, the signed matrix passed `7/7` against `https://voice.lanternbell.com` using Render, managed PostgreSQL, the permanent Twilio webhook, and simulated handoffs.
- The post-deployment release run used ID `render-handoff-release-1785681418` on commit `8bb8246`.
- A signed synthetic acceptance plus connected-result callback persisted the expected screening and dial outcomes without placing a real call.
- Post-run `/health/calls` remained HTTP 200 with zero failures in the active 1,800-second window.
- The pricing guard was hardened through commits `764047b` and `d3ad851` for the live `No, 1` and `know, 1` recognition variants. Demo-closure wording was clarified in deployed commit `f34e848`.
- Final real-phone pricing call `CAb263deda9817bf9960c6720c11cce0d8` passed on 2026-08-16 against `f34e848`: Twilio returned the difficult `No 1 has passed away` variant, the application gave the demo-only pricing closure, and the final TwiML contained a hangup with no gather or dial. The owner accepted the revised caller wording.
- Production `/version` reported commit `f34e848046f4e91a71ed55c123f5674dfa0ad894` and build time `2026-08-16T23:38:23.985Z`. On 2026-08-18, the full signed production matrix passed `7/7` against that exact release under run ID `render-pricing-rebaseline-1787066802`, using reserved test numbers and simulated handoffs. Post-run call health remained HTTP 200 with zero failures.

## Scenario Coverage

| Lane | Automated Smoke | Real Phone Audio | Expected Outcome |
| --- | --- | --- | --- |
| Hospice nurse at residence, named funeral home | Covered by `hospice-noisy-named` | Passed in prior live tests | Escalate, create CRM, create dispatch review |
| Medical examiner release, missing case number | Covered by `me-missing-case` | Passed in guided and stream-of-thought live tests after `040bdaa` | Ask case number before location/handoff, then create CRM and dispatch |
| Hospital release with dotted punctuation | Covered by `hospital-dotted-release` | Passed in latest 2026-07-08 live test; cleanup pinned | Escalate, create CRM, create dispatch review |
| Police residence death report | Covered by `police-residence` | Passed in latest 2026-07-08 live test; cleanup pinned | Escalate, create CRM, create dispatch review, no authority warning |
| Family at-home death report | Covered by `family-residence-authority-check` | Passed in prior live tests | Escalate, create CRM only, include authority-verification warning |
| Pricing inquiry, no death reported | Covered by `pricing-routine` using the exact final live speech result; punctuation and `know one/know 1` regressions are also pinned | Passed on 2026-08-16 against `f34e848` in final call `CAb263deda9817bf9960c6720c11cce0d8` | In simulation, explain that pricing and a staff transfer are unavailable, state that contact details are not required, and hang up with no CRM, dispatch, gather, or dial |
| Existing-family office-hours question | Covered by `family-office-hours` | Passed in latest 2026-07-08 live test; routine request cleanup pinned | Wrap up for office-hours follow-up, create CRM only |

## Manual Live-Test Targets

For each major lane, keep at least two phone-audio passes:

- A clean pass where the caller follows the expected script.
- A noisy pass with filler, correction, punctuation breaks, weak signal, or out-of-order facts.

Track these for each live call:

- Call SID.
- Public tunnel or deployment URL.
- Server commit.
- Caller script used.
- Whether the agent repeated a prompt unexpectedly.
- Whether the handoff dialed the correct on-call number.
- Final replay state.
- Completed tools.
- Missing facts.
- Any STT phrases worth turning into regression tests.

## Pilot Exit Criteria

Before a monitored pilot, the matrix should show:

- All automated smoke scenarios passing against the deployed endpoint.
- Twilio public readiness passing with signed webhooks.
- At least one clean and one noisy real-audio pass for each high-value lane.
- No known issue that causes dispatch creation without an authorized source.
- Pricing remains fail-closed unless approved price data or an approved immediate human route is configured and tested.
- No known issue that loses caller phone, decedent name, pickup location, or ME case number after the caller provides it clearly.
- Human handoff failure behavior documented and tested.

The automated human-handoff outcome contract is documented in `docs/architecture/twilio-handoff-outcomes.md`. A real-number acceptance/failure drill remains required before changing a tenant from simulated to live handoffs.

## Production Exit Criteria

Current status is tracked in [Controlled Pilot Readiness](controlled-pilot-readiness.md). Before unattended production traffic, require:

- Durable database persistence, stable HTTPS, secret management, and tested recovery. These are complete for the current Render deployment.
- Monitoring and alerting for failed webhooks, failed handoffs, provider errors, long latency, and repeated prompts.
- Tenant-specific configuration loaded from onboarding data.
- Privacy and retention policy for call transcripts, replay data, and handoff summaries.
- A real-number handoff drill before changing from simulated to live transfers.
- A recorded go/no-go decision for the exact candidate release and first pilot tenant.
