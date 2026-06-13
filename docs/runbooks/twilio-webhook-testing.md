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

For persistent public testing, enable Twilio webhook signature validation by setting `TELEPHONY_WEBHOOK_SECRETS` to the Twilio account Auth Token:

```sh
env TENANT_API_KEYS=fh-demo:replace-with-local-dev-key STORAGE_DRIVER=file STORAGE_DATA_DIR=.voice-ai-data-twilio-test TELEPHONY_WEBHOOK_SECRETS=twilio:<TWILIO_AUTH_TOKEN> RATE_LIMIT_PER_WINDOW=120 RATE_LIMIT_WINDOW_MS=60000 SERVICE_VERSION=local-twilio-test SERVICE_COMMIT=local SERVICE_BUILD_TIME=local npm start
```

Do not commit or paste the Auth Token into chat. For unsigned local `curl` requests, keep `TELEPHONY_WEBHOOK_SECRETS=` empty.

Start a public tunnel:

```sh
npx -y cloudflared tunnel --url http://127.0.0.1:3000
```

Use the printed Cloudflare URL to configure Twilio.

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

Expected response is TwiML with `<Say>` and `<Gather input="speech">`.

Speech callback:

```sh
curl -s -X POST 'http://127.0.0.1:3000/v1/tenants/fh-demo/telephony/twilio/webhook' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'CallSid=twilio-local-call-1' \
  --data-urlencode 'SpeechResult=My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street, Springfield. My phone is 555-212-3434.' \
  --data-urlencode 'Confidence=0.92'
```

Expected response escalates the call and, when the tenant has an on-call or dispatch-desk phone configured, returns TwiML with `<Say>` followed by `<Dial><Number>...</Number></Dial>`.

Inspect diagnostics:

```sh
curl -s -H 'x-api-key: replace-with-local-dev-key' \
  'http://127.0.0.1:3000/v1/tenants/fh-demo/diagnostics/activity?limit=20'
```

## Current Limitations

- The first pass uses Twilio's TwiML `<Gather input="speech">` flow rather than streaming audio.
- Handoff currently uses direct TwiML `<Dial>` for phone destinations. Warm transfer/conference behavior should be added as a follow-up.
