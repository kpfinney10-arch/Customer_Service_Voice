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

## Scenario Coverage

| Lane | Automated Smoke | Real Phone Audio | Expected Outcome |
| --- | --- | --- | --- |
| Hospice nurse at residence, named funeral home | Covered by `hospice-noisy-named` | Passed in prior live tests | Escalate, create CRM, create dispatch review |
| Medical examiner release, missing case number | Covered by `me-missing-case` | Needs one more real-audio confirmation after `f25c7fd` | Ask case number before location/handoff, then create CRM and dispatch |
| Hospital release with dotted punctuation | Covered by `hospital-dotted-release` | Passed in prior live tests | Escalate, create CRM, create dispatch review |
| Police residence death report | Covered by `police-residence` | Passed in prior live tests | Escalate, create CRM, create dispatch review, no authority warning |
| Family at-home death report | Covered by `family-residence-authority-check` | Passed in prior live tests | Escalate, create CRM only, include authority-verification warning |
| Pricing inquiry, no death reported | Covered by `pricing-routine` | Passed in prior live tests | Wrap up for office-hours follow-up, create CRM only |
| Existing-family office-hours question | Covered by `family-office-hours` | Passed in prior live tests | Wrap up for office-hours follow-up, create CRM only |

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

## Production Exit Criteria

Before unattended production traffic, add:

- Durable database persistence.
- Stable HTTPS deployment endpoint or named Cloudflare tunnel.
- Secret management outside local env files.
- Monitoring and alerting for failed webhooks, failed handoffs, provider errors, long latency, and repeated prompts.
- Tenant-specific configuration loaded from onboarding data.
- Privacy and retention policy for call transcripts, replay data, and handoff summaries.
