# Twilio Webhook Testing

This runbook covers local smoke testing for the Twilio Programmable Voice adapter.

## Local Server

Run from the project root:

```sh
cd /Users/kylefinney/Documents/Codex/Customer_service_project/voice-ai-platform
npm run build
```

Start the API server:

```sh
env TENANT_API_KEYS=fh-demo:replace-with-local-dev-key STORAGE_DRIVER=file STORAGE_DATA_DIR=.voice-ai-data-twilio-test TELEPHONY_WEBHOOK_SECRETS= RATE_LIMIT_PER_WINDOW=120 RATE_LIMIT_WINDOW_MS=60000 SERVICE_VERSION=local-twilio-test SERVICE_COMMIT=local SERVICE_BUILD_TIME=local npm start
```

Or use the local Twilio launcher, which loads ignored `.env.local` / `.env` values and applies safe local defaults:

```sh
npm run start:twilio-local
```

To start both the local server and a Cloudflare quick tunnel, use:

```sh
npm run start:twilio-tunnel
```

The tunnel launcher prints the exact Twilio Voice webhook URL when Cloudflare assigns the public URL.

For persistent public testing, enable Twilio webhook signature validation by setting `TELEPHONY_WEBHOOK_SECRETS` to the Twilio account Auth Token:

```sh
env TENANT_API_KEYS=fh-demo:replace-with-local-dev-key STORAGE_DRIVER=file STORAGE_DATA_DIR=.voice-ai-data-twilio-test TELEPHONY_WEBHOOK_SECRETS=twilio:<TWILIO_AUTH_TOKEN> RATE_LIMIT_PER_WINDOW=120 RATE_LIMIT_WINDOW_MS=60000 SERVICE_VERSION=local-twilio-test SERVICE_COMMIT=local SERVICE_BUILD_TIME=local npm start
```

Do not commit or paste the Auth Token into chat. For unsigned local `curl` requests, keep `TELEPHONY_WEBHOOK_SECRETS=` empty.

Check Twilio readiness before persistent public testing:

```sh
curl -s -H 'x-api-key: replace-with-local-dev-key' \
  http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/readiness
```

For local unsigned testing, `readyForLocalTesting` should be `true` and `readyForPublicTraffic` may be `false`. Before leaving a public webhook configured, `readyForPublicTraffic` should be `true`, which requires `TELEPHONY_WEBHOOK_SECRETS=twilio:<TWILIO_AUTH_TOKEN>`.

The same check is available as a smoke script:

```sh
npm run smoke:twilio-readiness
```

To require public readiness in the smoke check:

```sh
TWILIO_EXPECT_PUBLIC_READY=true npm run smoke:twilio-readiness
```

Run the synthetic Twilio webhook flow:

```sh
npm run smoke:twilio
```

This posts an initial call webhook, a speech/escalation webhook, the called-party handoff-screen webhook, the handoff-accept webhook, and then verifies replay escalation. If `TWILIO_AUTH_TOKEN` is set, the script signs webhook posts with `X-Twilio-Signature`.

Run the broader funeral-home scenario matrix:

```sh
npm run smoke:twilio-scenarios
```

This runs hospice, medical examiner, hospital, police, family-at-home, pricing, and office-hours scenarios through the Twilio webhook and verifies replay facts plus CRM/dispatch outcomes.

To require signed-webhook mode:

```sh
TWILIO_AUTH_TOKEN=<TWILIO_AUTH_TOKEN> TWILIO_EXPECT_SIGNED_WEBHOOK=true npm run smoke:twilio
```

Optional OpenAI-backed first-call extraction can be enabled when testing natural answer formats:

```sh
env TENANT_API_KEYS=fh-demo:replace-with-local-dev-key STORAGE_DRIVER=file STORAGE_DATA_DIR=.voice-ai-data-twilio-test TELEPHONY_WEBHOOK_SECRETS= FIRST_CALL_EXTRACTOR=openai OPENAI_API_KEY=<OPENAI_API_KEY> RATE_LIMIT_PER_WINDOW=120 RATE_LIMIT_WINDOW_MS=60000 SERVICE_VERSION=local-twilio-openai-test SERVICE_COMMIT=local SERVICE_BUILD_TIME=local npm start
```

The OpenAI fallback only fills missing extracted facts and does not overwrite deterministic facts. Keep it disabled for baseline deterministic debugging.

Before using OpenAI extraction on live Twilio calls, run the local extraction smoke check:

```sh
npm run build
npm run smoke:extraction
```

To test OpenAI-backed extraction:

