# Telnyx Webhook Testing Runbook

Use this runbook to validate the Telnyx webhook adapter before connecting real caller traffic.

Supported Telnyx events in this scaffold are `call.initiated`, `call.ai_gather.ended`, and `call.hangup`. Other events are acknowledged as ignored.

## 1. Dry-Run Webhook Test

Start the server with Telnyx command execution disabled:

```bash
export TENANT_API_KEYS=fh-demo:replace-with-local-dev-key
export STORAGE_DRIVER=file
export STORAGE_DATA_DIR=.voice-ai-data-telnyx-test
export TELEPHONY_WEBHOOK_SECRETS=
export TELNYX_EXECUTE_COMMANDS=false
export RATE_LIMIT_PER_WINDOW=120
export RATE_LIMIT_WINDOW_MS=60000
npm run build
npm start
```

In a second terminal:

```bash
export TENANT_API_KEY=replace-with-local-dev-key
npm run smoke:telnyx
```

The smoke check first calls `GET /v1/tenants/fh-demo/telephony/telnyx/readiness` and then runs the synthetic webhook flow.

The smoke script posts a synthetic `call.initiated` webhook, verifies the generated `answer` plus `gather_using_speak` command plan, then posts a synthetic `call.ai_gather.ended` webhook and verifies the first-call workflow reaches human handoff.

Expected result:

```text
Telnyx webhook smoke check passed.
Mode: dry-run expected
```

## 2. Dry-Run With Signature Verification

Restart the server with a local Telnyx webhook secret:

```bash
export TELEPHONY_WEBHOOK_SECRETS=telnyx:local-webhook-secret
export TELNYX_EXECUTE_COMMANDS=false
npm start
```

Run the smoke check with the matching secret:

```bash
export TENANT_API_KEY=replace-with-local-dev-key
export TELNYX_WEBHOOK_SECRET=local-webhook-secret
npm run smoke:telnyx
```

The smoke check should pass. If `TELNYX_WEBHOOK_SECRET` is missing or wrong, the webhook should return `401 WEBHOOK_SIGNATURE_INVALID`.

To inspect the command audit trail after the smoke check, use the smoke call control id as the session id:

```bash
curl -s \
  -H "x-api-key: replace-with-local-dev-key" \
  "http://127.0.0.1:3000/v1/tenants/fh-demo/first-call/sessions/telnyx-smoke-call-1/events"
```

The response should include `PROVIDER_COMMANDS_EXECUTED` events with sanitized Telnyx command names, status codes, dry-run flags, and failure names.

## 3. Controlled Live Execution

Only use this after dry-run and signature verification pass.

```bash
export TELEPHONY_WEBHOOK_SECRETS=telnyx:<real-webhook-secret>
export TELNYX_EXECUTE_COMMANDS=true
export TELNYX_API_KEY=<real-telnyx-api-key>
npm start
```

Live command execution requires a real active Telnyx `call_control_id`. For this reason, do not run the smoke script against production traffic unless you are using a controlled Telnyx test call.

Before live traffic, the Telnyx readiness endpoint should report `readyForLiveTraffic: true`. That requires:

- `TELEPHONY_WEBHOOK_SECRETS` includes a `telnyx:<secret>` entry.
- `TELNYX_EXECUTE_COMMANDS=true`.
- `TELNYX_API_KEY` is configured.

When testing against a real controlled call:

```bash
export TENANT_API_KEY=replace-with-local-dev-key
export TELNYX_WEBHOOK_SECRET=<real-webhook-secret>
export TELNYX_SMOKE_CALL_CONTROL_ID=<active-call-control-id>
export TELNYX_EXPECT_LIVE_EXECUTION=true
npm run smoke:telnyx
```

Optional smoke-script overrides:

```bash
export TELNYX_SMOKE_EVENT_ID=<unique-initiated-event-id>
export TELNYX_SMOKE_SPEECH_EVENT_ID=<unique-speech-event-id>
export TELNYX_SMOKE_TRANSCRIPT="My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street. My phone is 555-212-3434."
```

## Safety Notes

- Keep `TELNYX_EXECUTE_COMMANDS=false` until you are intentionally testing a controlled live call.
- Never commit real Telnyx API keys or webhook secrets.
- The Telnyx smoke script uses synthetic caller numbers and a synthetic first-call death report transcript unless you override them.
- The adapter returns generated command plans and command results so you can inspect behavior before production use.
