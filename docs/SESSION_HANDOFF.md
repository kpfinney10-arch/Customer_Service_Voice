# Session Handoff

Last updated: 2026-08-16

## Project

- Project path: `/Users/kylefinney/Documents/Codex/Customer_service_project/voice-ai-platform`
- GitHub remote: `https://github.com/kpfinney10-arch/Customer_Service_Voice.git`
- Current MVP focus: funeral home AI voice customer service platform.
- First MVP call flow: first-call death report intake.
- Current telephony providers under test: Telnyx Voice API / Call Control and Twilio Programmable Voice.

## Current Build State

The backend scaffold is a TypeScript Node service with no runtime dependencies beyond Node built-ins. It includes:

- Tenant configuration and readiness checks.
- Funeral-home first-call intake state machine and extraction flow.
- Event/session persistence with file-backed local stores.
- Redaction, idempotency, rate limiting, tenant API key checks, and webhook signature scaffolding.
- Telnyx inbound webhook adapter.
- Telnyx Call Control client with dry-run and live execution modes.
- Twilio inbound webhook adapter with TwiML responses for `<Say>`, speech `<Gather>`, warm `<Dial>` handoff screening, and `<Hangup>`.
- Optional OpenAI-backed first-call extraction fallback using strict structured output.
- LLM fallback sanitization for controlled facts such as caller relationship, place of death type, and urgency.
- Diagnostic activity and replay endpoints.

Recent known-good test count: `305/305` passing.

### Production data-lifecycle activation (2026-08-16)

- Production commit: `b5a05258027749bc02b838a83e1ad4cd8fc5f6b8` (`Add pilot data lifecycle controls`).
- Render lifecycle deployment: `dep-da13ip7lk1mc7394luhg`.
- `/version` build time after protected-environment activation: `2026-08-16T22:27:56.830Z`.
- PostgreSQL migration `004` completed successfully during pre-deploy.
- Render contains protected `DATA_PURGE_AUDIT_SECRET`, `TWILIO_ACCOUNT_SID`, and `TWILIO_AUTH_TOKEN` variables; values were not recorded in source control or documentation.
- Production tenant-purge dry-run for `fh-demo` reported 45 call sessions, 521 call events, 2 Twilio call references, 1 operator session, 6 operator access audits, and 1 operator user. Nothing was deleted.
- Production retention dry-run reported zero records beyond their retention cutoffs. Nothing was deleted.
- Post-deploy `/health` and `/health/calls` both returned healthy, with zero call-health failures in the 1,800-second window.
- Kyle Finney is assigned as the manual daily retention owner during any real-data pilot. The successful production dry-run verifies Render shell access; missed-day handling is to stop real-data traffic until retention is current.
- Gate 1 remains closed to real customer data only until appropriate legal/privacy review is complete.

Latest parser hardening commit from this session:

- `2ac01a7` - hardened creative funeral-call parsing for realistic Twilio STT variants.
- Added support for `St. Clair` style caller names, relationship-led decedent phrases such as `my grandmother Cordelia van Burren passed away`, pronoun answers such as `Her name is. Evangelene De La Cruz`, apartment suffixes such as `Apartment 4 B`, and family funeral-home preference phrases such as `our family would like Smith Family Funeral Home to help us`.
- Confirmed safety behavior remains intact: family residence death reports create CRM/human escalation only; official hospice/police/medical-examiner style reports can create dispatch when minimum facts are present.

Most recent local prompt fix:

- The first Twilio/Telnyx intake response now asks the first question immediately:
  `I am assisting the funeral director with gathering call information. May I have your name and the best phone number in case we are disconnected?`
- This fixes the prior behavior where the voice agent apologized and said it would get the call to the right person, then waited without asking a question.
- Local precheck confirmed the corrected TwiML response on `2026-06-19`.

## Progress Snapshot

Status as of 2026-07-07:

- Overall MVP progress: roughly 82% complete for a local/dev funeral-home first-call voice intake pilot.
- Production readiness progress: roughly 55-60%; remaining lift is mostly reliability hardening, observability, durable infrastructure, compliance review, tenant onboarding/admin UI, and broader live-call validation.
- Backend platform scaffold: complete for MVP local testing.
- First-call death report workflow: complete for current MVP scope, with deterministic extraction plus optional OpenAI fallback.
- Tenant routing/readiness: complete for demo tenant and ready for per-funeral-home configuration expansion.
- Twilio live inbound path: working in local tunnel testing through a public Cloudflare tunnel; warm handoff screening is implemented in TwiML and covered by tests.
- Telnyx live inbound path: backend adapter and API client are built, but inbound PSTN traffic is blocked by Telnyx `D61` / SIP `486` before webhook delivery.
- OpenAI extraction validation: live smoke passed with `13/13` expected facts matched.
- Security/compliance basics: tenant API keys, redaction, idempotency, rate limits, webhook signature verification, and no-secret logging are in place for MVP.
- Persistence: file-backed local persistence is working; durable database persistence is still a production-hardening item.
- Funeral-home onboarding materials: separate local workspace contains routing spec, First Call schema, profile schema, onboarding questionnaire, fillable PDF generator, and seed/eval datasets.

Current maintained project size:

- Voice platform repo: 109 maintained files and 12,359 lines, excluding `.git`, `node_modules`, `dist`, and local `.voice-ai-data*`.
- Funeral-home module materials workspace: 8 maintained source/document files and 1,255 lines, excluding generated PDF and `.git`.
- Combined maintained source/docs/data total across both workspaces: 117 files and 13,614 lines.

## Important Local Runtime Commands

Run from:

```sh
cd /Users/kylefinney/Documents/Codex/Customer_service_project/voice-ai-platform
```

Build/test:

```sh
npm test
```

Start local server in live Telnyx mode after copying a valid Telnyx REST API key to the macOS clipboard:

```sh
TELNYX_API_KEY="$(pbpaste | tr -d '\r\n')"; if [ -z "$TELNYX_API_KEY" ]; then echo 'Clipboard did not contain an API key.'; exit 1; fi; lsof -ti tcp:3000 | xargs -r kill; env TENANT_API_KEYS=fh-demo:replace-with-local-dev-key STORAGE_DRIVER=file STORAGE_DATA_DIR=.voice-ai-data-telnyx-test TELEPHONY_WEBHOOK_SECRETS= TELNYX_EXECUTE_COMMANDS=true TELNYX_API_KEY="$TELNYX_API_KEY" RATE_LIMIT_PER_WINDOW=120 RATE_LIMIT_WINDOW_MS=60000 SERVICE_VERSION=local-telnyx-live-test SERVICE_COMMIT=local SERVICE_BUILD_TIME=local npm start
```

Start temporary public tunnel:

```sh
npx -y cloudflared tunnel --url http://127.0.0.1:3000
```

Update the Telnyx Voice API application webhook URL to:

```text
https://<current-cloudflare-subdomain>.trycloudflare.com/v1/tenants/fh-demo/telephony/telnyx/webhook
```

Health/readiness checks:

```sh
curl -s http://127.0.0.1:3000/health
curl -s -H 'x-api-key: replace-with-local-dev-key' 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/telnyx/readiness'
curl -s -H 'x-api-key: replace-with-local-dev-key' 'http://127.0.0.1:3000/v1/tenants/fh-demo/diagnostics/activity?limit=20'
```

## Telnyx Details

- Telnyx number: `+1 817 765 1780`
- Voice API application name: `Funeral Home voice-AI dev`
- Voice API application / connection ID: `2978840550146311580`
- Phone number backend ID seen via Telnyx API: `2978823641573098972`
- Test caller number observed in CDRs: `+1 603 731 5845`

Do not paste Telnyx API keys into chat or commit them. Use the macOS clipboard or a local `.env` file that remains untracked.

Correct Telnyx credential for this app is the account REST API key used as:

```text
Authorization: Bearer <TELNYX_API_KEY>
```

Do not confuse it with:

- Public key.
- Private encrypted key display.
- Webhook signing secret.
- Voice API application ID.
- Connection ID.
- SIP credentials.

## Verified Telnyx Backend State

Using the correct REST API key, Telnyx API returned the phone number as:

```json
{
  "phone_number": "+18177651780",
  "status": "active",
  "connection_id": "2978840550146311580",
  "connection_name": "Funeral Home voice-AI dev",
  "number_level_routing": "disabled",
  "hd_voice_enabled": true,
  "call_forwarding_enabled": false,
  "phone_number_type": "local"
}
```

Telnyx Call Control application API returned:

```json
{
  "id": "2978840550146311580",
  "application_name": "Funeral Home voice-AI dev",
  "active": true,
  "webhook_event_url": "https://echo-selecting-milan-complications.trycloudflare.com/v1/tenants/fh-demo/telephony/telnyx/webhook",
  "webhook_api_version": "2",
  "dtmf_type": "RFC 2833",
  "first_command_timeout": false,
  "inbound": {
    "channel_limit": null,
    "sip_subdomain": null,
    "sip_subdomain_receive_settings": "from_anyone",
    "shaken_stir_enabled": false,
    "codecs": ["G722", "G711A", "G711U", "VP8", "H.264"]
  }
}
```

The Cloudflare URL above is temporary and may be stale in a later session. Generate a fresh tunnel and update Telnyx before another live test.

## Twilio Live Test State

Twilio is currently the confirmed working telephony path for live inbound calls.

- Twilio number under test: `+1 855 257 1060`
- Current temporary Cloudflare tunnel URL in the latest test session: `https://vessel-enrollment-garcia-floors.trycloudflare.com`
- Latest code hardening commit: `2ac01a7`
- Current local server should be restarted after this commit before the next live test.
- Twilio webhook URL configured during the successful test:

```text
https://vessel-enrollment-garcia-floors.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook
```

The Cloudflare URL is temporary. If the tunnel is restarted, update the Twilio number's Voice Configuration with the new URL.

Important Twilio URL note from the latest live attempt:

- If Twilio is set to only the tunnel root, it will `POST /` and the app returns `404`.
- The Voice webhook field must include the full path:
  `https://<current-cloudflare-subdomain>.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`
- Method must be `HTTP POST`.

Known-good local Twilio test server command:

```sh
env TENANT_API_KEYS=fh-demo:replace-with-local-dev-key STORAGE_DRIVER=file STORAGE_DATA_DIR=.voice-ai-data-twilio-test TELEPHONY_WEBHOOK_SECRETS= RATE_LIMIT_PER_WINDOW=120 RATE_LIMIT_WINDOW_MS=60000 SERVICE_VERSION=local-twilio-test SERVICE_COMMIT=local SERVICE_BUILD_TIME=local npm start
```

Twilio console settings that worked:

- Phone number: `(855) 257-1060`
- Voice Configuration / Configure with: `Webhook, TwiML Bin, Function, Studio Flow, Proxy Service`
- A call comes in: `Webhook`
- Method: `HTTP POST`
- URL: current Cloudflare tunnel URL plus `/v1/tenants/fh-demo/telephony/twilio/webhook`
- Caller Name Lookup: disabled

Twilio trial-account note:

- First inbound calls may play Twilio's trial prompt before the app runs.
- The caller must press a key to continue past the trial prompt.
- After pressing `1`, Twilio routed successfully to the local webhook.

Most recent successful live call:

- Twilio Call SID / session ID: `CAb9be841965a71594b5601f814d1ea893`
- Final state: `ESCALATE`
- Escalated: `true`
- Completed tools: `crm.create_intake_lead`, `dispatch.create_removal_request`
- Failed tools: none observed

Captured facts from the successful call:

```json
{
  "death_reported": true,
  "caller_name": "Kyle",
  "caller_relationship_to_decedent": "father",
  "decedent_name": "John",
  "place_of_death_type": "residence",
  "urgency": "unknown",
  "pickup_contact_name": "Kyle",
  "reasonForCall": "first_call_death_report",
  "caller_phone": "6037315845",
  "preferred_callback_number": "6037315845",
  "pickup_contact_phone": "6037315845",
  "pickup_address": "123 Main Street"
}
```

Handoff from the successful call:

- Type: `human_escalation`
- Priority: `urgent`
- Reason: `urgent_death_report`
- Missing facts at escalation: `currently_with_decedent`, `requested_funeral_home`
- Recommended action: connect caller to on-call funeral home team member and confirm missing details before dispatch finalization.

Latest creative live-call validation from 2026-07-07:

- Hospice call session: `CA050bdaeadb67402d34ad4f5295fb5fec`
  - Outcome before hardening: correctly escalated with CRM + dispatch, but lost part of apartment/city from `7421 Blue Bonnet Crossing Parkway Apartment 4 B. And Waxahachie Texas`.
  - Hardening added: preserves `Apartment 4B`, `Waxahachie Texas`, and normalizes `Bluebonnet`; accepts `Her name is. Evangelene De La Cruz` as `Evangeline De La Cruz`.
- Family-at-home stream-of-thought session: `CA049954590c6f93b5e6c936f3481dba47`
  - Outcome before hardening: correctly avoided dispatch and recommended authority verification, but captured `Mateo St`, `Cordelia Van Burren`, `Chisum Trail`, and `Family Would Like Smith Family Funeral Home`.
  - Hardening added: normalizes `Mateo St. Claire` to `Mateo St Clair`, `Cordelia van Burren` to `Cordelia Van Buren`, `Chisum Trail` to `Chisholm Trail`, and requested funeral home to `Smith Family Funeral Home`.
- Regression coverage:
  - `tests/first-call-extractor.test.ts` covers the creative family stream and dotted pronoun decedent answer.
  - `tests/http-server.test.ts` covers the hospice multi-turn slot flow and family-at-home one-turn stream flow.
  - Full suite passed after the patch: `243/243`.

## Current Telnyx Blocker

Inbound calls to `+1 817 765 1780` are currently failing before the webhook fires.

Observed caller experience:

- Three beeps, then hang-up.
- At one point, after reassigning the number, caller heard "call cannot be completed as dialed"; later tests returned to three beeps.

Observed CDR pattern for failed calls:

- Direction: inbound.
- Hangup code: `17`.
- Hangup cause: `USER_BUSY`.
- Hangup details: `send_refuse`.
- SIP response code: `486`.
- Telnyx error code: `D61`.
- Connection ID: blank.
- Connection name: blank.
- Call Control ID: blank.

Only one older successful webhook-era row showed:

- Connection name: `Funeral Home voice-AI dev`.
- Connection ID: `2978840550146311580`.
- Call Control ID present.

This strongly suggests a Telnyx provisioning/routing inconsistency: the Telnyx backend API says the number is assigned to the Voice API app, but new PSTN inbound CDR rows are still refused before the app/webhook is engaged.

## Twilio Connector State

Twilio was added as a second telephony provider while waiting for Telnyx support.

Files added/updated:

- `src/providers/telephony/twilio-adapter.ts`
- `src/api/http-server.ts`
- `src/api/first-call-service.ts`
- `src/verticals/funeral-home/first-call-extractor.ts`
- `src/verticals/funeral-home/first-call-tools.ts`
- `tests/twilio-adapter.test.ts`
- `tests/http-server.test.ts`
- `tests/first-call-extractor.test.ts`
- `tests/first-call-tools.test.ts`
- `docs/runbooks/twilio-webhook-testing.md`

Twilio webhook endpoint:

```text
POST /v1/tenants/fh-demo/telephony/twilio/webhook
```

The endpoint:

- Accepts Twilio's default `application/x-www-form-urlencoded` voice webhook fields.
- Starts a first-call session from `CallSid`, `From`, `To`, and `CallStatus`.
- Advances the workflow from Twilio speech callbacks using `SpeechResult` and `Confidence`.
- Returns TwiML XML directly instead of issuing separate provider command API calls.
- Dials configured phone handoff destinations with TwiML `<Dial><Number>...</Number></Dial>` after escalation.
- Adds Twilio called-party screening for phone handoffs with a funeral-home rep whisper summary and press-1 acceptance prompt.
- Adds Twilio speech recognition hints and `actionOnEmptyResult="true"` to reduce missed first-call intake answers.
- Reprompts safely on empty Twilio speech callbacks without restarting or overwriting the active intake session.
- Does not require the tenant `x-api-key`, matching public provider webhook behavior.

Twilio local testing runbook:

```text
docs/runbooks/twilio-webhook-testing.md
```

Current Twilio limitations:

- This first pass uses Twilio `<Gather input="speech">`, not media streams.
- Twilio phone handoff now uses called-party screening with a whisper summary and press-1 acceptance prompt before bridging.
- Warm conference handoff, operator reject/retry routing, and richer accept/reject logging are follow-ups.
- Twilio `<Gather>` reliability is improved with hints and empty-result reprompting, but natural free-form answers still need deeper LLM-backed extraction and eventually streaming audio.

Twilio webhook signature validation:

- Implemented using Twilio's `X-Twilio-Signature` scheme.
- Configure with `TELEPHONY_WEBHOOK_SECRETS=twilio:<TWILIO_AUTH_TOKEN>`.
- The secret is the Twilio account Auth Token, not the Account SID, API key SID, phone number SID, or webhook URL.
- Keep `TELEPHONY_WEBHOOK_SECRETS=` empty only for controlled local testing when manually sending unsigned webhook requests.

Recent Twilio intake improvements:

- Contextual slot filling now accepts short follow-up answers like `John.` when the active missing slot is decedent name.
- Contextual address filling now accepts bare address answers like `123 Main Street.`
- Address normalization handles Twilio transcripts such as `1, 2 3 Main Street.`
- Later short-answer turns no longer overwrite `death_reported: true` back to false.
- Completed handoff tools are now skipped on repeated turns so CRM leads and dispatch requests are not recreated during prompt loops.
- Twilio empty speech callbacks now return a retry prompt instead of starting a duplicate session.
- Twilio `<Gather>` now includes first-call-specific speech hints for names, relationships, death-report phrasing, and address/location terms.
- Twilio warm handoff now sets a called-party screening URL on `<Number>`, reads the session replay handoff summary, speaks key facts to the funeral home rep, and prompts them to press `1` before bridging.
- Optional LLM-backed first-call fact extraction is wired through `FIRST_CALL_EXTRACTOR=openai`; deterministic extraction remains the default.
- Local extraction smoke script is available via `npm run smoke:extraction`.
- Current deterministic extraction smoke baseline: `10/10` expected facts matched.

Twilio warm handoff tunnel smoke:

- Date: 2026-06-17.
- Temporary tunnel used: `https://juan-sale-verified-kde.trycloudflare.com`.
- Health check through tunnel passed.
- Synthetic public Twilio initial-call request returned speech gather TwiML.
- Synthetic public Twilio speech/escalation request returned screened `<Dial><Number url="/v1/tenants/fh-demo/telephony/twilio/handoff-screen" method="POST">...`.
- Synthetic public handoff-screen request returned the full funeral-home rep summary after the escalation turn was saved.
- Synthetic public handoff-accept request returned `Connecting now.`
- Actual live phone-call validation still needs the Twilio number's Voice webhook pointed to the current tunnel URL while the local server/tunnel are running.

