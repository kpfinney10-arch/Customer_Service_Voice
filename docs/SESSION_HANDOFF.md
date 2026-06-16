# Session Handoff

Last updated: 2026-06-13

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
- Twilio inbound webhook adapter with TwiML responses for `<Say>`, speech `<Gather>`, and `<Hangup>`.
- Diagnostic activity and replay endpoints.

Recent known-good test count from this session: `129/129` passing.

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
- Current temporary Cloudflare tunnel URL used during the successful test: `https://electro-infinite-ion-businesses.trycloudflare.com`
- Twilio webhook URL configured during the successful test:

```text
https://electro-infinite-ion-businesses.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook
```

The Cloudflare URL is temporary. If the tunnel is restarted, update the Twilio number's Voice Configuration with the new URL.

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
- Adds Twilio speech recognition hints and `actionOnEmptyResult="true"` to reduce missed first-call intake answers.
- Reprompts safely on empty Twilio speech callbacks without restarting or overwriting the active intake session.
- Does not require the tenant `x-api-key`, matching public provider webhook behavior.

Twilio local testing runbook:

```text
docs/runbooks/twilio-webhook-testing.md
```

Current Twilio limitations:

- This first pass uses Twilio `<Gather input="speech">`, not media streams.
- Twilio phone handoff uses a direct `<Dial>` transfer; warm conference handoff, whisper prompts, and operator accept/reject are follow-ups.
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
- Optional LLM-backed first-call fact extraction is wired through `FIRST_CALL_EXTRACTOR=openai`; deterministic extraction remains the default.
- Local extraction smoke script is available via `npm run smoke:extraction`.
- Current deterministic extraction smoke baseline: `10/10` expected facts matched.

LLM extraction modes:

- Default: `FIRST_CALL_EXTRACTOR=deterministic` or unset.
- Fake local fallback for tests/smoke work: `FIRST_CALL_EXTRACTOR=fake_llm` with `FIRST_CALL_FAKE_LLM_OUTPUT_JSON`.
- OpenAI structured output fallback: `FIRST_CALL_EXTRACTOR=openai` with `OPENAI_API_KEY`.
- Optional model override: `OPENAI_MODEL`; default is `gpt-5.5`.
- Optional timeout override: `OPENAI_TIMEOUT_MS`.
- The fallback fills missing facts only and does not overwrite deterministic facts.
- Provider failures are converted into warnings so live calls continue on deterministic extraction.

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

1. Commit and push the current extraction smoke script and deterministic hardening.
2. Add live OpenAI extraction smoke testing with a real API key and a small transcript set.
3. Add warm handoff behavior for Twilio: whisper summary to the funeral home rep, require keypress acceptance, then bridge the caller.
4. Replace temporary Cloudflare quick tunnels with a stable HTTPS deployment endpoint or named tunnel.
5. Turn on Twilio signature validation for persistent public testing by setting `TELEPHONY_WEBHOOK_SECRETS=twilio:<TWILIO_AUTH_TOKEN>`.
6. Wait for Telnyx support response about `D61`, SIP `486`, and blank connection fields in fresh inbound CDR rows.

## Production Hardening Notes

Before real production traffic:

- Configure Telnyx webhook signature verification with `TELEPHONY_WEBHOOK_SECRETS`.
- Replace temporary Cloudflare quick tunnels with a stable HTTPS deployment endpoint or a named Cloudflare tunnel.
- Move secrets to a proper secret manager or deployment environment variables.
- Add observability for provider command failure summaries and call lifecycle alerts.
- Add durable database persistence before scaling beyond local file-backed testing.
