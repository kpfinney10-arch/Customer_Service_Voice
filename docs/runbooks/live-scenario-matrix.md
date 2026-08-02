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
- Run ID: `render-pilot-readiness-1785680625`.
- Post-run `/health/calls` remained HTTP 200 with zero failures in the active 1,800-second window.

## Scenario Coverage

| Lane | Automated Smoke | Real Phone Audio | Expected Outcome |
| --- | --- | --- | --- |
| Hospice nurse at residence, named funeral home | Covered by `hospice-noisy-named` | Passed in prior live tests | Escalate, create CRM, create dispatch review |
| Medical examiner release, missing case number | Covered by `me-missing-case` | Passed in guided and stream-of-thought live tests after `040bdaa` | Ask case number before location/handoff, then create CRM and dispatch |
| Hospital release with dotted punctuation | Covered by `hospital-dotted-release` | Passed in latest 2026-07-08 live test; cleanup pinned | Escalate, create CRM, create dispatch review |
| Police residence death report | Covered by `police-residence` | Passed in latest 2026-07-08 live test; cleanup pinned | Escalate, create CRM, create dispatch review, no authority warning |
| Family at-home death report | Covered by `family-residence-authority-check` | Passed in prior live tests | Escalate, create CRM only, include authority-verification warning |
| Pricing inquiry, no death reported | Covered by `pricing-routine` | Passed in latest 2026-07-08 live test | Wrap up for office-hours follow-up, create CRM only |
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
- No known issue that loses caller phone, decedent name, pickup location, or ME case number after the caller provides it clearly.
- Human handoff failure behavior documented and tested.

The automated human-handoff outcome contract is documented in `docs/architecture/twilio-handoff-outcomes.md`. A real-number acceptance/failure drill remains required before changing a tenant from simulated to live handoffs.

## Production Exit Criteria

Before unattended production traffic, add:

- Durable database persistence.
- Stable HTTPS deployment endpoint or named Cloudflare tunnel.
- Secret management outside local env files.
- Monitoring and alerting for failed webhooks, failed handoffs, provider errors, long latency, and repeated prompts.
- Tenant-specific configuration loaded from onboarding data.
- Privacy and retention policy for call transcripts, replay data, and handoff summaries.