LLM extraction modes:

- Default: `FIRST_CALL_EXTRACTOR=deterministic` or unset.
- Fake local fallback for tests/smoke work: `FIRST_CALL_EXTRACTOR=fake_llm` with `FIRST_CALL_FAKE_LLM_OUTPUT_JSON`.
- OpenAI structured output fallback: `FIRST_CALL_EXTRACTOR=openai` with `OPENAI_API_KEY`.
- Optional model override: `OPENAI_MODEL`; default is `gpt-5.5`.
- Optional timeout override: `OPENAI_TIMEOUT_MS`.
- The fallback fills missing facts only and does not overwrite deterministic facts.
- Provider failures are converted into warnings so live calls continue on deterministic extraction.

OpenAI extraction smoke status:

- `scripts/first-call-extraction-smoke.mjs` now loads ignored local `.env.local` and `.env` files before reading environment variables.
- In `FIRST_CALL_EXTRACTOR=openai` mode, the smoke script forces `FIRST_CALL_LLM_MIN_BASE_CONFIDENCE=1` when unset so the OpenAI fallback path is actually exercised during validation.
- Deterministic smoke remains the clean local baseline: `npm run smoke:extraction` currently reports `10/10` expected facts matched.
- Live OpenAI smoke passed on 2026-06-16 using the OpenAI API key from the macOS clipboard without printing or storing it.
- Result: `FIRST_CALL_EXTRACTOR=openai OPENAI_TIMEOUT_MS=20000 npm run smoke:extraction` reported `13/13` expected facts matched.
- The fallback-only case filled `facility_name`, `decedent_name`, and `caller_phone` through OpenAI structured output.
- Clipboard access from the default sandbox returned empty during restart recovery, but escalated clipboard access worked. Prefer ignored `.env.local` for repeatability.

Latest OpenAI-backed Twilio live status:

