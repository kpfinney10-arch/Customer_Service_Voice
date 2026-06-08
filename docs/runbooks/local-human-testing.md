# Local Human-Testing Runbook

Use this runbook before early human testing to confirm the local server can create a first-call session, persist the call timeline, expose diagnostics, and replay the same records after restart.

## 1. Build

```bash
npm run build
```

## 2. Start With File Persistence

```bash
export TENANT_API_KEYS=fh-demo:replace-with-local-dev-key
export STORAGE_DRIVER=file
export STORAGE_DATA_DIR=.voice-ai-data-human-test
export TELEPHONY_WEBHOOK_SECRETS=
export TELNYX_EXECUTE_COMMANDS=false
export RATE_LIMIT_PER_WINDOW=120
export RATE_LIMIT_WINDOW_MS=60000
export SERVICE_VERSION=human-test-local
export SERVICE_COMMIT=local
export SERVICE_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
npm start
```

Leave this terminal running.

## 3. Run The Smoke Check

Open a second terminal in the project directory:

```bash
export TENANT_API_KEY=replace-with-local-dev-key
npm run smoke:human-test
```

Expected result:

```text
Human-testing smoke check passed.
```

## 4. Confirm Restart Durability

Stop the server with `Ctrl-C`, then start it again with the same environment values from step 2.

Run the smoke check again:

```bash
export TENANT_API_KEY=replace-with-local-dev-key
npm run smoke:human-test
```

The second run should also pass. The fixed smoke-test session uses idempotency keys, so a matching retry should replay stored work instead of duplicating call actions.

## 5. Inspect Diagnostics

```bash
curl -s \
  -H "x-api-key: replace-with-local-dev-key" \
  "http://127.0.0.1:3000/v1/tenants/fh-demo/diagnostics/activity?limit=10"
```

The response should include `human-test-session-1` in `sessions` and recent redacted event summaries in `recentEvents`.

For a session-level view, call replay:

```bash
curl -s \
  -H "x-api-key: replace-with-local-dev-key" \
  "http://127.0.0.1:3000/v1/tenants/fh-demo/first-call/sessions/human-test-session-1/replay"
```

The replay snapshot summarizes event counts, escalation state, tool outcomes, redaction counts, interruptions, provider command batches when present, and any reconstructed handoff.

## Notes

- Keep `STORAGE_DATA_DIR` stable between restarts when testing durability.
- Do not use real caller data in local smoke checks.
- The diagnostics endpoint intentionally omits raw event payloads and transcripts.
