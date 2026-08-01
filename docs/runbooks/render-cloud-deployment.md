# Render Cloud Deployment

## Goal

Run the LanternBell TypeScript voice service continuously on Render with managed PostgreSQL, while preserving the current signed Twilio webhook behavior at:

`https://voice.lanternbell.com/v1/tenants/fh-demo/telephony/twilio/webhook`

The supervised Mac service and Cloudflare tunnel stay available until the cloud deployment and one controlled inbound call pass validation.

## What The Blueprint Creates

`render.yaml` defines:

- A paid Starter Node web service named `lanternbell-voice`.
- A private managed PostgreSQL database named `lanternbell-voice-db`.
- An internal `DATABASE_URL` connection from the service to PostgreSQL.
- A `/health` health check.
- PostgreSQL migrations before deployment and again safely at startup.
- Secret placeholders that Render prompts for during initial setup.

## 1. Prepare Secret Values

Prepare these locally. Do not commit them or paste them into support messages:

- `TENANT_API_KEYS`: `fh-demo:<a-new-long-random-api-key>`
- `TELEPHONY_WEBHOOK_SECRETS`: `twilio:<the-current-Twilio-Auth-Token>`
- `TENANT_CONFIGS_JSON`: the tenant's routing configuration as one-line JSON

The Blueprint sets `TWILIO_HANDOFF_MODE=simulate` for demo testing. In that mode the workflow still records escalation, CRM, dispatch, and audit events, but the Twilio response announces the simulated handoff and hangs up without dialing either configured destination.

The tenant configuration can retain reserved `+1555...` placeholders while simulation mode is active. Before enabling `TWILIO_HANDOFF_MODE=live` or accepting customer traffic, replace them with real handoff phone numbers. Shape:

```json
{"fh-demo":{"tenantId":"fh-demo","displayName":"LanternBell Demo","timezone":"America/Chicago","handoff":{"defaultQueue":"first-call-dispatch","onCallPhone":"+1XXXXXXXXXX","dispatchDeskPhone":"+1XXXXXXXXXX","afterHoursQueue":"first-call-after-hours"},"features":{"crmHandoff":true,"dispatchHandoff":true,"voiceIntake":true}}}
```

The initial cloud deployment keeps `FIRST_CALL_EXTRACTOR=deterministic`, so it does not require an OpenAI key.

## 2. Deploy The Blueprint

1. Push the tested commit to the GitHub repository.
2. Sign in to Render and choose **New > Blueprint**.
3. Connect `kpfinney10-arch/Customer_Service_Voice`.
4. Render detects `render.yaml`.
5. Review the Starter web service and Basic PostgreSQL costs before applying.
6. Enter the three secret values when prompted.
7. Apply the Blueprint and wait for both resources to report healthy.

Do not stop the Mac LaunchAgents or alter Cloudflare DNS yet.

## 3. Validate The Temporary Render URL

Use the `onrender.com` URL shown by Render:

```sh
export API_BASE_URL=https://<render-service-hostname>
export TENANT_ID=fh-demo
export TENANT_API_KEY=<the-cloud-tenant-api-key>
export TWILIO_EXPECT_PUBLIC_READY=true
export TWILIO_EXPECT_HANDOFF_MODE=simulate
npm run smoke:twilio-readiness
```

Expected result:

- `/health` and `/version` return `200`.
- Tenant readiness is ready.
- Twilio mode is `signed_webhook`.
- Twilio handoff mode is `simulate`.
- Public traffic readiness is `yes`.

Do not run the signed webhook scenario against the temporary Render hostname unless Twilio is also configured to use that exact hostname. Twilio signatures include the request URL.

## 4. Attach The Production Hostname

1. In the Render service, add custom domain `voice.lanternbell.com`.
2. In Cloudflare DNS, replace the existing named-tunnel route for `voice` with the DNS target Render provides.
3. Keep TLS mode and proxy settings consistent with Render's custom-domain instructions.
4. Wait for Render to show the custom domain and certificate as verified.
5. Confirm:

```sh
curl --fail --show-error https://voice.lanternbell.com/health
```

The Twilio number can keep its current webhook URL because the hostname and path do not change.

Current demo deployment:

- Cloudflare CNAME: `voice` -> `lanternbell-voice.onrender.com`
- Proxy status: DNS-only while using Render-managed TLS
- Render domain: verified
- Permanent-host health: HTTP 200