- Date: 2026-06-21.
- OpenAI key was validated from the macOS clipboard without printing or storing it.
- Direct context extraction check passed: active `collect_decedent` turn extracted `decedent_name: Amy Lee`.
- Temporary tunnel used: `https://maritime-dip-medieval-immediately.trycloudflare.com`.
- Twilio webhook used: `/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Live session `CA8b07f8e5032eab9ca459b6da8e302125` completed intake and reached `ESCALATE`.
- Captured facts included caller `Bob Jones`, callback `621 563 2430`, decedent `Jimbo Jones`, residence address `129 Up the Creek Road Denton Texas`.
- CRM lead and dispatch removal request both executed successfully; no OpenAI provider errors appeared in replay.
- Follow-up hardening commit `06a4e4e` persists `death_reported: true` for first-call death-report sessions and adds a regression test matching this multi-turn shape.
- Full suite after the hardening change: `npm run build && npm test` passed `144/144`.
- Note: any already-running local server started before commit `06a4e4e` must be restarted with a valid `OPENAI_API_KEY` in the environment before retesting that exact fix live.
- Latest-code confirmation on 2026-06-21 used commit `570a5c1` with tunnel `https://charged-photographs-loves-poetry.trycloudflare.com`.
- Live session `CA64e858f3b3a43ede6745ce4f4eb1763b` reached `ESCALATE`, persisted `death_reported: true`, executed CRM and dispatch tools, and loaded the Twilio `handoff-screen` endpoint successfully.
- Captured facts included caller transcript `Piper MC tank`, callback `6234286124`, decedent `Katherine Johnson`, and pickup address `12641 Pinkie Pie Way, Dallas, Texas`.
- Caller feedback after that test: language handling was clean, but pauses between questions were too long.
- Follow-up latency hardening skips the OpenAI structured-output request when local contextual parsing already fills the active slot, such as name-only, phone-only, decedent-name-only, or address-only answers. OpenAI remains available for ambiguous turns.
- Validation after latency hardening: `npm run build && npm test` passed `146/146`.
- Additional latency refinements on 2026-06-21 added local parsing for mixed/lowercase active-slot names and noisy Twilio phone spacing such as `214.  689 1283`.
- Latest live session `CAd6c8fa80d8056613fc33ff5f94460684` on commit `c4600f8` had speech-turn response durations of `8 ms`, `6 ms`, and `4 ms`, plus `3 ms` for `handoff-screen`.
- Captured facts included caller `Robert Adams`, callback `214-689-1283`, decedent `Charles Daniels`, and pickup address `5817 Television Street`.
- Follow-up accuracy hardening commit `7aa2a07` preserves local address city phrases like `Street. In Fort Worth` and apartment/unit details like `apartment 413`.
- Validation after address hardening: `npm run build && npm test` passed `151/151`.
- Follow-up production hardening adds a Twilio readiness endpoint at `GET /v1/tenants/<tenantId>/telephony/twilio/readiness`.
- The endpoint combines tenant readiness with sanitized Twilio preflight status and reports whether `TELEPHONY_WEBHOOK_SECRETS` includes a `twilio:<auth_token>` entry before persistent public traffic.
- Validation after Twilio readiness hardening: `npm run build && npm test` passed `154/154`.
- Follow-up smoke tooling adds `npm run smoke:twilio-readiness`; local unsigned validation passed with mode `unsigned_local` and public traffic readiness `no`.
- Signed-readiness validation also passed locally with `TELEPHONY_WEBHOOK_SECRETS=twilio:test-auth-token` and `TWILIO_EXPECT_PUBLIC_READY=true`; smoke output reported mode `signed_webhook` and public traffic readiness `yes`.
- Follow-up Twilio webhook smoke tooling adds `npm run smoke:twilio`; it posts synthetic initial-call, speech/escalation, handoff-screen, and handoff-accept webhooks, then verifies replay escalation.
- Unsigned and signed local webhook smoke validations both passed. Signed validation used `TELEPHONY_WEBHOOK_SECRETS=twilio:test-auth-token`, `TWILIO_AUTH_TOKEN=test-auth-token`, and `TWILIO_EXPECT_SIGNED_WEBHOOK=true`.
- Follow-up local startup tooling adds `npm run start:twilio-local`; it loads ignored `.env.local` / `.env` values, applies safe local defaults, prints the next readiness/webhook smoke commands, and successfully booted the local server.
- Follow-up tunnel tooling adds `npm run start:twilio-tunnel`; it starts the local Twilio server plus a Cloudflare quick tunnel and prints the exact Twilio Voice webhook/readiness URLs. Local launcher validation on 2026-06-22 printed a working tunnel URL and shut down cleanly.
- Live Twilio validation on 2026-06-22 used tunnel `https://permissions-lay-international-vpn.trycloudflare.com`; session `CA4b36f3cabba032ebca996f9dd56c6e88` reached `ESCALATE`, executed CRM intake and dispatch removal request, and showed webhook turn durations of `5 ms`, `10 ms`, `7 ms`, and `8 ms`.
- Captured facts included caller callback `214-363-4519`, decedent `Robert Johnson`, and pickup address `1642 Fireplace Drive Wataga Texas`. The live transcript exposed a noisy caller-name parse (`Bob Television Telephone`) from the phrase shape `My name is Bob. Television. My telephone is...`; follow-up hardening now keeps telephone cue/noise words out of caller names.
- Validation after noisy telephone cue hardening: `npm run build && npm test` passed `155/155`.
- Live Twilio validation on 2026-06-22 after the greeting update used tunnel `https://tail-traveller-key-annotation.trycloudflare.com`; session `CAe05d57e9ff1d29cdd68bd15b353c228d` confirmed the new opening greeting reached the live path and kept webhook durations fast, but ended before escalation because `Circle` was not accepted as a street suffix.
- Captured hardening targets from that call: parse `Charles McDaniels is my name, and my phone number is 432569. 4324.` as caller `Charles McDaniels` with callback `432-569-4324`, and parse `12436. Saratoga Circle in Fort Worth.` as a pickup address. Follow-up hardening now covers reverse caller-name phrasing and additional street suffixes including `Circle`, `Way`, `Place`, `Terrace`, and `Parkway`.
- Validation after reverse-name and Circle-address hardening: `npm run build && npm test` passed `156/156`.
- Live Twilio validation on 2026-06-22 using tunnel `https://health-snake-studying-adrian.trycloudflare.com` reached `ESCALATE` in session `CA659afbff6e1ffb8556747adf3f50c74c`, executed CRM intake and dispatch removal request, and captured pickup address `12724 Saratoga Springs Circle Fort Worth`.
- Captured hardening targets from that call: a phone-only answer `I can be reached at. 769 432. 4218.` temporarily overwrote caller `Mario Lopez`, and `Her name is Maria. Castro Rodriguez.` captured only `Maria`. Follow-up hardening now preserves existing caller names on phone-only turns and normalizes dotted multi-part decedent names.
- Validation after phone-only and dotted-name hardening: `npm run build && npm test` passed `157/157`.
- Follow-up data-integrity foundation adds optional per-field `factConfidence` to first-call extraction results, carries LLM fallback confidence for LLM-filled facts, adds contextual confidence for fast-path local captures, and records the confidence map on `INTENT_DETECTED` events for replay/post-call QA.
- Validation after field-confidence foundation: `npm run build && npm test` passed `157/157`.
- Follow-up selective LLM trigger policy adds `decideFirstCallLlmValidation`; strong local active-slot captures skip LLM fallback for latency, low-confidence active-slot captures target only that field, and structured-output requests now include `validationReasons` plus `validationTargetFacts`.
- Validation after selective LLM trigger policy: `npm run build && npm test` passed `160/160`.
- Live OpenAI-backed Twilio validation on 2026-06-25 used tunnel `https://pole-biblical-sunday-motivated.trycloudflare.com`; latest session `CA988ecbd878fbe00c2f5a4ab8db3d7252` reached `ESCALATE`, executed CRM intake and dispatch removal request, and kept webhook durations fast (`9 ms`, `14 ms`, `8 ms`, `6 ms`, `13 ms`, `3 ms`, `4 ms` observed).
- Captured hardening target from that call: local address parsing accepted `1627 Commercial Avenue cville Texas` with too much confidence. Follow-up hardening lowers confidence for suspicious lowercase location tokens after a street suffix, and merges extracted/contextual facts by confidence so validated LLM corrections can beat weak local captures.
- Validation after confidence-aware address correction: `npm run build && npm test` passed `161/161`.
- Live OpenAI-backed Twilio validation on 2026-06-25 used tunnel `https://interactions-parallel-asus-district.trycloudflare.com`; session `CAdf125658c9ec503c3bf8390d2ad29774` reached `ESCALATE`, executed CRM intake and dispatch removal request, and replay showed `factConfidence` metadata on the captured fields.
- Captured facts included caller `John Adams`, callback `254-431-5620`, decedent `Robert Klein`, and pickup address `46289 Main Street Grapevine Texas`. The address/city phrase `46289 Main Street. In Grapevine, Texas.` was accepted cleanly with pickup address confidence `0.82`.
- Follow-up target from that call: the first callback-number answer was misheard as `2554 431. 5762` and did not produce `caller_phone`, so the agent asked again and captured the corrected number on the next turn. Consider a phone-number repair/confirmation pass for near-10-digit Twilio transcripts.
- Follow-up phone hardening now detects phone-intent turns with near-10-digit transcripts, avoids storing a guessed callback number, and asks the caller to say the 10-digit callback number one digit at a time. Validation after this change: `npm run build && npm test` passed `162/162`.
- Live deterministic Twilio validation on 2026-06-25 used tunnel `https://flip-ahead-promote-labels.trycloudflare.com`; session `CA693785432b4f771780b33ab2654a8328` reached `ESCALATE`, executed CRM intake and dispatch removal request, and confirmed the near-phone guard did not store the bad first callback transcript `2554431. 5762`.
- The agent collected the corrected callback on the follow-up turn as `254-431-5762`. Remaining live STT hardening notes: caller name was heard as `Kyle Finny`, and pickup address was heard as `639 gymnastics Street South Lake Texas`.
- Follow-up address hardening now lowers confidence for known live-call STT false-friend street tokens such as `gymnastics Street`, which lets a higher-confidence validated extraction replace the local parse when OpenAI validation is enabled. Validation after this change: `npm run build && npm test` passed `163/163`.
- Live OpenAI-backed Twilio validation on 2026-06-25 used tunnel `https://car-herself-cruz-procedures.trycloudflare.com`; session `CA996a1bf6982693afe1b6f9ffc6d82af5` reached `ESCALATE`, executed CRM intake and dispatch removal request, and kept webhook durations fast (`6 ms`, `14 ms`, `7 ms`, `7 ms`, `6 ms` observed).
- Captured facts included caller `Martijn Van`, callback `603-471-5862`, decedent `Eduardo Hernandez`, and pickup address `5723 Martin Luther King Boulevard Fort Worth Texas`. This call did not exercise the targeted `gymnastics Street` correction path because the address transcript was clean and stayed at pickup address confidence `0.82`.
- Targeted OpenAI-backed Twilio validation on 2026-06-25 used tunnel `https://sleeps-provisions-edmonton-axis.trycloudflare.com`; session `CA7012db600225ef1f5c7f50782b038616` reached `ESCALATE`, executed CRM intake and dispatch removal request, and included long OpenAI validation turns (`10833 ms` and `6555 ms` observed).
- Captured hardening targets from that call: a malformed callback transcript `439. 5 562. 4321` was accepted from LLM output, and the phone-intent phrase `I can be reached...` overwrote caller `Ronald Reagan` with `I Can Be`. The targeted address transcript stayed as `639 gymnastics Street, South Lake, Texas`; OpenAI validation did not correct the street token.
- Follow-up hardening now prevents invalid phone-only turns from overwriting an existing caller name, asks for digit-by-digit confirmation when a phone-intent turn has near-phone digits that local parsing cannot safely normalize, discards invalid LLM caller-phone values, and tightens deterministic caller-name parsing so multi-word names are not shortened at word boundaries. Validation after this change: `npm run build && npm test` passed `165/165`.
- Follow-up suspicious-address hardening now keeps known STT false-friend street tokens such as `gymnastics Street` from triggering dispatch/escalation. The address is retained for staff context, but the agent stays in location collection and asks the caller to repeat just the street name. Validation after this change: `npm run build && npm test` passed `166/166`.
- Live OpenAI-backed Twilio validation on 2026-06-26 used tunnel `https://helicopter-polyphonic-roads-fancy.trycloudflare.com`; session `CA22932c97e408804ff9c0f25baa6c3376` confirmed the suspicious-street safety gate worked, but exposed a confirmation loop. The caller repeated `Gymnastics Street` and then `Gymnastics`, but the agent kept asking for the street name and the call ended before dispatch.
- Follow-up confirmation hardening now treats short repeat answers such as `Gymnastics` or `Gymnastics Street` as confirmation of the suspicious street token, allowing dispatch/escalation to proceed after the caller confirms the unusual street name. Validation after this change: `npm run build && npm test` passed `166/166`.
- Live OpenAI-backed Twilio validation on 2026-06-26 used tunnel `https://totally-budapest-basement-launched.trycloudflare.com`; session `CA420ecd948c39c37381cfad3b15622284` confirmed the full suspicious-street confirmation flow. The agent stayed in `collect_location` after `639 Gymnastics Street`, accepted the caller's repeat answer `Gymnastics`, then reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`.
- Follow-up role-confusion hardening now preserves an already-collected caller name and pickup contact name outside the caller-collection step, even if the extractor later returns a higher-confidence caller name from a decedent/location turn. When the active step is `collect_decedent`, the contextual parser also accepts natural answers such as `My name is George Watson` as the decedent name without overwriting the caller. Validation after this change: `npm run build && npm test` passed `168/168`.
- Live deterministic Twilio validation on 2026-06-26 used tunnel `https://qualification-issued-says-flights.trycloudflare.com`; session `CAf79806c367d9836916e2ca433c0c949e` confirmed the caller/decedent role-confusion hardening. The caller first gave `Kyle Finny` with callback `603-731-5845`, then answered the decedent prompt with `My name is George Watson`; the replay kept caller/pickup contact as `Kyle Finny`, captured decedent as `George Watson`, collected pickup address `636 South Main Street Keller Texas`, reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. Webhook turn durations were fast: `11 ms`, `16 ms`, `9 ms`, and `7 ms`.
- Live OpenAI-backed Twilio validation on 2026-06-26 used tunnel `https://someone-murphy-ladder-kick.trycloudflare.com`; session `CAf351fcd859f81197ebf8577c9f221cac` confirmed the same caller/decedent role-confusion path under `FIRST_CALL_EXTRACTOR=openai`. The first callback transcript was missing a digit (`637315845`), so the agent stayed in caller collection and captured the corrected number on the next turn. The replay kept caller/pickup contact as `Kyle Finny`, captured decedent as `George Watson`, collected pickup address `6326 Rose Street Keller Texas`, reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. Webhook turn durations remained fast: `10 ms`, `16 ms`, `8 ms`, `6 ms`, and `7 ms`.
- Follow-up caller-name spelling hardening adds a targeted one-turn confirmation only for known suspicious live-STT name spellings, currently including `Finny`. If the caller is captured as `Kyle Finny`, the agent asks the caller to spell the last name for the funeral director, accepts spelled answers such as `F I N N E Y`, corrects caller and pickup contact to `Kyle Finney`, and then resumes the normal decedent prompt. Ordinary names such as `Kyle Finney` do not trigger the extra turn. Validation after this change: `npm run build && npm test` passed `170/170`.
- Live deterministic Twilio validation on 2026-06-26 used tunnel `https://jesus-themselves-pediatric-combo.trycloudflare.com`; session `CA0a954696eb74f259a551aa173f349146` reached `ESCALATE`, executed dispatch, and kept webhook durations fast (`10 ms`, `16 ms`, `10 ms`, `7 ms`), but the spelling prompt did not fire because Twilio heard the caller turn as `My name is Kyle, feny, my phone number...` and the parser kept only `Kyle`. Follow-up hardening now preserves fuller comma-separated name candidates, adds `feny` as a suspicious spelling for `Finney`, and keeps cue/noise words such as `and` and `television` out of caller names. Validation after this change: `npm run build && npm test` passed `171/171`.
- Live deterministic Twilio validation on 2026-06-26 used tunnel `https://ordering-partner-capability-turbo.trycloudflare.com`; session `CAa0099909259725484f70ba01ab42a35a` confirmed the patched spelling flow. Twilio heard the caller turn as `My name is Kyle, finny my phone is 637315845`; the agent treated `Kyle Finny` as a suspicious name, asked for spelling, accepted `F. I n. N e y.`, corrected caller and pickup contact to `Kyle Finney`, then stayed in caller collection because the first phone transcript was malformed. After the corrected phone number, it collected decedent `George Watson`, pickup address `4362 Main Street Keller Texas`, reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. Webhook turn durations remained fast: `10 ms`, `15 ms`, `9 ms`, `6 ms`, `7 ms`, and `7 ms`.
- Follow-up phone repair hardening now accepts a 9-digit phone-intent transcript only when it can be safely anchored to Twilio's provider caller ID. For example, if Twilio caller ID is `+16037315845` and speech recognition hears `637315845`, the service repairs the callback to `603-731-5845`; if the provider caller ID does not match, the agent still asks for the callback number one digit at a time. Validation after this change: `npm run build && npm test` passed `173/173`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://hip-betty-personality-implementing.trycloudflare.com`; session `CAa80702d7a294ecb03b3c952f9e2ea170` confirmed the caller-ID anchored phone repair and name spelling correction. Twilio heard `My name is Kyle, finny my phone is 637315845`; caller ID was `+16037315845`, so the agent repaired callback to `603-731-5845`, asked for spelling, corrected caller/pickup contact to `Kyle Finney`, collected decedent `Robert Jones`, and created the CRM intake. The call ended before dispatch because Twilio heard the pickup address as `6326 Commerce a Keller Texas` and then `6326 Commerce a stuff like Texas`; the parser did not recognize `a` as `Ave`.
- Follow-up address hardening now repairs live pickup-address transcripts where `Avenue`/`Ave` is heard as a standalone `a` between street name and city, such as `6326 Commerce a Keller Texas`, normalizing to `6326 Commerce Ave Keller Texas`. It does not try to repair unrelated corrupt city text such as `stuff like Texas`. Validation after this change: `npm run build && npm test` passed `174/174`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://carrying-smithsonian-warrior-involving.trycloudflare.com`; session `CA5310ca41a3c49551da996c7c178264fa` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The phone repair did work: Twilio heard `My name is Kyle, finny my phone is 637315845`, caller ID was `+16037315845`, and the callback was stored as `603-731-5845`. The agent also corrected caller/pickup contact to `Kyle Finney` after spelling and collected decedent `Robert Jones`. New cleanup target from this call: Twilio heard the pickup address as `At 6326 Commerce, a from Keller, Texas`, which was accepted as `6326 Commerce Ave from Keller Texas`.
- Follow-up address cleanup now removes filler `from` after a street suffix the same way it already removes `in`, so `At 6326 Commerce, a from Keller, Texas` normalizes to `6326 Commerce Ave Keller Texas`. Validation after this change: `npm run build && npm test` passed `175/175`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://implemented-bedrooms-competitions-type.trycloudflare.com`; session `CA2a7840673c4e3d147e6bfa77c134f3b2` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The phone repair again worked: Twilio heard `My name is Kyle finny and my phone is 637315845`, caller ID was `+16037315845`, and callback was stored as `603-731-5845`; pickup address was cleanly stored as `6326 Commerce Ave Keller Texas`. New cleanup target from this call: the caller name was stored as `Kyle Finney And` because the conjunction landed inside the explicit `my name is...` capture before the phone cue.
- Follow-up caller-name boundary cleanup now treats trailing `and` as a cue word instead of a name token, so `My name is Kyle finny and my phone is 637315845` stores `Kyle Finny`, triggers the targeted spelling prompt, and then corrects to `Kyle Finney`. Validation after this change: `npm run build && npm test` passed `176/176`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://stylish-rendered-worthy-visited.trycloudflare.com`; session `CAde54ec6084c88d2be727b5a57b5a35fc` confirmed the caller-name boundary fix, caller-ID anchored phone repair, and Commerce Ave address cleanup together. Twilio heard `My name is Kyle Finny. And my phone is 637315845`; caller ID was `+16037315845`, and final facts stored caller `Kyle Finney`, callback `603-731-5845`, decedent `Robert Jones`, pickup address `6326 Commerce Ave Keller Texas`, reached `ESCALATE`, and executed dispatch. The in-call experience still felt like the phone repair was missed because the next prompt immediately asked for spelling and the replay warning still included `caller_phone_not_found` from the base extractor.
- Follow-up replay/prompt clarity now filters resolved warnings after contextual repairs, so repaired callback turns no longer report `caller_phone_not_found`, and spelling prompts acknowledge an already captured callback: `I have the callback number. I heard your name as...`. Validation after this change: `npm run build && npm test` passed `176/176`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://ware-ticket-buyer-federal.trycloudflare.com`; session `CA58efecc3ba20edfff6eb92bda53a7e7a` reached `ESCALATE` and executed dispatch, but exposed two caller-collection issues. Twilio heard `Of course` during the name prompt and the parser accepted it as caller `Of Course`; earlier bare callback attempts such as `637315845` and `637315845. Zero down. Okay.` were not repaired because the caller-ID anchored repair only ran when a phone cue word was present.
- Follow-up caller-collection hardening now rejects conversational filler words from name-only answers, including `of` and `course`, so `Of course` no longer becomes a caller name. The caller-ID anchored phone repair also accepts bare 9-digit answers, including the observed filler phrase, only when those digits are a subsequence of Twilio's provider caller ID. Validation after this change: `npm run build && npm test` passed `178/178`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://statewide-full-practical-recording.trycloudflare.com`; session `CAeba133bbd1a4e397e85c279c24bc6ec6` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The `Of course` name fix worked: the phrase was not accepted as a caller name. New cleanup targets from the call: Twilio heard the first callback answer as `Of course, uh, 637315845`, which still did not repair because the bare-phone repair filler list did not include `uh`; Twilio also heard the pickup address as `They're at 636 Commerce, Ave and Keller, Texas`, which stored `636 Commerce Ave and Keller Texas`.
- Follow-up caller/address cleanup now allows harmless fillers such as `uh`, `um`, `of`, and `course` around a bare 9-digit caller-ID-anchored callback answer without accepting them as a name, and removes filler `and` after street suffixes such as `Ave and Keller`. Validation after this change: `npm run build && npm test` passed `180/180`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://rate-feed-chef-vast.trycloudflare.com`; session `CA8ea10b6a8073fac9df8f56917154b84f` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The `Ave and Keller` cleanup worked and stored `636 Commerce Ave Keller Texas`. New cleanup targets from the call: Twilio heard the first callback answer as `Yes, of course. Um, 637315845`, which still did not repair because the filler list did not include `yes`; Twilio heard the next caller turn as `oh, my name is Kyle Finny at 637315845`, which did not parse because `at` before a phone-like value was not treated as a callback cue; and the spelling answer `Last name is spelled f. I n n e y` was marked attempted instead of correcting `Finny` to `Finney`.
- Follow-up caller-collection cleanup now treats `yes`, `yeah`, and `yep` as safe filler around caller-ID-anchored bare callback repairs, treats `at` followed by digits as a callback cue during caller collection, and accepts natural spelling answers such as `Last name is spelled f. I n n e y`. Validation after this change: `npm run build && npm test` passed `181/181`.
- Live deterministic Twilio validation on 2026-06-27 used tunnel `https://morning-verbal-upon-officially.trycloudflare.com`; session `CA8d24d60d212e794ed33732507074c947` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The data path worked: `Yes, of course. Um, 637315845` repaired to `603-731-5845`, `Oh, uh, my name is Kyle finny at 637315845` captured the caller and retained the callback, `Last name is spelled f. I n n e y` corrected caller/pickup contact to `Kyle Finney`, and pickup address stored as `636 Commerce Ave Keller Texas`. The in-call experience still felt like a phone hiccup because when only the phone was captured and the name was missing, the next prompt asked for the name without acknowledging that the callback had been accepted.
- Follow-up prompt clarity now says `I have the callback number. May I have your name?` when caller phone is captured but caller name is still missing. Validation after this change: `npm run build && npm test` passed `181/181`.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://networking-larger-look-objective.trycloudflare.com`; session `CAa84a900350f720dc2409e44e109f5648` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The callback acknowledgement prompt fix worked in-call, and final facts were clean: callback `603-731-5845`, caller/pickup contact `Kyle Finney`, decedent `Robert Jones`, and pickup address `636 Commerce Ave Keller Texas`. New cleanup target from the call: Twilio heard the caller-name turn as `yes, it's Kyle Finny`, which was not accepted, causing one extra name prompt before `My name is Kyle Finny` was captured.
- Follow-up caller-name cleanup now accepts `it is` / `it's` name phrasing, so `yes, it's Kyle Finny` captures the caller name and proceeds to the targeted spelling prompt instead of asking for the name again. Validation after this change: `npm run build && npm test` passed `181/181`.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://dpi-acid-locks-truly.trycloudflare.com`; session `CA77c0311fccfe7833651f2cdc2de763c8` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The `it's Kyle Finny` fix worked immediately and led to the spelling prompt. Final facts were clean: caller/pickup contact `Kyle Finney`, callback `603-731-5845`, decedent `Robert Jones`, and pickup address `636 Commerce Ave Keller Texas`. New cleanup targets from the call: when the caller answered the decedent prompt with `Robert Jones, 636 Homer, Salve and Keller, Texas`, the parser ignored the whole turn, and when the caller later said `636 Commerce Salve and Keller, Texas`, the parser did not treat `Salve` as `Ave`.
- Follow-up mixed-answer cleanup now captures a leading decedent name before a comma while intentionally waiting for a clean location prompt instead of trusting a garbled address fragment from the same turn. Address cleanup also repairs live STT `Salve` to `Ave` in pickup-address collection, then removes filler `and` after the street suffix. Validation after this change: `npm run build && npm test` passed `183/183`.
- Parser quality pass on 2026-06-28 consolidated contextual fact inference without changing behavior: caller, decedent, and pickup-address parsing now run through named helper phases, and caller parsing is separated into phone facts, name facts, and candidate cleanup. This was done to keep the recent live-call hardening from turning into an opaque regex pile. Validation after this refactor: `npm run build && npm test` passed `183/183`.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://originally-pearl-salvation-puzzle.trycloudflare.com`; session `CA0dd0aaeef7c015b426aac46343ddcf95` reached `ESCALATE`, skipped duplicate CRM creation, and executed `dispatch.create_removal_request`. The refactor preserved the existing flow, but the call exposed two follow-up cleanup targets: Twilio heard the mixed decedent/location answer as `Robert Jones at 636 Sr. To have and Keller, Texas`, which did not capture the decedent until repeated, and heard the corrected address as `At 6:36 Commerce. Salve and Keller, Texas`, which stored `36 Commerce Ave Keller Texas`.
- Follow-up at-address/time-number cleanup now captures a decedent name before an address cue such as `Robert Jones at 636...` while still waiting for a clean location prompt, and repairs street numbers that Twilio formats like a time, such as `6:36 Commerce` to `636 Commerce`. Validation after this change: `npm run build && npm test` passed `185/185`.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://accessible-mask-potatoes-nominated.trycloudflare.com`; session `CA053baade68fb409d3f7665d5cfc93191` confirmed the at-address/time-number cleanup in the live Twilio path. Twilio heard `Robert Jones at 6:36, senior to have and Keller, Texas`, and the system captured decedent `Robert Jones` while leaving location open. Twilio then heard `636 Commerce Salve in Keller, Texas`, and final facts stored caller `Kyle Finney`, callback `603-731-5845`, decedent `Robert Jones`, pickup address `636 Commerce Ave Keller Texas`, reached `ESCALATE`, skipped duplicate CRM creation, and executed dispatch.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://accessible-mask-potatoes-nominated.trycloudflare.com`; session `CA8d65911f0b8746dc8821c21805108011` completed and executed dispatch, but exposed the first facility-flow gaps. Twilio heard `This is Nurse Sarah at Green Valley, hospice. My phone here is 214. 6395723`, but the first turn only captured the callback. It did not capture `Sarah`, facility role `nurse`, facility `Green Valley Hospice`, or preserve hospice context. Twilio also heard `Calling about Mr. Robert Jones in room 214`, which did not capture the decedent until repeated. Final facts were enough for dispatch but incorrectly stored `place_of_death_type` as `residence`.
- Follow-up facility-call hardening now captures staff-title caller phrasing such as `This is Nurse Sarah at Green Valley, hospice`, stores `facility_contact_role: nurse`, `caller_relationship_to_decedent: facility_staff`, `facility_name: Green Valley Hospice`, and `place_of_death_type: hospice`; captures decedent names from `Calling about Mr. Robert Jones in room 214`; preserves known place type instead of letting later `unknown` or address-only turns overwrite it; allows address collection even when `facility_name` is already present; and changes facility-only hospital/hospice reports to collect a pickup address before dispatch. Validation after this change: `npm run build && npm test` passed `187/187`.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://advances-recognized-nissan-jewelry.trycloudflare.com`; session `CA97d9fd3fc304ead41533c3b28d0492ee` reached `ESCALATE` and executed dispatch, but exposed two facility transcript edge cases. Twilio split the facility as `Green Valley. Hospice`, so `facility_name` was not stored, and the contextual name parser misread `I'm calling about Mr. Robert Jones in room 214` as decedent `Calling About Mr`, winning a confidence tie over the deterministic extractor's correct `Robert Jones`.
- Follow-up facility transcript cleanup now accepts multi-separator phone numbers such as `214. 639 5723`, recognizes facility names split by punctuation such as `Green Valley. Hospice`, strips that punctuation during facility normalization, and rejects `calling/about/Mr/Mrs/Ms/Dr` tokens from contextual name-only answers. Validation after this change: `npm run build && npm test` passed `187/187`.
- Live deterministic Twilio validation on 2026-06-28 used tunnel `https://advise-varies-metro-philips.trycloudflare.com`; session `CA83fb0fa157e179dbb6307214709e462c` confirmed the facility transcript cleanup in the live Twilio path. Final facts stored callback `214-639-5723`, caller/pickup contact `Sarah`, `facility_contact_role: nurse`, `caller_relationship_to_decedent: facility_staff`, facility `Green Valley Hospice`, `place_of_death_type: hospice`, decedent `Robert Jones`, pickup address `1297 Green Mountain Drive South Lake Texas`, reached `ESCALATE`, skipped duplicate CRM creation, and executed dispatch.
- Live deterministic Twilio validation on 2026-06-29 used tunnel `https://tokyo-decorating-sample-messages.trycloudflare.com`; session `CAc24e42cd6315089f0da8f8b0ff880b55` reached `ESCALATE`, skipped duplicate CRM creation, and executed dispatch, but exposed medical examiner lane gaps. Twilio heard `This is investigator, Sarah Miller with the Terra County Medical examiner's Office...`, but the API stored caller `Investigator`; it classified the pickup as `hospital` because of `200 Medical Center Drive`; and it missed `case number 2611232` from `Calling about Robert Jones case. Number 2611232`.
- Follow-up medical examiner hardening now captures title-plus-comma caller phrasing such as `This is investigator, Sarah Miller with...`, stores `facility_contact_role: investigator`, `caller_relationship_to_decedent: facility_staff`, `facility_name: Terra County Medical Examiner's Office`, `place_of_death_type: medical_examiner`, decedent `Robert Jones`, and `crm_existing_case_reference: 2611232`. The case reference is also passed into CRM intake args and surfaced on the human handoff summary. The extractor now ignores generic unnamed facility phrases such as `the medical examiner's office` so later location turns do not overwrite a fuller county office name. Validation after this change: `npm run build && npm test` passed `189/189`.
- Live deterministic Twilio validation on 2026-06-29 used tunnel `https://angels-covered-internal-aware.trycloudflare.com`; session `CAd21c8c06be50241f6fcc4c96ca77f3d9` reached `ESCALATE`, skipped duplicate CRM creation, and executed dispatch for a hospital release call. Final facts stored caller `David Carter`, callback `214-639-5723`, facility `Sunrise Hospital`, `place_of_death_type: hospital`, decedent `Helen Brooks`, and pickup address `500 Medical Center Drive Fort Worth Texas`. Follow-up targets from the call: the first turn contained `We have Helen Brooks ready for release`, but the parser still asked for the decedent name; caller relationship stayed missing because the caller gave a facility but no staff title; and later neutral turns downgraded the stored urgency to `unknown`.
- Follow-up hospital release hardening now captures decedent names from live release phrasing such as `We have Helen Brooks ready for release`, infers `caller_relationship_to_decedent: facility_staff` when a named caller is calling from a facility, and preserves an already-known non-unknown urgency when later slot answers are neutral. Validation after this change: `npm run build && npm test` passed `191/191`.
- Live deterministic Twilio validation on 2026-06-29 used tunnel `https://informative-jurisdiction-commodities-bras.trycloudflare.com`; session `CA389c64db57b2a97bf7ab7ee8e92baceb` exposed a major routine-pricing failure. The caller said `cremation pricing` and `No one has passed away`, but the parser treated `passed away` as a death report, forced the first-call decedent/location path, asked for spelling, then treated correction phrases such as `This is a pricing question` as possible decedent/location answers.
- Follow-up pricing-lane hardening now recognizes negated death reports such as `No one has passed away`, classifies pricing/cost calls as `pricing_or_billing`, stores `death_reported: false`, keeps urgency `routine`, asks only for caller contact if needed, creates a CRM follow-up record with `reasonForCall: pricing_or_billing`, and then closes the Twilio call with an office-hours follow-up message instead of opening another speech gather. The extractor also treats neutral slot answers as unknown death status rather than false, preserving existing death-report behavior for first-call paths. Validation after this change: `npm run build && npm test` passed `194/194`.
- Live deterministic Twilio validation on 2026-06-29 used tunnel `https://administered-cookies-weed-das.trycloudflare.com`; session `CAba63fb43cfab98f8a448f41afcd25555` confirmed the pricing lane in the live Twilio path. The call classified as `pricing_or_billing`, asked only for contact info, stored `death_reported: false`, `urgency: routine`, `reasonForCall: pricing_or_billing`, callback `603-731-5845`, reached `WRAPUP`, executed only `crm.create_intake_lead`, and did not ask for decedent/location or dispatch. Minor follow-up target: Twilio heard `my name is Kyle, finny`, but the routine follow-up stored caller `Kyle`; the call experience was smooth and phone follow-up data was sufficient.
- Live deterministic Twilio validation on 2026-06-29 exposed a family routine office-hours failure in session `CAd2151648f483c186938685287e64db2d`. The caller said the funeral home was already helping the family, this was not a new death call and not an emergency, and asked what time the office opens and whether clothing could be dropped off. The system still classified the turn as `first_call_intake`, asked for decedent/location facts, and created a CRM intake instead of closing as a routine follow-up.
- Follow-up routine-family hardening now recognizes existing-family/office-hours/drop-off language, classifies the lane as `service_schedule_question`, stores `death_reported: false`, `urgency: routine`, `reasonForCall: service_schedule_question`, `dropoff_preference`, and optional decedent/caller relationship facts for context, skips surname-spelling confirmation on routine inquiry lanes when callback info is present, and avoids treating `funeral home` as a residence location. Validation after this change: `npm run build && npm test` passed `196/196`.
- Current live local Twilio tunnel after this fix: `https://allan-papua-involved-zero.trycloudflare.com`; webhook `https://allan-papua-involved-zero.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`. Public readiness smoke passed in unsigned local mode. A direct public webhook simulation with the routine family office-hours script reached `WRAPUP`, returned the office-hours follow-up `Say` plus `<Hangup/>`, stored `intent: service_schedule_question`, `death_reported: false`, `place_of_death_type: unknown`, caller `Kyle Finny`, decedent/context `Robert Finny`, and did not gather for decedent/location or dial dispatch.
- Live deterministic Twilio validation on 2026-06-30 used tunnel `https://monica-submitted-instead-employ.trycloudflare.com`; session `CA07e5d54f8429947b8b2c11a5b02a1246` exposed a routine visitation schedule failure. Twilio heard `This is not a new death, call an emergency` instead of `not a new death call or emergency`, so the negated-death detector missed it, classified as `first_call_intake`, asked for location, stored `death_reported: true`, and captured decedent as `Robert Finny The`.
- Follow-up visitation schedule hardening now normalizes punctuation before negated-death checks, recognizes visitation/service schedule language, recognizes `in your care`/already-in-care phrasing as routine-family context, and stops decedent-name capture before `the funeral home`. Validation after this change: `npm run build && npm test` passed `198/198`.
- Current live local Twilio tunnel after this fix: `https://student-deny-naturals-nonprofit.trycloudflare.com`; webhook `https://student-deny-naturals-nonprofit.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`. Public readiness smoke passed in unsigned local mode. A direct public webhook simulation with the live visitation transcript reached `WRAPUP`, returned the office-hours follow-up `Say` plus `<Hangup/>`, stored `intent: service_schedule_question`, `death_reported: false`, `urgency: routine`, `place_of_death_type: unknown`, caller `Kyle Penny`, decedent/context `Robert Finny`, and did not gather for location or dial dispatch.
- Live deterministic Twilio validation on 2026-06-30 used tunnel `https://student-deny-naturals-nonprofit.trycloudflare.com`; session `CAa67058e1be7969fc085329923adaf294` confirmed the routine funeral-director-callback lane sounded much better to the caller. The live trace classified as `family_question`, reached `WRAPUP` immediately, executed only `crm.create_intake_lead`, stored callback `603-731-5845` after repairing Twilio's 9-digit `637315845` from caller ID, and did not ask location or dispatch. Small cleanup found and fixed afterward: Twilio included filler in the decedent phrase (`Robert finny, uh, the funeral home...`), so the saved decedent was `Robert Finny Uh`.
- Follow-up callback-lane cleanup now drops exact spoken filler words such as `uh`/`um` from normalized caller/decedent names and pins the live director-callback transcript as both extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `200/200`.
- Live deterministic Twilio validation on 2026-06-30 used tunnel `https://relax-ron-vegetation-hobby.trycloudflare.com`; session `CAccb95bd2dc3addcbe84fcff7081fdb2c` confirmed the routine obituary/flower lane sounded good to the caller. The live trace classified as `family_question`, reached `WRAPUP`, executed only `crm.create_intake_lead`, stored callback `603-731-5845`, caller `Kyle Finny`, decedent `Robert Finny`, `death_reported: false`, `place_of_death_type: unknown`, and did not ask pickup/location questions or dispatch.
- Follow-up obituary/flower cleanup now detects obituary wording and flower delivery topics in routine family calls, stores a specific CRM note such as `Routine family inquiry about obituary wording and flower delivery; caller requested office-hours follow-up.`, and passes `notes`/`dropoffPreference` into `crm.create_intake_lead` instead of only dispatch requests. Validation after this change: `npm run build && npm test` passed `203/203`.
- Live deterministic Twilio validation on 2026-06-30 used tunnel `https://ski-pct-painted-counts.trycloudflare.com`; session `CA9b64b80c06112db635958d0d0dede6f4` confirmed the routine location/hours/parking lane sounded good to the caller. The live trace classified as `service_schedule_question`, reached `WRAPUP`, executed only `crm.create_intake_lead`, stored callback `603-731-5845`, caller `Kyle`, `death_reported: false`, `urgency: routine`, `place_of_death_type: unknown`, and did not ask pickup/location questions or dispatch.
- Follow-up location/hours cleanup now detects office-hours, directions/location, and parking topics in routine family calls, stores a specific CRM note such as `Routine family inquiry about office hours, directions/location, and parking; caller requested office-hours follow-up.`, and pins the live transcript in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `205/205`.
- Current live local Twilio tunnel after this fix: `https://nsw-newsletter-earnings-usb.trycloudflare.com`; webhook `https://nsw-newsletter-earnings-usb.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`. Public readiness smoke passed in unsigned local mode.
- At-home death policy update: family members can call about a death at home, but the system now treats that as an urgent funeral-director guidance call rather than a dispatch-ready removal request. Residence reports from family or another unverified caller still collect caller/decedent/location details, create the CRM intake, warm-handoff to the on-call director, and add a recommended action to verify with hospice, law enforcement, or the medical examiner before creating dispatch/removal work. Dispatch review remains eligible for hospice/facility staff, law enforcement, medical examiner/coroner staff, and other authorized sources with enough pickup context. Officer/deputy/detective/sheriff phrasing and `We have [name] deceased` are now parsed. Validation after this change: `npm run build && npm test` passed `207/207`.
- Live deterministic Twilio validation on 2026-07-01 used tunnel `https://nsw-newsletter-earnings-usb.trycloudflare.com` for two at-home death policy calls. Officer-authorized session `CAbe78d943085026e04e35d7f0d46ec6eb` classified as `first_call_intake`, stored officer `Sarah Miller`, callback `214-639-5723`, decedent `Robert Jones`, residence pickup `636 Commerce Avenue`, requested funeral home `Your Funeral Home`, reached `ESCALATE`, and executed both `crm.create_intake_lead` and `dispatch.create_removal_request`. Family residence session `CAffeff2bdf62b0c9ff94b05c4dc052721` stored caller `Kyle Finney`, callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, residence pickup `636 Commerce Avenue`, reached `ESCALATE`, executed only `crm.create_intake_lead`, and included the authority-verification recommendation in the replay handoff.
- Follow-up from those calls now captures `I'm with him/her/them now` as `currently_with_decedent: true` and includes non-obvious recommended actions, including authority verification, in the Twilio called-party screening whisper. Validation after this change: `npm run build && npm test` passed `208/208`.
- Live deterministic Twilio validation on 2026-07-01 used tunnel `https://nsw-newsletter-earnings-usb.trycloudflare.com` for a hospice nurse at-home death report. Session `CAe94742ad122c2c5482b74c570a864b7e` reached `ESCALATE`, stored nurse `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, pickup address `636 Commerce Ave Keller Texas`, and executed both `crm.create_intake_lead` and `dispatch.create_removal_request`, but the live call required repeat prompts because the first-turn transcript missed decedent, address, `currently_with_decedent`, and requested funeral home.
- Follow-up hospice at-home cleanup now captures live phrasing such as `with Mr. Robert Jones at the family's home`, `I'm out here at a house`, `Requested, your Funeral Home`, and `The address here is 636 Commerce, a and Keller, Texas` in one turn. The exact live transcript is pinned in both extractor and Twilio webhook regressions, and the full session path now normalizes callback `214 6395723` to `214-639-5723` before replay/handoff. Validation after this change: `npm run build && npm test` passed `210/210`.
- Post-commit public Twilio smoke on 2026-07-01 used the same tunnel and server commit `a44fe90`. Synthetic session `twilio-public-hospice-smoke-1782952458140` returned the handoff `<Dial>` immediately with no decedent/location repeat prompt, stored nurse `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, pickup address `636 Commerce Ave Keller Texas`, `currently_with_decedent: true`, requested funeral home `Your Funeral Home`, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-01 used tunnel `https://nsw-newsletter-earnings-usb.trycloudflare.com` for another hospice nurse at-home call. Caller feedback was good and session `CA6b17e20b235bc0c56b21b73bee9054da` reached `ESCALATE`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, and completed both CRM and dispatch tools. Replay still exposed quiet cleanup targets: Twilio heard `this is Nurse. Emily Johnson...`, so caller name stored as `Nurse`; the address stored as `636 Commerce Ave Keller Texas You might`; and `currently_with_decedent` was missed from `I'm at the family's home with...`.
- Follow-up latest-hospice cleanup commit `39d4776` now accepts title punctuation such as `Nurse. Emily Johnson`, captures decedent names from `with Mr. Robert Jones who was passed away`, stops address capture before misheard callback cues such as `You might call back`, and marks `I'm at the family's home with...` as `currently_with_decedent: true`. The exact live transcript is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `212/212`.
- Post-restart public Twilio smoke on 2026-07-01 used the same tunnel and server commit `7ba8d3e`. Synthetic session `twilio-public-hospice-smoke-1782953048364` returned the handoff `<Dial>` immediately with no repeat prompt and stored caller `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, pickup address `636 Commerce Ave Keller Texas`, `currently_with_decedent: true`, requested funeral home `Your Funeral Home`, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-01 used tunnel `https://nsw-newsletter-earnings-usb.trycloudflare.com` for a hospital release call. Session `CA97e91c979fd04e0227928ca8d24ee27f` reached `ESCALATE`, stored caller `David Carter`, callback `214-639-5723`, facility `Sunrise Hospital`, decedent `Miss Helen Brooks`, pickup address `500 Medical Center Drive Fort Worth`, and completed CRM plus dispatch, but the first turn still asked for a decedent/location repeat because Twilio heard `ready here at our hospital. For release` and `Our pickup address, here is...`.
- Follow-up latest-hospital cleanup commit `ec99b8d` now captures hospital release phrases with filler between `ready` and `for release`, accepts `pickup address, here is...`, strips courtesy titles such as `Miss` from decedent names, removes commas before street suffixes such as `Center, Drive`, and treats `for release` as an urgent death/release cue. The exact live transcript is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `215/215`.
- Current public Twilio smoke on 2026-07-05 used tunnel `https://tales-efforts-invitation-insight.trycloudflare.com` and server commit `ec99b8d`. Synthetic session `twilio-public-hospital-smoke-1783275318792` returned the handoff `<Dial>` immediately with no repeat prompt and stored caller `David Carter`, callback `214-639-5723`, facility `Sunrise Hospital`, decedent `Helen Brooks`, pickup address `500 Medical Center Drive Fort Worth Texas`, requested funeral home `Your Funeral Home`, urgency `urgent`, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-05 used tunnel `https://tales-efforts-invitation-insight.trycloudflare.com` for another hospital release call. Session `CA6f5d63de57ad735b98911b3e712067d4` reached `ESCALATE`, stored caller `David Carter`, callback `214-639-5723`, facility `Sunrise Hospital`, pickup address `500 Medical Center Drive Fort Worth Texas`, requested funeral home `Your Funeral Home`, urgency `urgent`, and completed CRM plus dispatch. Replay still exposed one cleanup target: Twilio heard `Helen. Brooks` with a period between first and last name, so the first turn missed the decedent and asked once more.
- Follow-up dotted-hospital cleanup commit `a8aef65` now accepts dotted first/last decedent names in `we have [name] ready for release` phrases. The exact live transcript is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `217/217`. Public smoke `twilio-public-hospital-smoke-1783275751221` on the same tunnel and server commit `a8aef65` returned the handoff `<Dial>` immediately with no repeat prompt and stored decedent `Helen Brooks` cleanly.
- Live deterministic Twilio validation on 2026-07-05 used tunnel `https://tales-efforts-invitation-insight.trycloudflare.com` for a medical examiner release call. Session `CA81f79ea14657849db9434673bc0740d4` reached `ESCALATE`, stored investigator `Sarah Miller`, callback `214-639-5723`, case reference `2611232`, decedent `Robert Jones`, and completed CRM plus dispatch in one turn. Replay exposed quiet data cleanup targets: Twilio heard `Terry County Medical Examiner's Office` instead of Tarrant County, `Felix glows place` instead of Feliks Gwozdz Place, and missed requested funeral home from `release to your Funeral Home`.
- Follow-up medical-examiner false-friend cleanup commit `f540432` normalizes the known Tarrant County Medical Examiner and Feliks Gwozdz Place phrases and captures `release to your Funeral Home` as requested funeral home. The exact live transcript is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `219/219`. Public smoke `twilio-public-me-smoke-1783276052382` on the same tunnel and server commit `f540432` returned the handoff `<Dial>` immediately with no repeat prompt and stored all ME facts cleanly.
- Live deterministic Twilio validation on 2026-07-05 used tunnel `https://tales-efforts-invitation-insight.trycloudflare.com` for a law-enforcement at-home death report. Session `CA3450cbf62d784173becc6569ead9feee` reached `ESCALATE`, stored caller `Officer Mendes`, callback `817-632-4211`, decedent `Elizabeth`, and pickup address `5213 Hidden Oaks Lane Fort Worth Texas`, but only completed CRM. Replay showed the authority gap: `facility_contact_role`, `facility_name`, and `caller_relationship_to_decedent` were missing from `My name is Officer Mendes with the Fort Worth Police Department...`, so dispatch stayed closed and the handoff recommended authority verification.
- Follow-up officer-residence cleanup commit `bfa80e8` now recognizes `my name is Officer... with the ... Police Department` phrasing, stores the officer role/facility/authorized relationship, keeps law-enforcement title when only a surname is given, and preserves comma-separated decedent names such as `Elizabeth, Carter`. The exact live shape is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `221/221`. Public smoke `twilio-public-police-smoke-1783276716744` on tunnel `https://tales-efforts-invitation-insight.trycloudflare.com` and server commit `bfa80e8` reached `ESCALATE`, stored `Officer Mendes`, `Fort Worth Police Department`, decedent `Elizabeth Carter`, pickup address `5213 Hidden Oaks Lane Fort Worth Texas`, completed both CRM and dispatch, and no longer included the authority-verification handoff warning.
- Current live local Twilio tunnel after this fix: `https://tales-efforts-invitation-insight.trycloudflare.com`; webhook `https://tales-efforts-invitation-insight.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`; local server commit `bfa80e8`; runtime `fh-demo` urgent on-call handoff is configured to `+16037315845`. Public Twilio readiness is green for local unsigned testing; persistent public traffic still needs Twilio signature verification configured. Cell-handoff smoke `twilio-public-police-smoke-cell-1783276869470` confirmed the final `<Dial>` points to `+16037315845` and completed both CRM and dispatch.
- Live deterministic Twilio validation on 2026-07-05 used the same tunnel and server commit `bfa80e8` for the repeated officer at-home death report. Session `CAd5b41badde9390eee58a1d861843eef8` confirmed the patch in real Twilio audio: caller `Officer Mendes`, callback `817-632-4211`, relationship `facility_staff`, role `officer`, facility `Fort Worth Police Department`, decedent `Elizabeth Carter`, residence pickup `5213 Hidden Oak Lane Fort Worth Texas`, reached `ESCALATE`, completed `crm.create_intake_lead` and `dispatch.create_removal_request`, and did not include the authority-verification handoff warning. Twilio heard the scripted street as singular `Hidden Oak Lane`; leave as an address-STT observation unless the singular/plural address issue repeats.
- Live deterministic Twilio validation on 2026-07-05 used the same tunnel for a family at-home death report. Session `CA716d7772b646119c055c7210e8377745` correctly followed the Texas-style family-at-home safety policy: caller `Kyle Finny`, callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, `currently_with_decedent: true`, residence pickup `636 Commerce Ave Keller Texas`, reached `ESCALATE`, completed only `crm.create_intake_lead`, skipped dispatch, and included the authority-verification recommendation. The live trace exposed two small STT cleanup targets: the spelling answer was heard as `Any is f i n. N e y.` and did not correct `Kyle Finny`, and `Commerce Ave in Keller` was first heard as `Commerce as in Keller`, causing one extra location prompt.
- Follow-up family-residence STT cleanup commit `4cabf90` now accepts trailing single-letter spelling runs even when Twilio adds a false-friend lead-in such as `Any is...`, and treats `as` like the existing `a`/`salve` Avenue false friends in pickup-address slot answers. Validation after this change: `npm run build && npm test` passed `223/223`. Public smoke `twilio-public-family-smoke-1783277607323` on the same tunnel and server commit `4cabf90` corrected caller to `Kyle Finney`, normalized `636 Commerce as in Keller` to `636 Commerce Ave Keller Texas`, reached `ESCALATE`, completed CRM only, skipped dispatch, included the authority-verification recommendation, and dialed the configured cell handoff `+16037315845`.
- Current live local Twilio tunnel after this fix: `https://tales-efforts-invitation-insight.trycloudflare.com`; webhook `https://tales-efforts-invitation-insight.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`; local server commit `4cabf90`; runtime `fh-demo` urgent on-call handoff is configured to `+16037315845`.
- Live deterministic Twilio validation on 2026-07-05 repeated the family at-home death report against server commit `4cabf90`. Session `CAdd34010683c17e81daf416d91710fa71` confirmed the patch in real Twilio audio: caller corrected to `Kyle Finney`, callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, `currently_with_decedent: true`, pickup address `636 Commerce Avenue Keller Texas`, reached `ESCALATE`, completed only `crm.create_intake_lead`, skipped dispatch, included the authority-verification recommendation, and dialed the configured cell handoff. The only remaining missing handoff fact was `requested_funeral_home`; next family-at-home test should explicitly include `we want your funeral home` or a named funeral home.
- Live deterministic Twilio validation on 2026-07-05 repeated the family at-home death report with explicit funeral-home request language against server commit `4cabf90`. Session `CAe850523bb2646ba87473685f84d70b8e` stored caller `Kyle Finney`, callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, `currently_with_decedent: true`, requested funeral home `Your Funeral Home`, and pickup address `636 Commerce Ave Keller Texas`; reached `ESCALATE`; completed only `crm.create_intake_lead`; skipped dispatch; included the authority-verification recommendation; and had no missing handoff facts. This confirms the family-at-home lane is clean when the caller says `we want your funeral home to help us`.
- Live deterministic Twilio validation on 2026-07-06 used fresh tunnel `https://settings-turned-flickr-wax.trycloudflare.com` against server commit `4cabf90` for a family at-home death report with a named funeral home. Session `CAdfc2f690cf85c9e29e666ff39589d662` stored caller `Kyle Finney`, callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, `currently_with_decedent: true`, requested funeral home `Smith Family Funeral Home`, and pickup address `636 Commerce Avenue Keller Texas`; reached `ESCALATE`; completed only `crm.create_intake_lead`; skipped dispatch; included the authority-verification recommendation; and had no missing handoff facts. This confirms named requested funeral homes are captured cleanly in the family-at-home lane.
- Live deterministic Twilio validation on 2026-07-06 used the same tunnel against server commit `4cabf90` for a hospice nurse at-home report with a named funeral home. Session `CA075f6235bc2a7dd12e1e3bd7dc7fe54a` reached `ESCALATE`, completed `crm.create_intake_lead` and `dispatch.create_removal_request`, and correctly avoided the family-at-home authority-verification warning because the caller was hospice staff. Replay exposed cleanup targets from Twilio sentence breaks: `Nurse Emily. Johnson` stored caller `Emily`, `with Mr. Robert Jones. He has passed away` missed decedent on the first turn, and `Smith Family. Funeral Home` missed `requested_funeral_home`.
- Follow-up hospice punctuation cleanup commit `6771c9a` now accepts title/caller-name sentence breaks such as `Nurse Emily. Johnson`, decedent phrases such as `with Mr. Robert Jones. He has passed away`, requested funeral homes split as `Smith Family. Funeral Home`, and one-turn addresses phrased as `636 Commerce Avenue in Keller, Texas`. The exact live shape is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `225/225`.
- Post-restart public Twilio smoke on 2026-07-06 used tunnel `https://settings-turned-flickr-wax.trycloudflare.com` and server commit `6771c9a`. Synthetic session `twilio-public-hospice-named-smoke-1783382732` returned the handoff `<Dial>` immediately with no repeat prompt, dialed `+16037315845`, stored caller `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, pickup address `636 Commerce Avenue Keller Texas`, `currently_with_decedent: true`, requested funeral home `Smith Family Funeral Home`, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-06 used the same tunnel against server commit `6771c9a` for another hospice nurse at-home named-funeral-home report. Session `CA169ea0334f153abdb704fc5f128f5e6e` reached `ESCALATE`, stored caller `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, requested funeral home `Smith Family Funeral Home`, pickup address `636 Commerce Avenue Keller Texas`, completed CRM plus dispatch, and had no missing handoff facts. Replay exposed one remaining first-turn cleanup target: Twilio heard `with a Mr. Robert Jones. He has passed away`, so the first turn missed decedent and asked one repeat before final escalation.
- Follow-up hospice article cleanup commit `ee6b66d` now accepts `with a Mr. ...`, `with the Mr. ...`, and the same article shape before titled decedents across the `with ... he/she passed`, `with ... who passed`, and `with ... at/in` patterns. The exact live shape, including an initial filler `Okay.` turn, is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `227/227`.
- Post-restart public Twilio smoke on 2026-07-06 used tunnel `https://settings-turned-flickr-wax.trycloudflare.com` and server commit `ee6b66d`. Synthetic session `twilio-public-hospice-article-smoke-1783383126` returned the handoff `<Dial>` immediately with no decedent repeat prompt, dialed `+16037315845`, stored caller `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, pickup address `636 Commerce Avenue Keller Texas`, `currently_with_decedent: true`, requested funeral home `Smith Family Funeral Home`, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-06 repeated the same hospice nurse at-home named-funeral-home script against server commit `ee6b66d`. Session `CA3745185c724d6f04a35e56bb23e23d0a` reached `ESCALATE` directly from the substantive transcript, had no missing facts, stored caller `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, decedent `Robert Jones`, requested funeral home `Smith Family Funeral Home`, pickup address `636 Commerce Avenue Keller Texas`, `currently_with_decedent: true`, and completed both `crm.create_intake_lead` and `dispatch.create_removal_request`. This confirms the hospice named-funeral-home lane is clean in real Twilio audio, including the `with a Mr. Robert Jones` STT variant.
- Live deterministic Twilio validation on 2026-07-06 used the same tunnel against server commit `ee6b66d` for a medical examiner release call. Session `CA76fa81bb71b8420ffda0304fba9b1ee0` reached `ESCALATE` and completed CRM plus dispatch, but needed repeat prompts and stored noisy values because Twilio heard `a tent County, medical examiner's office`, `Robert Jones uh, case number`, `Smith's family funeral home`, and `his pickup location is at 200. Felix glows place...`.
- Follow-up medical-examiner phrasing cleanup commit `b3fe802` now captures decedent names before filler plus `case number`, accepts `pickup location is at...`, normalizes `Tent County Medical Examiner's Office` to `Tarrant County Medical Examiner's Office`, normalizes `Smith's family funeral home` to `Smith Family Funeral Home`, and preserves existing `Terra County` behavior. The exact live transcript is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `229/229`.
- Post-restart public Twilio smoke on 2026-07-06 used tunnel `https://settings-turned-flickr-wax.trycloudflare.com` and server commit `b3fe802`. Synthetic session `twilio-public-me-noisy-smoke-1783386299` returned the handoff `<Dial>` immediately with no repeat prompt, dialed `+16037315845`, stored investigator `Sarah Miller`, callback `214-639-5723`, case reference `2611232`, facility `Tarrant County Medical Examiner's Office`, decedent `Robert Jones`, pickup address `200 Feliks Gwozdz Place Fort Worth Texas`, requested funeral home `Smith Family Funeral Home`, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-06 repeated the medical examiner release script against server commit `b3fe802`. Session `CA48b9cf141abefbee9f7535823e329522` reached `ESCALATE` and completed CRM plus dispatch, but needed a repeat location prompt because Twilio heard `Smith. Family Funeral. Home pickup is at 200. Felix WS. Place...` and the first turn missed both `requested_funeral_home` and `pickup_address`. The second turn stored pickup address as `200 Felix goes place Fort Worth Texas`.
- Follow-up medical-examiner dotted-phrase cleanup commit `b54c561` now accepts `Funeral. Home`, captures `pickup is at...` release phrasing with broken `call. Back` punctuation, normalizes `Felix WS Place` and `Felix goes place` to `Feliks Gwozdz Place`, preserves dotted city/state text without absorbing callback cue words, and infers `currently_with_decedent: true` for official facility release calls. The exact live transcript is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build && npm test` passed `231/231`.
- Current live local Twilio tunnel after this fix: `https://mall-feedback-taylor-advertisers.trycloudflare.com`; webhook `https://mall-feedback-taylor-advertisers.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`; local server commit `b54c561`; runtime `fh-demo` urgent on-call handoff is configured to `+16037315845`.
- Post-restart public Twilio smoke on 2026-07-06 used tunnel `https://mall-feedback-taylor-advertisers.trycloudflare.com` and server commit `b54c561`. Synthetic session `twilio-public-me-dotted-smoke-1783389137` returned the handoff `<Dial>` immediately with no repeat prompt, stored investigator `Sarah Miller`, callback `214-639-5723`, case reference `2611232`, facility `Tarrant County Medical Examiner's Office`, decedent `Robert Jones`, pickup address `200 Feliks Gwozdz Place Fort Worth Texas`, `currently_with_decedent: true`, requested funeral home `Smith Family Funeral Home`, no missing handoff facts, and completed both CRM and dispatch tools.
- Live deterministic Twilio validation on 2026-07-07 used fresh tunnel `https://vessel-enrollment-garcia-floors.trycloudflare.com` for a medical examiner release call. Session `CAbdcc28825902236c538beafcf5ffa8a9` reached handoff but did not ask for the medical examiner case number before collecting location. Replay showed facility context from the Tarrant County Medical Examiner's Office, but `crm_existing_case_reference` was missing; it also exposed live STT variants including `I have a Mr. Robert Jones. He is ready for release...`, `Tenant County Medical Examiner's Office`, and `Felix Groves place`.
- Follow-up medical-examiner case-number commit `f25c7fd` now requires a medical examiner/coroner case number before location and handoff whenever the call context identifies an ME/coroner release. It also accepts bare case-number answers such as `2611232`, captures `case number is...`, normalizes the latest Tarrant County and Feliks Gwozdz STT variants, infers `currently_with_decedent: true` for official release calls, and preserves `medical_examiner`/`emergency` context across later address-only turns. Validation after this change: `npm run build && npm test` passed `235/235`.
- Post-restart public Twilio smoke on 2026-07-07 used tunnel `https://vessel-enrollment-garcia-floors.trycloudflare.com` and server commit `f25c7fd`. Synthetic session `twilio-public-me-missing-case-smoke-1783462175` asked `May I have the medical examiner case number?` after the release transcript omitted the case number, accepted bare answer `2611232`, then collected location and returned the handoff `<Dial>`. Replay stored investigator `Sarah Miller`, callback `214-639-5723`, facility `Tarrant County Medical Examiner's Office`, decedent `Robert Jones`, case reference `2611232`, pickup address `200 Feliks Gwozdz Place Fort Worth Texas`, place type `medical_examiner`, urgency `emergency`, requested funeral home `Smith Family Funeral Home`, `currently_with_decedent: true`, no missing handoff facts, and completed both CRM and dispatch tools.
- Current live local Twilio tunnel after this fix: `https://vessel-enrollment-garcia-floors.trycloudflare.com`; webhook `https://vessel-enrollment-garcia-floors.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`; local server commit `f25c7fd`; runtime `fh-demo` urgent on-call handoff is configured to `+16037315845`.
- Follow-up scenario-matrix tooling adds `npm run smoke:twilio-scenarios` and runbook `docs/runbooks/live-scenario-matrix.md`. It covers hospice residence, medical examiner missing-case-number, hospital release, police residence, family residence authority-check, pricing, and existing-family office-hours lanes through the Twilio webhook with replay fact/tool assertions.
- Scenario-matrix validation on 2026-07-07 passed locally against `http://127.0.0.1:3000` with run id `twilio-scenario-1783462910137`, then passed through the public tunnel `https://vessel-enrollment-garcia-floors.trycloudflare.com` with run id `twilio-scenario-1783462919029`; both runs reported `7/7` scenarios passing.
- Live deterministic Twilio validation on 2026-07-07 used the same tunnel for two medical examiner tests. Session `CA64d9eee91166f699c0e4aa5d01d63946` let the software drive the call and reached `ESCALATE`, completed CRM plus dispatch, asked for the ME case number correctly, and stored investigator `Sean Mullins`, callback `214-639-2463`, decedent `Robert Jones`, case `2611232`, and ME/emergency context. Replay exposed cleanup targets: `T County Medical Examiner's Office` did not normalize to Tarrant County, and the address transcript `6:32. South Main Street...` stored as `32 South Main Street...`.
- The second live test, session `CA9158e57a31e15102911a29899e20d619`, used a stream-of-thought first turn and also reached `ESCALATE` with CRM plus dispatch. It successfully corrected `Kyle Finny` to `Kyle Finney` after spelling and collected case `2611232`, but replay showed the first long turn did not harvest all available facts from `ready to be picked up... transported to Smith Family Funeral Home... currently at the address...`; it also left `Tirant County Medical Examiner's Office` unnormalized.
- Follow-up live-ME stream handling commit `040bdaa` now normalizes `T County` and `Tirant County` ME variants to `Tarrant County Medical Examiner's Office`, repairs punctuated time-like street numbers such as `6:32. South Main` to `632 South Main`, captures `ready to be picked up` decedent phrasing, captures `transported to Smith Family, Funeral Home` as requested funeral home, and harvests `currently at the address 636 South Main Street in Keller Texas` without retaining callback cue words. Validation after this change: `npm run build && npm test` passed `239/239`.
- Post-restart targeted public smokes on 2026-07-07 used tunnel `https://vessel-enrollment-garcia-floors.trycloudflare.com` and server commit `040bdaa`. Synthetic session `twilio-public-me-guided-live-shape-1783463697` verified the guided ME call stores `Tarrant County Medical Examiner's Office` and `632 South Main Street Keller Texas`; synthetic session `twilio-public-me-stream-live-shape-1783463697` verified the stream-of-thought ME call captures caller `Kyle Finney`, facility `Tarrant County Medical Examiner's Office`, decedent `Robert Jones`, requested funeral home `Smith Family Funeral Home`, pickup address `636 South Main Street Keller Texas`, case `2611232`, no missing handoff facts, and CRM plus dispatch.
- Public scenario-matrix regression on server commit `040bdaa` passed `7/7` through the same tunnel with run id `twilio-scenario-1783463716334`.
- Current live local Twilio tunnel after this fix: `https://vessel-enrollment-garcia-floors.trycloudflare.com`; webhook `https://vessel-enrollment-garcia-floors.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`; local server commit `040bdaa`; runtime `fh-demo` urgent on-call handoff is configured to `+16037315845`.
- Post-restart alignment on 2026-07-07 confirmed the active TypeScript voice platform track at commit `8e0663a` with local server build metadata `local-twilio-live-test`. Validation passed: `npm run build`, `npm test` (`243/243`), local Twilio readiness, basic Twilio webhook smoke, local scenario matrix (`twilio-scenario-1783466097708`, `7/7`), public tunnel readiness, and public scenario matrix (`twilio-scenario-1783466130465`, `7/7`).
- Current live local Twilio tunnel for the next phone-audio test: `https://resident-teeth-then-entitled.trycloudflare.com`; webhook `https://resident-teeth-then-entitled.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`; runtime `fh-demo` urgent on-call handoff remains configured to the local test cell. Public readiness is green for unsigned local testing; persistent public traffic still requires Twilio signature verification.
- The medical-examiner missing-case live gap is considered closed by the guided and stream-of-thought live tests plus targeted public smokes. Next live phone validation target should be a non-ME lane, preferably family-at-home authority-check or hospice residence, to confirm the broader scenario matrix remains stable in real audio after the latest hardening.
- Live deterministic Twilio validation on 2026-07-07 used tunnel `https://resident-teeth-then-entitled.trycloudflare.com` for a family-at-home authority-check call. Session `CAd124672ab52d132aa79bca707bcfeea8` reached `ESCALATE`, corrected caller `Kyle Finny` to `Kyle Finney` after spelling, stored callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, `currently_with_decedent: true`, requested funeral home, and residence pickup address; completed only `crm.create_intake_lead`; skipped `dispatch.create_removal_request`; included the authority-verification recommendation; and had no missing handoff facts. Replay exposed two quiet cleanup targets: pickup address retained trailing `and I`, and requested funeral home stored as `We Would Like Smith Family Funeral Home`.
- Follow-up family authority-check cleanup now strips trailing presence fragments such as `and I'm here with him now` from pickup addresses and normalizes request prefixes such as `we would like` from funeral-home names. The exact live shape is pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `245/245`. The patched local server was restarted, public readiness passed, and public scenario matrix passed `7/7` through the same tunnel with run id `twilio-scenario-1783466493263`.
- Live deterministic Twilio validation on 2026-07-08 used fresh tunnel `https://native-estate-portrait-engage.trycloudflare.com` for a hospice residence report with named funeral home. Session `CAf46abe83abbb0a41f5a49bbdf9326f4e` reached `ESCALATE` from the first substantive caller turn, had no warnings and no missing handoff facts, stored nurse `Emily Johnson`, callback `214-639-5723`, facility `Gentle Care Hospice`, relationship `facility_staff`, decedent `Robert Jones`, pickup address `636 Commerce Avenue Keller Texas`, place type `hospice`, `currently_with_decedent: true`, requested funeral home `Smith Family Funeral Home`, and completed both `crm.create_intake_lead` and `dispatch.create_removal_request`. Caller-side experience was reported flawless, and replay showed no cleanup target from this call.
- Live deterministic Twilio validation on 2026-07-08 then covered the hospital-release and police-residence lanes through the same tunnel. Hospital session `CAd6f163c28f6c888cd4fbbf5426f12736` reached `ESCALATE`, completed CRM plus dispatch, stored caller `David Carter`, callback `214-639-5723`, facility `Sunrise Hospital`, decedent `Helen Brooks`, requested funeral home `Your Funeral Home`, hospital place type, and urgent context. Police session `CA17db3450845b6841f7a01aeefc8623b1` reached `ESCALATE`, completed CRM plus dispatch, stored caller `Officer Mendes`, callback `817-632-4211`, facility `Fort Worth Police Department`, facility role `officer`, residence pickup `5213 Hidden Oaks Lane Fort Worth Texas`, and no authority-verification recommendation. The caller-side experience was reported successful for both calls.
- Follow-up hospital/police cleanup now strips repeated `pickup/address is` prefixes from spoken addresses, infers `currently_with_decedent: true` for official facility-staff release calls that provide a pickup address, and drops trailing pronoun filler from spoken decedent names such as `Elizabeth Carter She`. The exact hospital and officer live shapes are pinned in extractor and Twilio webhook regressions. Validation after this change: `npm run build` and `npm test` passed `249/249`.
- Live deterministic Twilio validation on 2026-07-08 then covered the two non-death routing lanes through tunnel `https://particular-volleyball-pie-warren.trycloudflare.com`. Pricing session `CA1d3b8c734b565eddbf13a808fbe5791d` reached `WRAPUP`, classified as `pricing_or_billing`, stored `death_reported: false`, caller `Kyle Smith`, callback `603-731-5845`, routine urgency, and completed only `crm.create_intake_lead` with no dispatch or human handoff. Existing-family office-hours session `CA38fc176858f4698fe25f98e87815a93d` reached `WRAPUP`, classified as `service_schedule_question`, stored `death_reported: false`, caller `Kyle Finny`, callback `603-731-5845`, father/decedent context `Robert Finny`, clothing drop-off preference, routine urgency, and completed only `crm.create_intake_lead` with no dispatch or human handoff. Caller-side experience was reported flawless for both calls.
- Follow-up non-death routing cleanup now suppresses `requested_funeral_home` capture for routine inquiry intents so phrases such as `the funeral home is already helping our family` remain context, not a new-removal funeral-home request. The office-hours live shape is pinned in extractor, Twilio webhook, and scenario-matrix regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `249/249`.
- The patched local server was restarted on commit `21c43a3` with tunnel `https://simon-doc-electoral-delegation.trycloudflare.com`. Local and public Twilio readiness passed, and the updated public scenario matrix passed `7/7` with run id `twilio-scenario-1783555088341`, including the new assertion that routine office-hours calls do not store `requested_funeral_home`.
- Production-readiness signed-webhook rehearsal on 2026-07-08 restarted the local Twilio server with `TELEPHONY_WEBHOOK_SECRETS=twilio:test-auth-token` and tunnel `https://dennis-tariff-opportunities-characterized.trycloudflare.com`. Local and public readiness reported `signed_webhook` with public traffic ready; an unsigned public webhook returned `401 WEBHOOK_SIGNATURE_INVALID`; signed webhook smoke passed with session `twilio-signed-smoke-1783555400`; and the signed public scenario matrix passed `7/7` with run id `twilio-signed-scenario-1783555300`.
- Follow-up signed-smoke hardening now makes `npm run smoke:twilio` automatically verify unsigned Twilio webhook rejection whenever `TWILIO_EXPECT_SIGNED_WEBHOOK=true`. Validation after this script change: signed public webhook smoke passed and `npm test` passed `249/249`.
- Real Twilio Auth Token local setup was validated on 2026-07-08 after converting the user's rich-text `Untitled.rtf` into ignored plaintext `.env.local`. The local server restarted in signed mode without exposing the secret, tunnel `https://articles-hits-structure-feeding.trycloudflare.com` passed public readiness with `signed_webhook`, signed webhook smoke passed with session `twilio-real-signed-smoke-1783556200`, and signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783556200`.
- Real Twilio phone-number webhook validation on 2026-07-08 used the same signed tunnel after the Twilio Console Voice webhook was updated. Session `CA72afcaeff61d4c283cb8bd79d8382b31` was accepted by signed webhook verification, reached `ESCALATE`, completed both `crm.create_intake_lead` and `dispatch.create_removal_request`, and captured officer/facility context, callback `603-731-5845`, decedent `John Smith`, and pickup `636 Commerce Avenue Keller Texas`. Replay exposed one quiet cleanup target: contextual caller-name fallback could treat `I am reporting a death` as a fuller name and overwrite the correct officer name with `Reporting A Death`.
- Follow-up real signed-call cleanup now rejects operational phrases such as `reporting a death` as contextual name-only answers and pins the signed-live officer opening shape in extractor and Twilio route regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `250/250`.
- The patched signed local server was restarted on commit `d120387`. The first post-restart quick tunnel (`https://generous-rapids-use-exports.trycloudflare.com`) did not resolve publicly, so it was rotated to `https://editing-minor-submit-consulting.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783557200`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783557200`. Current verified webhook for the next real Twilio phone call: `https://editing-minor-submit-consulting.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number webhook validation on 2026-07-08 then used the rotated signed tunnel for a hospice ready-for-pickup call. Session `CAd7b3ddf00c9c54901f40d7481376802c` was accepted by signed webhook verification, reached `ESCALATE`, completed both `crm.create_intake_lead` and `dispatch.create_removal_request`, and captured nurse `Jackie Johnson`, callback `817-432-5629`, facility `Gentle Care Hospice`, decedent `Robert Johnson`, pickup `1575 South Main Street Fort Worth Texas`, hospice place type, and `currently_with_decedent: true`. Replay exposed one quiet cleanup target: the phrase `he is ready for pickup` should infer the called funeral home as the requested funeral home for facility-staff death reports.
- Follow-up hospice ready-for-pickup cleanup now infers `requested_funeral_home: Your Funeral Home` for facility-staff death reports with ready-for-pickup phrasing, while leaving routine inquiry funeral-home mentions suppressed. The exact live shape is pinned in extractor and Twilio route regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `252/252`.
- The patched signed local server was restarted on commit `afc61d2` with tunnel `https://dot-duration-badge-probe.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783557700`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783557700`. Current verified webhook for the next real Twilio phone call: `https://dot-duration-badge-probe.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-08 confirmed the hospice ready-for-pickup cleanup through the same signed tunnel. Session `CAc4cd10ef863e0264a9dac3a482975c88` reached `ESCALATE` with no missing handoff facts, stored `requested_funeral_home: Your Funeral Home` without the caller naming a funeral home, captured nurse `Jackie Johnson`, callback `817-432-5629`, facility `Gentle Care Hospice`, decedent `Robert Johnson`, pickup `1575 South Main Street Fort Worth Texas`, hospice place type, and `currently_with_decedent: true`, and completed both `crm.create_intake_lead` and `dispatch.create_removal_request`.
- Real Twilio phone-number validation on 2026-07-08 then confirmed the signed family-at-home authority-check lane. Session `CA7ca945efe91bcfaefcb5ac62513e4667` reached `ESCALATE` with no missing handoff facts, corrected caller `Kyle Finny` to `Kyle Finney` after spelling, captured callback `603-731-5845`, relationship `father`, decedent `Robert Jones`, `currently_with_decedent: true`, requested funeral home `Smith Family Funeral Home`, and pickup `636 Commerce Avenue Keller Texas`. It completed `crm.create_intake_lead`, skipped the repeated CRM request after final address collection, and did not request `dispatch.create_removal_request`, matching the family residence authority-review expectation.
- On 2026-07-09 the prior quick tunnel began producing Twilio app errors after Cloudflare edge connectivity failures. The first replacement quick tunnel (`https://consultants-quality-basically-couples.trycloudflare.com`) did not resolve publicly, so it was rotated to `https://considered-eve-ranging-enables.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783638850`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783638850`. Current verified webhook for the next real Twilio phone call: `https://considered-eve-ranging-enables.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-09 confirmed the signed pricing-routine lane through the rotated tunnel. Session `CAc6b8d97331b3ac5092427e35d8b0a99a` reached `WRAPUP`, classified as `pricing_or_billing`, stored `death_reported: false`, `urgency: routine`, caller `Kyle Smith`, callback `603-731-5845`, and completed only `crm.create_intake_lead` with no dispatch or human escalation. The caller-side experience was reported flawless. Replay exposed one quiet cleanup target: the opening phrase `My name is Kyle Smith calling to ask...` should capture the caller name on the first turn and ask only for the callback number.
- Follow-up pricing-routine cleanup now treats `calling` as a caller-name boundary in the deterministic extractor and contextual slot parser, so `My name is Kyle Smith calling to ask...` stores `Kyle Smith` immediately. The exact live shape is pinned in extractor and Twilio route regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `254/254`.
- The patched signed local server was restarted on commit `09f4184` with tunnel `https://group-dylan-becoming-brussels.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783640000`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783640000`. Current verified webhook for the next real Twilio phone call: `https://group-dylan-becoming-brussels.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-09 confirmed the pricing caller-name cleanup through the patched signed tunnel. Session `CAafe6f7c349f6f0df5bc1939dae441ee8` captured `Kyle Smith` on the opening `my name is... I'm calling to ask...` turn, asked only for the callback number, reached `WRAPUP`, stored callback `603-731-5845`, kept `death_reported: false` and `urgency: routine`, and completed only `crm.create_intake_lead` with no dispatch or human escalation.
- Real Twilio phone-number validation on 2026-07-09 confirmed the signed hospital-release one-turn lane through the same patched tunnel. Session `CAa12bff20781a2afef7fda0b1b7e302b1` reached `ESCALATE` from the opening turn with no warnings or missing facts, captured caller `David Carter`, callback `214-639-5723`, facility `Sunrise Hospital`, decedent `Helen Brooks`, pickup `500 Medical Center Drive Fort Worth Texas`, hospital place type, `currently_with_decedent: true`, and `requested_funeral_home: Your Funeral Home`, then completed both `crm.create_intake_lead` and `dispatch.create_removal_request`.
- Real Twilio phone-number validation on 2026-07-09 confirmed the signed medical-examiner missing-case-number lane through the same patched tunnel. Session `CA34aadff6ebbaadd1e2f8bf8bc74c1552` asked for the case number, then the pickup location, then reached `ESCALATE` with no missing facts. It captured caller `Maria Lopez`, callback `603-731-5845`, role `investigator`, decedent `Robert Jones`, case `2611232`, medical-examiner place type, `currently_with_decedent: true`, requested funeral home `The Smith Family Funeral Home`, normalized pickup `200 Feliks Gwozdz Place Fort Worth Texas`, completed `crm.create_intake_lead` before location collection, and completed `dispatch.create_removal_request` after location. Replay exposed one quiet cleanup target: `tent County Medical Examiner` should store the normalized facility name.
- Follow-up medical-examiner cleanup now treats bare `medical examiner` as a facility suffix and normalizes `Terry/Tent/Tenant/Tirant County Medical Examiner` to `Tarrant County Medical Examiner's Office`, matching the existing office-suffix behavior. The exact live shape is pinned in extractor and Twilio route regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `256/256`.
- The patched signed local server was restarted on commit `afa577f`. The first post-restart quick tunnel (`https://linda-eric-focus-stud.trycloudflare.com`) did not resolve publicly, so it was rotated to `https://holiday-denver-dispatched-albuquerque.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783641000`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783641000`. Current verified webhook for the next real Twilio phone call: `https://holiday-denver-dispatched-albuquerque.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-09 confirmed the signed police-residence lane through the rotated signed tunnel. Session `CA4e30f83ae77768117db4d49bf5f3d347` captured caller `Officer Mendes`, callback `817-632-4211`, Fort Worth Police Department, pickup `5213 Hidden Oaks Lane Fort Worth Texas`, residence place type, and `currently_with_decedent: true`, asked one follow-up for decedent name after Twilio heard `and her name is` as `mid seed's name is`, then reached `ESCALATE` and completed both `crm.create_intake_lead` and `dispatch.create_removal_request`. Replay exposed one quiet cleanup target: `mid seed's name is Elizabeth Carter` should be treated as a decedent-name cue.
- Follow-up police-residence cleanup now treats `mid seed's name is...` as a decedent-name cue, matching the live STT miss for `and her name is...`. The exact live shape is pinned in extractor and Twilio route regressions. Validation after this change: `npm run build`, focused extractor/http-server tests, and `npm test` passed `258/258`.
- The patched signed local server was restarted on commit `42a42d2` with tunnel `https://among-learners-biblical-infrastructure.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783641400`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783641400`. Current verified webhook for the next real Twilio phone call: `https://among-learners-biblical-infrastructure.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-09 confirmed the signed family-at-home authority-check lane through the patched signed tunnel. Session `CA538d13ff486985bf434e6072ea04476f` captured callback `603-731-5845`, corrected caller `Kyle Finny` to `Kyle Finney` after spelling confirmation, relationship `father`, decedent `Robert Jones`, pickup `636 Commerce Avenue Keller Texas`, residence place type, `currently_with_decedent: true`, and requested funeral home `Smith Family Funeral Home`. It reached `ESCALATE` with no missing facts, completed only `crm.create_intake_lead`, and did not request `dispatch.create_removal_request`, matching the family-residence authority-review expectation.
- On 2026-07-09 the signed quick tunnel `https://among-learners-biblical-infrastructure.trycloudflare.com` began producing Twilio app errors after public DNS/readiness failed and the tunnel needed rotation. It was replaced with `https://tutorial-devoted-aspects-address.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783641800`, and the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783641800`. Current verified webhook for the next real Twilio phone call: `https://tutorial-devoted-aspects-address.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-09 covered the existing-family office-hours lane through the restored signed tunnel. Session `CA235c39a67e3f13dea4bdd4b95a85b542` safely reached `WRAPUP`, completed only `crm.create_intake_lead`, and did not request dispatch or human escalation. Replay exposed a routing polish target: Twilio heard `not a new death call or an emergency` as `not a new death caller, an emergency`, so the first turn briefly entered first-call collection before the later decedent context closed as routine.
- Follow-up office-hours cleanup commit `d8abdb7` now treats `death caller` as an STT false friend for negated `death call or` phrases and captures `my father Robert Finny is already in your care` as existing-family decedent context. The exact live shape is pinned in extractor and Twilio route regressions. Validation after this change: `npm run build`, focused tests, and `npm test` passed `260/260`.
- The patched signed local server was restarted on commit `d8abdb7` with tunnel `https://renaissance-portraits-fifth-adjustment.trycloudflare.com`. Public readiness passed in `signed_webhook` mode, signed webhook smoke passed with session `twilio-real-signed-smoke-1783642400`, the signed public scenario matrix passed `7/7` with run id `twilio-real-signed-scenario-1783642400`, and exact signed public simulation of the death-caller office-hours transcript passed with session `twilio-real-signed-death-caller-office-hours-1783642400`. Current verified webhook for the next real Twilio phone call: `https://renaissance-portraits-fifth-adjustment.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook`.
- Real Twilio phone-number validation on 2026-07-09 confirmed the signed office-hours cleanup through the patched tunnel. Session `CA6d062c44e540869f2751a9256c814895` reached `WRAPUP` in one turn, classified as `service_schedule_question`, captured caller/decedent family context, callback `603-731-5845`, `dropoff_preference`, `death_reported: false`, `urgency: routine`, and `place_of_death_type: unknown`; completed only `crm.create_intake_lead`; and did not request dispatch or human escalation.
- Real Twilio phone-number validation on 2026-07-11 covered hospice residence and family-at-home authority-check calls through signed tunnel `https://cookbook-perry-comprehensive-finger.trycloudflare.com`. Hospice session `CA6d36588885c6bb164cac60043b5fea27` reached `ESCALATE` with no missing facts or tool failures, captured nurse Emily Johnson, Gentle Care Hospice, callback `214-639-5723`, decedent Robert Jones, pickup `636 Commerce Avenue Keller Texas`, presence, and Smith Family Funeral Home, and completed both CRM and dispatch. Family session `CA807e3f7f3f00fa4a6ea89b0e5dc1f0a8` reached `ESCALATE` with no missing facts or tool failures, captured the family/decedent/presence/funeral-home/location facts, completed only CRM, skipped dispatch, and included the required authority-verification recommendation. An interrupted middle call, `CA1575e271671a283c58b5f12abdbf60bb`, is intentionally ignored. The family call exposed one cleanup target: Twilio transcribed `F as in Frank, I N N E Y`, and the spelling parser dropped the cue's leading `F`, storing `Kyle Inney`.
- Follow-up spelling cleanup now collapses letter cues such as `F as in Frank` into the intended single letter before reconstructing a spelled surname. The exact live transcript is pinned in the first-call API regressions. Validation after this change: `npm run build`, focused spelling/authority tests, and `npm test` passed `261/261`.
- Real Twilio phone-number retest on 2026-07-11 used the patched signed runtime for family-at-home session `CAdc0e24ef8bdf5757d888948fe45ebb61`. Safety routing remained correct: the call reached `ESCALATE` with no missing handoff facts or tool failures, completed only CRM, skipped dispatch, and included authority verification. Twilio merged the spelling answer and next response into one transcript (`F as in Frank, I N N E Y My Father Robert Jones...`), so the first patch did not correct `Kyle Finny` because the parser expected the spelled letters to end the turn.
- Follow-up merged-turn cleanup now consumes a leading run of spelled single letters and leaves the remaining transcript available for first-call fact extraction. The exact combined live transcript is pinned in regression coverage and captures corrected caller `Kyle Finney` plus relationship, decedent, presence, and requested funeral home from the same turn. Validation: focused spelling/authority tests and the full suite passed `261/261`.
- Real Twilio phone-number validation on 2026-07-11 closed the surname-spelling issue on patched session `CA6b4cf5e1062c9d490466105e7a6c60ee`. Twilio transcribed the correction as `Last name is spelled f as in Frank, i n n e y.`; the runtime stored and propagated `Kyle Finney`, marked spelling confirmed, and preserved callback, father relationship, Robert Jones, caller presence, Smith Family Funeral Home, and `636 Commerce Avenue Keller Texas`. The family-at-home call reached `ESCALATE` with no missing facts, warnings, or tool failures; completed only CRM; skipped dispatch; and included the required hospice/law-enforcement/medical-examiner authority-verification recommendation. This live cleanup target is closed.

