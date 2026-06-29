# Session Handoff

Last updated: 2026-06-27

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

Recent known-good test count from this session: `176/176` passing.

Most recent local prompt fix:

- The first Twilio/Telnyx intake response now asks the first question immediately:
  `I am assisting the funeral director with gathering call information. May I have your name and the best phone number in case we are disconnected?`
- This fixes the prior behavior where the voice agent apologized and said it would get the call to the right person, then waited without asking a question.
- Local precheck confirmed the corrected TwiML response on `2026-06-19`.

## Progress Snapshot

Status as of 2026-06-17:

- Overall MVP progress: roughly 75% complete for a local/dev funeral-home first-call voice intake pilot.
- Backend platform scaffold: complete for MVP local testing.
- First-call death report workflow: complete for current MVP scope, with deterministic extraction plus optional OpenAI fallback.
- Tenant routing/readiness: complete for demo tenant and ready for per-funeral-home configuration expansion.
- Twilio live inbound path: working in local tunnel testing; warm handoff screening is now implemented in TwiML and covered by tests. Next step is live validation through a public tunnel.
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
- Current temporary Cloudflare tunnel URL in the latest test session: `https://dollar-heating-large-petite.trycloudflare.com`
- Twilio webhook URL configured during the successful test:

```text
https://dollar-heating-large-petite.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook
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

1. Move the next live validation to another branch of funeral-home after-hours calls, preferably pricing/question or family routine office-hours, and capture any new transcript quirks as fixtures.
2. Continue expanding confirmation flows for other suspicious fields found in live calls, especially unusual street names, city names, facility names, and repeated name/contact prompts.
3. Start shaping production deployment: stable HTTPS endpoint or named tunnel, secret management, and durable persistence.
4. Replace temporary Cloudflare quick tunnels with a stable HTTPS deployment endpoint or named tunnel.
5. Wait for Telnyx support response about `D61`, SIP `486`, and blank connection fields in fresh inbound CDR rows.
6. Decide whether to fold the separate funeral-home onboarding materials workspace into this GitHub repo or keep it as a companion artifact set.

## Production Hardening Notes

Before real production traffic:

- Configure Telnyx webhook signature verification with `TELEPHONY_WEBHOOK_SECRETS`.
- Replace temporary Cloudflare quick tunnels with a stable HTTPS deployment endpoint or a named Cloudflare tunnel.
- Move secrets to a proper secret manager or deployment environment variables.
- Add observability for provider command failure summaries and call lifecycle alerts.
- Add durable database persistence before scaling beyond local file-backed testing.