## 5. Validate Signed Traffic After Cutover

From a local shell with secrets exported:

```sh
export API_BASE_URL=https://voice.lanternbell.com
export TENANT_ID=fh-demo
export TENANT_API_KEY=<the-cloud-tenant-api-key>
export TWILIO_AUTH_TOKEN=<the-current-Twilio-Auth-Token>
export TWILIO_EXPECT_PUBLIC_READY=true
export TWILIO_EXPECT_SIGNED_WEBHOOK=true
export TWILIO_EXPECT_HANDOFF_MODE=simulate
npm run smoke:twilio-readiness
npm run smoke:twilio
npm run smoke:twilio-scenarios
```

Then complete one controlled real inbound phone call and inspect the tenant replay endpoint.

The 2026-07-28 cutover validation passed:

- Webhook smoke: `lanternbell-render-cutover-smoke-1785284296`
- Scenario matrix: `lanternbell-render-cutover-scenarios-1785284296` (`7/7`)
- Controlled inbound call: `CAe1670388173831ec8474505578338c29`
- Real-call replay: `ESCALATE`, 21 events, CRM and dispatch-review tools completed, no tool failures

## 6. Retire The Mac Public Path

Only after all signed cloud checks and the real call pass:

1. Stop and disable `com.lanternbell.cloudflared`.
2. Keep the local TypeScript service available temporarily for development if desired.
3. Record the Render deployment ID, database identity, validation run IDs, and DNS cutover time in `docs/SESSION_HANDOFF.md`.

Completed on 2026-07-28 after the controlled inbound call passed:

- `com.lanternbell.cloudflared` is stopped and disabled.
- `com.lanternbell.voice-ai` remains available on `127.0.0.1:3000`.
- `voice.lanternbell.com` remained healthy through Render after the tunnel stopped.

## Rollback

If cloud validation fails after DNS cutover:

1. Restore the prior Cloudflare named-tunnel DNS route for `voice.lanternbell.com`.
2. Confirm both macOS LaunchAgents are running.
3. Re-run signed readiness through the production hostname.
4. Investigate Render without changing the Twilio webhook URL.

## Before Customer Data

- Confirm the managed PostgreSQL backup retention that applies to the selected plan. Completed 2026-08-01: three-day point-in-time recovery and logical exports retained for at least seven days.
- Perform and document a restore drill. Completed 2026-08-01: isolated restore reached Available in approximately six minutes, aggregate validation passed, the temporary IP rule was removed, and the temporary database was deleted.
- Activate an independent monitor for the aggregate call-health endpoint described below.
- Rotate any secret that was exposed during setup.

## PostgreSQL recovery validation

Build the TypeScript project, set `DATABASE_URL` to the isolated recovery database, and run:

```sh
npm run build
npm run validate:postgres-recovery
```

The validator emits only migration versions, aggregate counts, and integrity totals. It does not emit session payloads, events, transcripts, caller names, phone numbers, or addresses. A passing result requires both current migrations, no missing or duplicate event sequence values, and no events without a matching session.

The 2026-08-01 drill restored point `2026-08-01 09:10:59 CDT` to temporary database `dpg-d9n0ijrncjis7397hhtg-a`. Validation passed with 29 sessions and 331 events. External access was limited to one temporary `/32` rule, removed after validation, and the recovered database was deleted at approximately `2026-08-01 11:46 CDT`.

## Independent uptime and call-failure monitoring

Use one independent HTTP monitor for:

```text
https://voice.lanternbell.com/health/calls
```

The endpoint checks persisted call events across all tenants and returns:

- HTTP `200` when no qualifying failure occurred in the alert window.
- HTTP `503` after a failed tool, failed provider command, or abnormal call termination.
- Only aggregate fields: status, window length, failure count, failure categories, and the last failure time. It never returns tenant, call, session, correlation, provider, tool, or caller data.

The default alert window is 1,800 seconds. Set `CALL_ALERT_WINDOW_SECONDS` only when a different window between 300 and 86,400 seconds is operationally justified. Normal completed calls and caller-canceled/disconnected calls do not make the endpoint unhealthy.

The initial external monitor uses UptimeRobot's free five-minute checks. Configure down and recovery email notifications, and leave Render's own failure-only notifications enabled. This creates two independent paths: Render detects deployment and platform health failures, while UptimeRobot detects an unreachable service or a persisted call-processing failure.