Ignored `.env.local` example:

```sh
FIRST_CALL_EXTRACTOR=openai
OPENAI_API_KEY=<OPENAI_API_KEY>
OPENAI_MODEL=
OPENAI_TIMEOUT_MS=20000
```

Run live OpenAI extraction smoke:

```sh
FIRST_CALL_EXTRACTOR=openai npm run smoke:extraction
```

## Telnyx Support Ticket Sent

A support request was sent to Telnyx with this core issue:

```text
Inbound calls to +18177651780 are failing with USER_BUSY / SIP 486 / send_refuse / Telnyx error D61.

The phone number API shows:
phone_number: +18177651780
status: active
connection_id: 2978840550146311580
connection_name: Funeral Home voice-AI dev

The Call Control application API shows:
id: 2978840550146311580
active: true
webhook_event_url: current Cloudflare tunnel webhook URL
webhook_api_version: 2

But new inbound CDR rows show blank Connection Id, blank Connection name, and blank Call Control Id. The calls are refused before reaching the Voice API application. The webhook URL is reachable and responds successfully when tested directly.
```

Recent failed Call UUIDs from screenshots:

- `ecd3313a-6463-11f1-826f-02420aef3720`
- `884a7010-6464-11f1-a11a-02420aef3220`
- `7647bb42-6508-11f1-ae2b-02420aef3520`
- `7917e160-6508-11f1-8f06-02420aef3520`
- `178338a-652a-11f1-8093-02420aef38a1`