```sh
FIRST_CALL_EXTRACTOR=openai OPENAI_API_KEY=<OPENAI_API_KEY> npm run smoke:extraction
```

The OpenAI-backed smoke test has passed against the current fixture set. The fallback only fills missing facts, does not overwrite deterministic facts, and normalizes controlled values such as caller relationship, place of death type, and urgency before merging them into the intake.

Start a public tunnel:

```sh
npx -y cloudflared tunnel --url http://127.0.0.1:3000
```

Use the printed Cloudflare URL to configure Twilio.

Latest public tunnel smoke checkpoint:

- Date: 2026-06-17
- Temporary tunnel URL: `https://juan-sale-verified-kde.trycloudflare.com`
- Health check through tunnel: passed.
- Public Twilio webhook synthetic initial-call request: passed.
- Public Twilio webhook synthetic speech/escalation request: returned screened `<Dial><Number url="/v1/tenants/fh-demo/telephony/twilio/handoff-screen" method="POST">...`.
- Public handoff-screen request after escalation save: returned full funeral-home rep summary with caller, callback, deceased, pickup address, and missing facts.
- Public handoff-accept request: returned `Connecting now.`

This tunnel is temporary and will go stale when the local `cloudflared` process stops.

## Twilio Console Settings

In Twilio Console, configure the trial phone number's Voice webhook:

```text
Webhook URL:
https://<current-cloudflare-subdomain>.trycloudflare.com/v1/tenants/fh-demo/telephony/twilio/webhook

HTTP method:
POST
```

Twilio posts form-encoded fields like `CallSid`, `From`, `To`, `CallStatus`, and `SpeechResult`. The adapter returns TwiML XML.

For trial accounts, make sure the phone number you call from is verified in Twilio if the trial account requires verified caller IDs.

## Local Smoke Requests

Initial inbound call:

```sh
curl -s -X POST 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/webhook' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=twilio-local-call-1' \
  --data-urlencode 'From=+15551230000' \
  --data-urlencode 'To=+15559870000' \
  --data-urlencode 'CallStatus=ringing'
```

Expected response is TwiML with `<Say>` and `<Gather input="speech">`. The gather includes first-call speech hints and `actionOnEmptyResult="true"` so Twilio calls back even when it does not recognize speech.

Speech callback:

```sh
curl -s -X POST 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/webhook' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=twilio-local-call-1' \
  --data-urlencode 'SpeechResult=My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street, Springfield. My phone is 555-212-3434.' \
  --data-urlencode 'Confidence=0.92'
```

Expected response escalates the call and, when the tenant has an on-call or dispatch-desk phone configured, returns TwiML with `<Say>` followed by `<Dial><Number>...</Number></Dial>`.
The `<Number>` element should include a called-party screening URL:

```xml
<Number url="/v1/tenants/fh-demo/telephony/twilio/handoff-screen" method="POST">+15555550100</Number>
```

Handoff screen callback:

```sh
curl -s -X POST 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/handoff-screen' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=outbound-called-party-1' \
  --data-urlencode 'ParentCallSid=twilio-local-call-1'
```

Expected response is TwiML that speaks a funeral-home rep summary from the session replay and prompts the called party to press `1` before bridging.

Handoff accept callback:

```sh
curl -s -X POST 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/handoff-accept' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=outbound-called-party-1' \
  --data-urlencode 'ParentCallSid=twilio-local-call-1' \
  --data-urlencode 'Digits=1'
```

Expected response is TwiML that tells the called party the bridge is connecting.

Empty speech callback:

```sh
curl -s -X POST 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/webhook' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=twilio-local-call-1' \
  --data-urlencode 'CallStatus=in-progress' \
  --data-urlencode 'SpeechResult='
```

Expected response is TwiML that reprompts the caller and gathers speech again without restarting the active session.

Inspect diagnostics:

```sh
curl -s -H 'x-api-key: replace-with-local-dev-key' \
  'http://127.0.0.1:3000/v1/tenants/fh-demo/diagnostics/activity?limit=20'
```

## Current Limitations

- The first pass uses Twilio's TwiML `<Gather input="speech">` flow rather than streaming audio.
- Handoff uses Twilio called-party screening on `<Dial><Number>` for phone destinations. The funeral home rep hears a session replay summary and presses `1` to accept before bridging.
- Warm conference handoff, reject/retry routing, and richer operator accept/reject audit events should be added as follow-ups.
- Speech recognition is improved with Twilio hints and empty-result reprompting. OpenAI-backed fact extraction is available behind `FIRST_CALL_EXTRACTOR=openai`; production deployment still needs stable hosting, secrets management, and webhook signature enforcement.