## Next Recommended Steps

1. Continue live phone validation with one non-ME lane next, preferably family-at-home authority-check or hospice residence, now that the ME guided and stream-of-thought variants have fresh regressions.
2. Use `npm run smoke:twilio-scenarios` as the recurring regression smoke after each call-lane patch and before live phone tests.
3. Continue expanding confirmation flows for suspicious fields found in live calls, especially unusual street names, city names, facility names, and repeated name/contact prompts.
4. Start shaping production deployment: stable HTTPS endpoint or named tunnel, Twilio signature verification, secret management, and durable persistence.
5. Replace temporary Cloudflare quick tunnels with a stable HTTPS deployment endpoint or named tunnel.
6. Wait for Telnyx support response about `D61`, SIP `486`, and blank connection fields in fresh inbound CDR rows.
7. Decide whether to fold the separate funeral-home onboarding materials workspace into this GitHub repo or keep it as a companion artifact set.

## LanternBell Named Cloudflare Tunnel

- On 2026-07-13, Cloudflare authorization completed for the newly registered `lanternbell.com` zone.
- Created named tunnel `lanternbell-voice` with tunnel ID `83936dcc-8360-459d-b2f9-f955bd477db1`.
- Added the Cloudflare DNS route `voice.lanternbell.com` to the named tunnel.
- Local ingress configuration is stored outside the repository at `~/.cloudflared/config.yml` and routes the hostname to `http://127.0.0.1:3000` with a terminal `http_status:404` fallback.
- The tunnel credential JSON and origin certificate remain outside the repository in `~/.cloudflared/`; never commit them.
- Signed readiness passed through `https://voice.lanternbell.com` in `signed_webhook` mode with public traffic ready.
- Signed Twilio webhook smoke passed with session `lanternbell-named-tunnel-smoke-1783989187`.
- The full signed public scenario matrix passed `7/7` with run ID `lanternbell-named-tunnel-1783989193`.
- Stable Twilio Voice webhook URL ready for configuration:
  `https://voice.lanternbell.com/v1/tenants/fh-demo/telephony/twilio/webhook`
- The named tunnel is currently running interactively. Install persistent process supervision for both the TypeScript server and `cloudflared` before relying on unattended traffic.
- First real phone validation through the permanent hostname on 2026-07-13 used session `CA6f2dddd3b962e4da82c1a9fdf950cff8`. The police-residence call reached `ESCALATE`, captured caller/facility/decedent/funeral-home/address facts, and completed CRM plus dispatch without tool failures. It exposed two deterministic cleanup targets: `Person's name is Elizabeth Jones` required a redundant bare-name answer, and `here at a death scene` did not set `currently_with_decedent`.
- Follow-up cleanup accepts `person's name is...` and `decedent's name is...` during the active decedent slot and treats an official facility caller who says they are at a death scene as present with the decedent. The exact live shape is pinned in extractor and HTTP regressions. Validation passed `npm run build`, focused tests (`166/166`), and the full suite (`263/263`).
- Signed public replay of the exact live shape passed through `voice.lanternbell.com` with session `lanternbell-live-officer-fix-1783989860035`: no missing handoff facts, CRM plus dispatch completed, and no tool failures. The post-fix signed public scenario matrix passed `7/7` with run ID `lanternbell-post-live-fix-1783989865`.
- On 2026-07-21, added macOS user-level supervision for the local TypeScript service and named Cloudflare tunnel. LaunchAgent labels are `com.lanternbell.voice-ai` and `com.lanternbell.cloudflared`; logs are under `~/Library/Logs/LanternBell/`.
- macOS background privacy controls blocked LaunchAgents from using the source checkout under `Documents`, so the supervised compiled runtime now lives at `~/Library/Application Support/LanternBell/` with owner-only root and secret-file permissions. Source remains in the repository. `npm run deploy:macos-local` builds and refreshes the runtime without overwriting its durable call data after initial migration.
- Pinned npm wrapper `cloudflared@0.7.1`, which deployed Cloudflare binary `2026.7.2`, and added `npm run start:cloudflare-named` for manual named-tunnel startup.
- Updated the local Twilio startup wrapper to launch the compiled Node entry point directly and forward termination signals cleanly. Added the service runbook at `docs/runbooks/macos-local-services.md`.
- Supervision validation deliberately killed both the TypeScript server child and Cloudflare tunnel. Both LaunchAgents restarted automatically and restored the public health endpoint in four seconds.
- Post-recovery signed public webhook smoke passed with session `lanternbell-supervised-smoke-1784680146`; the signed public scenario matrix passed `7/7` with run ID `lanternbell-supervised-1784680147`. Full TypeScript validation remains `263/263`.
- These LaunchAgents start after the macOS user logs in. They are appropriate for continued development and controlled tests, but a logged-out or powered-off Mac remains unavailable; unattended production still requires cloud deployment.

## Production Hardening Notes

Before real production traffic:

- Configure Telnyx webhook signature verification with `TELEPHONY_WEBHOOK_SECRETS`.
- Replace temporary Cloudflare quick tunnels with a stable HTTPS deployment endpoint or a named Cloudflare tunnel.
- Move secrets to a proper secret manager or deployment environment variables.
- Add observability for provider command failure summaries and call lifecycle alerts.
- Complete a managed PostgreSQL backup-and-restore drill before accepting customer data.

## 2026-07-28 Render cloud foundation

- Selected Render as the first always-on hosting target for the TypeScript service because its Blueprint can define the Node web service, managed PostgreSQL, private database connection, health check, and secret placeholders together.
- Added a production `postgres` persistence driver behind the existing `SessionStore`, `EventStore`, and `IdempotencyStore` interfaces. Call orchestration and telephony behavior remain unchanged.
- Added tenant-scoped PostgreSQL tables and indexes for latest session state, append-only events, and idempotency replay records.
- Added a versioned startup migration protected by a PostgreSQL advisory transaction lock so concurrent deploy instances cannot race schema setup.
- Event writes are transactional and duplicate `(tenant_id, event_id)` deliveries are ignored.
- Added `HOST` configuration. Local startup still defaults to `127.0.0.1`; Render uses `0.0.0.0`.
- Graceful shutdown now drains HTTP and closes the PostgreSQL pool.
- Added `render.yaml` for a Starter Node service and Basic managed PostgreSQL in the Ohio region. The database blocks public IP access and is injected through Render's internal connection string.
- Added `docs/runbooks/render-cloud-deployment.md` with secret setup, temporary-host validation, custom-domain cutover, signed Twilio validation, rollback, and database restore-drill requirements.
- Added PostgreSQL integration coverage using an in-memory PostgreSQL-compatible test database, including migrations, updates, tenant isolation, duplicate event delivery, and idempotency records.
- `render.yaml` passes Render's official JSON Schema validation.

## 2026-07-28 Render cloud deployment

- Deployed Blueprint `LanternBellVoice` to Render from GitHub repository `kpfinney10-arch/Customer_Service_Voice`.
- Created Starter web service `lanternbell-voice` and Basic-256mb PostgreSQL database `lanternbell-voice-db` in the Ohio region. The accepted Render estimate is `$17.50/month`.
- Temporary cloud endpoint: `https://lanternbell-voice.onrender.com`.
- Render resource IDs:
  - Blueprint: `exs-d9kjsudaeets739k00v0`
  - Web service: `srv-d9kk0itaeets739k727g`
  - PostgreSQL: `dpg-d9kk09laeets739k6c4g-a`
- The first build failed because Render's production `NODE_ENV` caused plain `npm ci` to omit TypeScript build dependencies. Commit `5c602fb` changed the Blueprint build command to `npm ci --include=dev && npm run build`.
- The corrected deployment reached Live status on commit `5c602fb`, and the PostgreSQL database reached Available status.
- Cloud health returned HTTP 200. Authenticated Twilio readiness returned HTTP 200 with tenant readiness, `signed_webhook` mode, and `publicReady: true`.
- A fully signed Twilio webhook smoke test passed against the Render hostname with session `render-cloud-smoke-1785282920137`. The call reached `ESCALATE`, produced six persisted events, completed escalation behavior, and replayed successfully from PostgreSQL.
- The generated `fh-demo` tenant API key is stored in macOS Keychain under service `LanternBell Render Tenant API Key`; no secret values are committed.
- Render currently contains test-only routing numbers (`+15555550100` and `+15555550101`).
- The repository was connected to Render by public Git URL rather than the installed GitHub integration. Blueprint changes therefore require a manual Blueprint sync and approval in Render.
- Cloudflare DNS and the Twilio phone-number webhook have not been changed. The existing Mac-hosted service behind the named Cloudflare tunnel remains the live phone path.

## 2026-07-28 Render demo handoff mode

- Confirmed the current phase is demo/testing. The existing Twilio number is the inbound number callers use to reach the AI; no separate human transfer destination is required yet.
- Added explicit `TWILIO_HANDOFF_MODE=simulate` to the Render Blueprint.
- In simulation mode, the TypeScript workflow still reaches `ESCALATE` and records its handoff, CRM, dispatch, event, and PostgreSQL state normally.
- Twilio receives a caller-safe demo message and `<Hangup/>`; it receives no `<Dial>` verb and no placeholder destination.
- Live mode remains available for a later controlled bridge test using a separate consenting cell phone. The inbound Twilio number must not be used as its own transfer destination because that can loop back into the AI.
- Invalid handoff modes fail startup validation instead of silently enabling live dialing.
- Validation passed the TypeScript build and the full `273/273` test suite, including end-to-end webhook coverage proving that the session remains escalated while no dial command is emitted.
- Render deployed demo-handoff commit `79501cd`. Signed readiness reported `signed_webhook`, `handoffMode: simulate`, and public readiness; signed smoke session `render-demo-simulated-smoke-1785283647` reached escalation, persisted successfully, and returned no dial command.
- The first signed cloud scenario-matrix run exposed deterministic replay ordering rather than a workflow failure: the hospital scenario completed CRM and dispatch, but two events with identical millisecond timestamps replayed in event-ID order.
- Added PostgreSQL migration `002_stable_event_sequence` and now order equal-time events by database insertion sequence. This preserves actual append order for replay and diagnostics.
- Updated all Twilio smoke scripts to accept `TWILIO_EXPECT_HANDOFF_MODE=live|simulate`; simulated scenarios expect the demo message and hangup instead of a dial command.
- Added explicit TypeScript `node` and `pg` type selection so macOS-generated duplicate dependency folders cannot break local builds. Full validation remains `273/273`.
- Render deployed commit `c4643eb`; the build passed, migration `002_stable_event_sequence` completed in pre-deploy, the service reached Live status, and `/health` returned HTTP 200.
- Post-migration signed readiness passed with `signed_webhook`, `handoffMode: simulate`, and public readiness.
- Signed simulated-handoff smoke session `render-demo-post-sequence-smoke-1785283854` passed with persisted escalation and no dial command.
- Signed temporary-host scenario run `render-demo-post-sequence-scenarios-1785283855` passed `7/7`, including stable CRM-before-dispatch replay for the previously affected hospital scenario.

## 2026-07-28 Render permanent-hostname cutover

- Added and verified the Render custom domain `voice.lanternbell.com`.
- At approximately `2026-07-28 19:16 CDT`, changed the Cloudflare `voice` CNAME from the named-tunnel target to `lanternbell-voice.onrender.com`.
- The Cloudflare record is DNS-only during Render certificate validation. DNS now resolves to the Render target.
- Render verified the hostname, and HTTPS serves a valid Google Trust Services certificate whose subject is `voice.lanternbell.com`.
- `https://voice.lanternbell.com/health` returns HTTP 200 with `{"ok":true}`.
- Signed readiness passed through the permanent hostname with `signed_webhook`, `handoffMode: simulate`, and public readiness.
- Signed permanent-host webhook smoke session `lanternbell-render-cutover-smoke-1785284296` passed with persisted escalation and no dial command.
- Signed permanent-host scenario run `lanternbell-render-cutover-scenarios-1785284296` passed all `7/7` scenarios.
- The Twilio phone-number webhook URL did not need to change because it already uses the permanent hostname and path.
- The local TypeScript service and named Cloudflare tunnel remain available for rollback, but Cloudflare DNS no longer routes `voice.lanternbell.com` to the Mac.
- Controlled inbound Twilio call `CAe1670388173831ec8474505578338c29` reached the Render service and persisted 21 ordered events in PostgreSQL.
- The call reached `ESCALATE`, captured the officer/callback/facility/decedent/residence details, corrected the caller surname after the spelling prompt, completed `crm.create_intake_lead` and `dispatch.create_removal_request`, and recorded no tool failures.
- The handoff retained `currently_with_decedent` and `requested_funeral_home` as missing details for staff confirmation. The workflow still created a dispatch request for review because the authorized caller and minimum pickup context were present.
- Minor diagnostics cleanup candidate: the session-level `intent` ended as `unknown` after later slot-only turns even though `reasonForCall` remained `first_call_death_report` and the workflow correctly followed the urgent first-call path.
- After the controlled call passed, stopped and disabled `com.lanternbell.cloudflared`. The permanent Render hostname remained healthy.
- Kept `com.lanternbell.voice-ai` running locally on `127.0.0.1:3000` for development and rollback data access; it is no longer a public dependency.

Next action:

1. Decide whether officer/facility death calls should explicitly ask `currently_with_decedent` and `requested_funeral_home` before escalation, or continue leaving them for staff confirmation.
2. Before accepting customer data, complete the managed PostgreSQL backup/restore drill and add uptime plus failed-call alerting.

## 2026-08-01 established intent preservation

- Fixed the diagnostics issue observed in controlled call `CAe1670388173831ec8474505578338c29`: later slot-only turns classified as `unknown` no longer overwrite an established non-unknown session intent.
- Per-turn `INTENT_DETECTED` events remain unchanged and continue recording the extractor's raw result, preserving diagnostic accuracy while the session retains its established routing intent.
- Added a regression assertion to the multi-turn police-residence Twilio route test. The final session must retain `first_call_intake` while the last address-only event may remain `unknown`.
- TypeScript build, focused officer-call regression, and the full `273/273` suite passed.
- Pushed commit `aa85a0f` and manually deployed it to Render. Deployment `dep-d9mvqfbm8hqs73d9digg` reached Live status.
- Signed permanent-host readiness passed in `signed_webhook` mode with `handoffMode: simulate` and public readiness.
- Signed cloud scenario run `lanternbell-intent-fix-1785593214` passed `7/7`.
- The cloud police-residence replay retained session intent `first_call_intake`; its final per-turn extracted intent was `unknown`, CRM and dispatch completed, and no tools failed.

## 2026-08-01 managed PostgreSQL recovery drill

- Confirmed that the paid Basic Render PostgreSQL database has continuous point-in-time recovery with a rolling three-day window.
- Created a logical export from `lanternbell-voice-db`; Render completed the `.dir.tar.gz` export at approximately `2026-08-01 09:15 CDT` and retains it for at least seven days.
- Restored production to the isolated Basic-256mb database `lanternbell-voice-db-restore-drill-20260801` from `2026-08-01 09:10:59 CDT`.
- Temporary recovery database ID: `dpg-d9n0ijrncjis7397hhtg-a`.
- The restored database reached Available status in approximately six minutes. The application remained connected to the original production database throughout the drill.
- Added a read-only TypeScript recovery validator that reports migration versions, aggregate record counts, event-sequence integrity, and orphaned-event counts without printing caller data.
- Validation passed with migrations `001_initial_voice_persistence` and `002_stable_event_sequence`, one tenant, 29 sessions, 331 events, zero missing or duplicate event sequences, and zero orphaned events.
- Temporarily allowed only the validation Mac's public IP on the recovery database. Removed the rule immediately after validation and confirmed that all external traffic was blocked again.
- Deleted the temporary recovery database after validation. The Render account returned to the original web service and production database; the temporary monthly-rate charge ended at deletion.
- Local TypeScript validation command: `npm run validate:postgres-recovery` with `DATABASE_URL` set to the database being checked.

Next action:

1. Add independent uptime monitoring for `https://voice.lanternbell.com/health`.
2. Add call-level alerts for failed provider commands, failed tools, and abnormal call termination.

## 2026-08-01 persisted call-health monitoring

- Added public `GET /health/calls` for one independent external monitor to cover both service availability and persisted call-processing failures.
- The TypeScript probe reads recent PostgreSQL events across tenants and returns only aggregate status. It does not expose tenant, call, session, correlation, provider, tool, payload, or caller identifiers.
- HTTP `503` is returned for a recent `TOOL_FAILED` event, an unsuccessful provider-command result, or an abnormal call end. Normal completions and caller-canceled/disconnected calls remain healthy.
- The default alert window is 1,800 seconds, configurable through validated `CALL_ALERT_WINDOW_SECONDS` values from 300 through 86,400 seconds.
- Added memory, file, and PostgreSQL query coverage plus endpoint, privacy, classification, expiration, and environment-validation tests. TypeScript build and the full `282/282` suite passed.
- Pushed runtime commit `4ae92a2` (`Add persisted call health monitoring`).
- Manually deployed it to Render as `dep-d9n2c261egvs73f8f7i0`; build, PostgreSQL pre-deploy migration, startup, and Render health checks passed, and the deployment reached Live.
- Permanent-host validation returned HTTP 200 from `/health` and `/health/calls`. The call-health snapshot reported a 1,800-second window, zero failures, and no failure categories.

### UptimeRobot activation

- Submitted the independent five-minute monitor for `https://voice.lanternbell.com/health/calls` and delivered alerts to the owner-provided address.
- The owner completed the email confirmation and final activation step.
- Render application logs recorded the first external `GET /health/calls` at `2026-08-01 12:10:45 CDT`; LanternBell returned HTTP 200 in 16 ms.
- After explicit owner approval, temporarily changed monitor `803641498` to `https://voice.lanternbell.com/health/uptimerobot-alert-drill`; the target returned the intended HTTP 404 while the real voice service remained online.
- UptimeRobot detected the controlled failure at `2026-08-01 12:19:44 CDT` and opened incident `341993418261670831` with root cause `404 Not Found`.
- Immediately restored the exact production target `https://voice.lanternbell.com/health/calls`. UptimeRobot detected recovery after 1 minute 16 seconds and returned the monitor to Up.
- The owner confirmed receipt of both the down email and recovery email.
- Final direct validation returned HTTP 200 with a 1,800-second window, zero failures, and no failure categories. Twilio and the voice application were not interrupted during the drill.
- Independent uptime and persisted call-failure monitoring are now activated and end-to-end validated.

## 2026-08-01 operator call-review console

- Added a TypeScript operator console at `/operator/calls` for reviewing recent call handling without using Render logs or raw database queries.
- The console reuses the tenant-authenticated `/v1/tenants/:tenantId/diagnostics/activity` endpoint and shows only redacted session summaries and audit-event metadata.
- The public HTML shell contains no call data. The tenant API key remains in tab-scoped `sessionStorage`, is sent only in an authorization header, and never appears in the URL.
- Added restrictive CSP, no-store caching, clickjacking protection, MIME sniffing protection, no third-party assets, and text-only DOM rendering.
- Local authenticated browser validation loaded a synthetic call and confirmed state, intent, escalation, retry, event, and redaction displays without transcripts or caller details.
- TypeScript build and the full test suite passed `284/284`.

Next action:

1. Open `https://voice.lanternbell.com/operator/calls` and use the console during the next controlled live call.
2. Compare the console summary with the expected lane outcome and capture any missing operator-facing signal as the next UI increment.
3. Before funeral-home staff access the console, replace demo API-key entry with named users, short-lived sessions, role-based authorization, and access auditing.

Deployment update:

- Pushed commit `337b3a9` (`Add operator call review console`) to `main`.
- Manually deployed it to Render as `dep-d9n2skbncjis739bldj0`; the build, PostgreSQL pre-deploy migration, startup, internal health check, and zero-downtime cutover passed.
- Production `GET /operator/calls` returned HTTP 200 with the restrictive security headers and expected LanternBell shell.
- An authenticated production diagnostics check returned five session summaries and five event summaries with no event payloads.
- Production `GET /health/calls` remained HTTP 200 with zero recent failures.

### First operator-console live-call validation

- The owner completed a new controlled call and confirmed it appeared in the production operator console.
- The call ran for approximately one minute, retained `first_call_intake`, used no retries, and finished in `ESCALATE` as intended.
- The replay contained 18 ordered events and one redacted transcript event.
- `crm.create_intake_lead` and `dispatch.create_removal_request` both completed; there were no failed tools.
- The one `TOOL_SKIPPED` event was expected duplicate prevention for CRM with reason `already_completed`, not a failure.
- Staff confirmation still had two missing field names: `currently_with_decedent` and `requested_funeral_home`.
- Production call health remained HTTP 200 with zero failures in the active 30-minute window.

Recommended next product increment:

1. Add a redacted call-detail drawer/page to the operator console showing the complete event timeline, completed/failed tools, and missing fact names.
2. Continue excluding transcript text and captured fact values from the operator display.

## 2026-08-01 redacted operator call-detail view

- Added tenant-authenticated `GET /v1/tenants/:tenantId/diagnostics/sessions/:sessionId` for an operator-safe per-call detail contract.
- The endpoint returns session state, counts, captured/missing fact names, completed/failed tool names, handoff classification, and the complete event-type timeline.
- It does not return captured fact values, caller phone numbers, names, addresses, transcript text, raw event payloads, or the raw handoff object.
- Cross-tenant session access returns `SESSION_NOT_FOUND`, even when the requesting tenant has a valid key.
- Added **Review** actions to call rows and a responsive detail panel with summary metrics, outcome groups, and the full redacted timeline.
- Safe tool metadata distinguishes requested, completed, failed, and skipped operations; skip reasons are limited to an explicit allowlist.
- Local authenticated browser validation confirmed the panel rendered the synthetic call's outcomes while omitting its test names, phone number, address, transcript, and payloads.
- TypeScript build and the full test suite passed `286/286`.

Next action:

1. Reload `https://voice.lanternbell.com/operator/calls` and select **Review** on the most recent real call.
2. Use the detail panel during the next controlled live call to decide whether the next operator increment should focus on filtering, alerts, or staff follow-up status.

Deployment update:

- Pushed commit `46e0b62` (`Add redacted operator call details`) to `main`.
- Manually deployed it to Render as `dep-d9n39v0ae00c73ap86h0`; build, PostgreSQL pre-deploy migration, startup, internal health checks, and zero-downtime cutover passed.
- Production detail validation on the latest real call returned 18 timeline events, both expected completed tools, no failed tools, and the two expected missing fact names.
- The production response contained zero raw event payloads, no session facts object, and no raw handoff object.
- The updated operator JavaScript was live, and production `/health/calls` remained HTTP 200 with zero failures.

## Planned LanternBell master product roadmap

- The owner plans to use Codex as the engineer for rebuilding two existing Lovable-built applications: the CRM and dispatch programs.
- Their code already exists in the GitHub repository, but no decision has been made between modernizing the existing implementations and rebuilding them from scratch.
- That evaluation and implementation will begin only after the current voice application is complete.
- The CRM and dispatch modules should follow the same explicit engineering, security, testing, tenancy, observability, and deployment standards as the voice platform.
- The voice platform's fake CRM and dispatch adapters should remain behind typed contracts so future real modules can replace them without rewriting call orchestration.
- The long-term plan also includes a full web presence: a public launch/customer-acquisition site plus an authenticated gateway for existing customers to access LanternBell products.
- Detailed portal planning is intentionally deferred until after the voice, CRM, and dispatch program decisions.

Architectural implications for current work:

1. Preserve versioned module APIs and event contracts; do not share databases across voice, CRM, and dispatch.
2. Keep tenant identifiers and future organization/user boundaries consistent across modules.
3. Evolve demo API-key access toward named users, short-lived sessions, roles, permissions, and access auditing.
4. Keep public marketing concerns separate from the authenticated customer product gateway.
5. Do not expand the current voice scope prematurely; make present decisions compatible with the roadmap while finishing the voice product first.

Roadmap and scope decision:

- The owner agreed to the recommended sequence: complete Voice to a controlled-pilot production-readiness threshold; audit CRM and Dispatch; establish shared platform foundations; build or modernize CRM; connect Voice to CRM; build or modernize Dispatch; create the public website and authenticated customer gateway; then consolidate onboarding, administration, reporting, support, and billing.
- "Complete Voice" means reliable, secure, observable, recoverable, and ready for a controlled pilot, not theoretically perfect or permanently feature-complete.
- Existing Lovable code will be treated as working product prototypes. Modernization versus replacement will be decided independently for each application only after a structured technical and product audit.
- The authoritative scope boundary is now `docs/PROJECT_SCOPE.md`; the ordered program plan and phase gates are in `docs/architecture/mvp-roadmap.md`.

## 2026-08-02 production Twilio handoff-outcome hardening

- Ran the full signed Twilio scenario matrix against the existing Render deployment before the change. All seven lanes passed under run ID `render-pilot-readiness-1785680625`, and call health remained green.
- Added a signed final `<Dial>` callback so live Twilio transfers record an explicit terminal result instead of treating a dial attempt as a completed handoff.
- Called parties must press `1`; wrong digits and no input are recorded as rejected screening decisions. A Twilio `completed` dial is classified as connected only when the parent session contains the accepted-screening event.
- Terminal outcomes are `connected`, `screening_not_accepted`, `busy`, `no_answer`, `failed`, or `canceled`. Failed outcomes return a caller-safe urgent-follow-up message and hang up cleanly.
- Added append-only `HANDOFF_OUTCOME_RECORDED` events, replay summaries, safe allowlisted operator-timeline fields, and duplicate-delivery protection.
- Aggregate `/health/calls` now reports `handoff_failure` for terminal unaccepted, busy, no-answer, and failed transfers. Caller-canceled transfers remain recorded but do not trigger a platform alert.
- All screening, acceptance, and result callbacks remain covered by Twilio signature verification. Events and operator responses contain no phone destination, caller details, transcripts, or captured intake values.
- TypeScript typecheck, build, and full test suite passed `291/291`.
- Pushed commit `8bb8246` (`Record and recover Twilio handoff outcomes`) to `main`.
- Render deployment `dep-d9nlbgm7bikc73c5j2ag` checked out the correct commit, built successfully, found zero npm vulnerabilities, completed PostgreSQL pre-deploy migration, passed internal health checks, and reached Live.
- The post-deployment signed matrix passed `7/7` under run ID `render-handoff-release-1785681418`.
- A signed synthetic acceptance plus connected-result callback returned HTTP 200 for both callbacks and persisted `screening/accepted` followed by `dial/connected` on the production PostgreSQL timeline without dialing a number.
- The production operator detail returned only the four allowlisted handoff fields, the updated browser client was live, and `/health/calls` returned HTTP 200 with zero failures.
- Render remains deliberately configured with `TWILIO_HANDOFF_MODE=simulate`; no real transfer behavior changed.

Next action:

1. Keep the real-number accepted/rejected/no-answer drill gated until an approved destination and second phone are available.
2. Move next to named operator users, short-lived sessions, role-based authorization, and access auditing before funeral-home staff use the console.

## 2026-08-02 named operator identity and access implementation

- Replaced browser API-key handling with named-user login and server-owned tenant scope. The operator JavaScript no longer reads, stores, or sends a tenant API key and uses no `sessionStorage` or `localStorage` credential path.
- Added `owner`, `operator`, and `viewer` roles with explicit permissions. Active user status, tenant membership, and current role are revalidated on every authenticated request.
- Added salted memory-hard `scrypt` password verification, generic failed-login responses, and a five-attempt/15-minute identity throttle in addition to the HTTP request limiter.
- Added 256-bit opaque sessions with only SHA-256 token digests stored in PostgreSQL. Cookies are `HttpOnly`, `Secure`, `SameSite=Strict`; sessions have a 30-minute idle timeout and eight-hour absolute timeout.
- Added same-origin enforcement for login/logout and durable append-only audits for login success/failure, session expiry, logout, denied access, call-list views, and call-detail views.
- Added PostgreSQL migration `003_operator_identity_and_access` for users, sessions, and audit events. Machine diagnostics retain their API-key boundary, and Twilio remains on signed webhooks.
- Added a hidden-password local provisioning command: `npm run operator:provision -- --email ... --name ... --tenant fh-demo --role owner`. It outputs only the `OPERATOR_USERS_JSON` verifier configuration.
- Documented that this is a narrow Voice pilot identity boundary. CRM/Dispatch audits will decide whether it moves behind a shared LanternBell identity service or external provider; the stable contracts are tenant, user, role, permission, session, and audit.
- Focused TypeScript, HTTP, security, and PostgreSQL tests passed. Production activation is deliberately gated on generating the owner's password verifier outside chat and setting the Render `OPERATOR_USERS_JSON` secret.

Next action:

1. Run the hidden-password provisioning command for `kpfinney10@gmail.com` locally.
2. Add its JSON output to Render as secret `OPERATOR_USERS_JSON`.
3. Commit and push the implementation, allow migration `003` to deploy, then verify named login, activity, detail, logout, access audit persistence, and `/health/calls`.

## 2026-08-02 named operator production activation

- Generated the owner's password verifier locally without placing the plaintext password in chat, source control, or Render configuration, then saved the resulting `OPERATOR_USERS_JSON` value in the existing Render service environment.
- Pushed commit `c10161c` (`Add named operator access control`) to `main` and manually deployed the latest commit because the Render auto-deploy webhook did not start a deployment.
- Render deployment `dep-d9nm71jm8hqs73elm0r0` reached Live after the TypeScript build, PostgreSQL migration `003_operator_identity_and_access`, startup, and internal health checks passed.
- Production `/health` and `/health/calls` returned HTTP 200; call health remained green with zero failures. The operator page retained restrictive CSP, no-store, frame-denial, and content-type security headers, while an unauthenticated session request returned `401 SESSION_REQUIRED`.
- The owner completed the first named production login. The secure cookie session survived navigation and loaded all 20 current redacted call sessions and the recent operational event table.
- A production call-detail review loaded the complete redacted event timeline, completed-tool result, missing-information result, and captured category names without transcript text or captured fact values.
- A direct read-only PostgreSQL audit check confirmed durable successful rows for `LOGIN_SUCCEEDED`, `CALL_ACTIVITY_VIEWED`, and `CALL_DETAIL_VIEWED`. The console was left signed in; logout, expiry, revocation, and denied-access behavior remain covered by the automated HTTP and PostgreSQL suites rather than disrupting the owner's active session.
- Production browser code uses the named session API only and contains no browser API-key storage or authorization-header path.

Next action:

1. Run a controlled-pilot readiness gap review against the documented pilot and production exit criteria.
2. Convert only the remaining launch-blocking gaps into an ordered checklist; keep the real-number handoff drill gated until a second approved phone is available.
3. Prioritize the first evidence-backed gap, expected to be operational latency/repeated-prompt monitoring and a documented privacy/retention decision, before adding lower-value operator workflow features.

## 2026-08-02 controlled-pilot readiness review

- Added `docs/runbooks/controlled-pilot-readiness.md` as the evidence-backed Voice launch checklist and linked it from the live scenario matrix.
- Current decision: **Go** for continued owner-operated production demo calls with simulated handoffs; **No-go** for real funeral-home customer data or live handoffs today.
- Confirmed production `/health/calls` remains HTTP 200 with zero failures, and the named operator session still loads 20 redacted sessions.
- Confirmed one new operational gap directly in production: `/version` returns `commit: "local"` and `buildTime: "local"`, so release identity must be corrected before the pilot go/no-go.
- Completed foundations include signed Twilio traffic, the `7/7` scenario matrix, real-phone lane evidence, deterministic dispatch safety, managed PostgreSQL, restore validation, independent failure alerting, named operator access, tenant authorization, redacted operator detail, and durable access auditing.
- Ordered launch gates are: approve and enforce data retention/deletion; close release-identity, latency/repeated-prompt monitoring, and incident-response gaps; complete the real-phone handoff drill; configure the first non-demo tenant; then rebaseline the exact release and record a formal go/no-go.
- Lower-value operator workflow features remain deferred so Voice does not duplicate future CRM ownership or delay the controlled pilot.
- Readiness-review validation passed TypeScript typecheck, build, and the full `296/296` automated suite.

Next action:

1. Implement gate 2's operational increment: correct Render release identity, add long-latency and repeated-prompt health classification, and create the pilot incident runbook.
2. In parallel with later engineering work, the owner will need to make the gate 1 data-retention decisions before any real customer data is accepted.

## 2026-08-16 pilot observability deployment

- Added exact release identification using Render's runtime commit metadata plus a build-generated timestamp artifact. Safe local fallbacks remain available outside Render.
- Added persisted aggregate `turnDurationMs` on state/escalation events and `PROMPT_REPEATED` events for consecutive empty-speech callbacks. No transcript or captured caller value is added to either signal.
- Extended `/health/calls` with `long_turn_latency` at or above 1,500 ms and `repeated_prompt` at three consecutive no-progress decisions or empty-speech reprompts. The public contract remains aggregate and contains no tenant, session, caller, transcript, prompt, or raw-event data.
- Added `docs/runbooks/pilot-incident-response.md` covering incident ownership, severity, safe evidence, stop-traffic decisions, rollback, recovery, communication, verification, and closure.
- TypeScript typecheck, production build, and the complete automated suite passed `301/301`, including a focused PostgreSQL round-trip for both new call-quality signals.
- Pushed runtime commit `0f626c6` (`Add pilot call quality observability`) to `main`.
- Manually deployed the latest commit because Render's automatic GitHub deployment did not start. Deployment `dep-da0ueq8u01pc73947e1g` checked out the exact commit, found zero npm vulnerabilities, generated build metadata, completed PostgreSQL pre-deploy migration, passed internal health checks, and reached Live.
- Production `/version` returned commit `0f626c6f5ad09dd0f47d6c2ac52e6988bcaf4112` and build time `2026-08-16T16:38:08.498Z`.
- Production `/health` and `/health/calls` returned HTTP 200. Call health reported a 1,800-second window, zero failures, and no failure categories.

Next action:

1. Run a controlled external alert drill for the new `long_turn_latency` or `repeated_prompt` health category, then confirm both UptimeRobot down and recovery notifications.
2. Keep real customer data blocked until gate 1's retention, deletion, recording, and privacy decisions are approved and enforced.

## 2026-08-16 repeated-prompt external alert drill

- Temporarily set the production call-health lookback to its validated five-minute minimum so the controlled failure could expire naturally; no monitor URL, customer configuration, handoff mode, phone destination, or live-call behavior changed.
- Created one signed synthetic Twilio session using reserved test numbers and submitted three empty-speech callbacks. No phone call or transfer occurred, and no caller, decedent, transcript, address, or customer data was used.
- Production `/health/calls` returned HTTP 503 with a 300-second window, one failure, and only `repeated_prompt`. The persisted drill signal contained the safe reason category and repetition count.
- Render logs confirmed UptimeRobot's scheduled GET received HTTP 503. UptimeRobot opened incident `347421514523615151` with root cause `503 Service Unavailable`, then automatically recovered after 5 minutes 5 seconds.
- Direct health recovered naturally to HTTP 200 with zero failures after the synthetic event aged out. The monitor returned to Up and remained attached to the configured owner notification contact.
- Restored `CALL_ALERT_WINDOW_SECONDS=1800`. Final restoration deployment `dep-da0v6iou01pc7395gea0` reached production on commit `959f18f83c65ac6b2ac39fa9621c51cf3796ccd5` with build time `2026-08-16T17:28:50.285Z`.
- Final `/health` and `/health/calls` returned HTTP 200; call health reported the normal 1,800-second window, zero failures, and no failure categories.
- UptimeRobot dashboard evidence proves down and recovery detection. The owner confirmed receipt of both the corresponding down and recovery emails on 2026-08-16.

Next action:

1. Begin gate 1 by making the pilot data-retention, deletion, recording, access, and backup policy decisions before accepting real customer data.

## 2026-08-16 pilot data lifecycle implementation

- The owner approved the conservative pilot data-handling baseline: recordings disabled; no durable transcript text; 30-day call/session/event and Twilio call-resource retention; 7-day idempotency retention; 30-day expired/revoked operator-session retention; 365-day access-audit retention; and 30-day inactive-user retention.
- Added migration `004_pilot_data_lifecycle`. It removes transcript text from legacy `TRANSCRIPT_RECEIVED` payloads and creates content-free purge and retention receipt tables.
- New transcript events store only `transcriptRetained: false` and redaction-category metadata. Structured facts remain available for the approved 30-day operational window.
- Added TypeScript dry-run-first data lifecycle commands. Tenant purge requires exact tenant confirmation, a unique request ID, an opaque actor ID, an approved reason, an HMAC audit secret, and Twilio record deletion before transactional database deletion.
- Added fixed retention cleanup for call data, Twilio call resources, idempotency records, expired/revoked operator sessions, inactive operator users, and access audits.
- Added focused tests for tenant isolation, dry-run non-mutation, exact confirmation, request idempotency, cross-tenant request rejection, retention boundaries, Twilio identifier validation, and absence of transcript text in durable events.
- Added `docs/security/pilot-data-handling-policy.md` and `docs/runbooks/data-lifecycle-operations.md`, including backup/restore reconciliation and the requirement to retain purge receipts outside the recoverable application database.
- No production purge or retention deletion was run.

Activation follow-up completed on 2026-08-16:

1. Migration `004` was deployed and verified in production.
2. The protected lifecycle environment values were configured without recording their contents.
3. Safe production dry-runs were completed and aggregate evidence was recorded; no deletion occurred.
4. Kyle Finney was assigned as the manual daily retention execution owner for any real-data pilot, with production shell access verified by the dry-run.

Remaining external gate: obtain appropriate legal/privacy review before accepting real customer data.

## 2026-08-16 legal/privacy review preparation

- Added `docs/legal/pilot-legal-privacy-review-packet.md` as a factual handoff for qualified counsel. It records the current data flow, retention, vendors, safeguards, requested decisions, response checklist, and official-source links.
- The review packet does not claim legal approval. Real customer data remains blocked until counsel records a bounded Go/Conditional Go and required engineering changes pass verification.
- Research against current FTC Funeral Rule guidance identified a confirmed pricing-lane gap: the current workflow collects a name and callback number and promises office-hours follow-up instead of providing approved telephone price information. A real pricing caller must not be required to provide contact information before receiving required available prices.
- Keep automated pricing disabled for a real tenant until counsel and the funeral home approve effective-dated price data or a compliant human-routing procedure, and focused automated plus real-phone tests pass.

Next engineering action after counsel review: implement the approved automated-assistant notice and Funeral Rule pricing disposition, then re-run the exact release gate.
