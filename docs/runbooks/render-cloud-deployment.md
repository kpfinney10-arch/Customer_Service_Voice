# Render Cloud Deployment

## Goal

Run the LanternBell TypeScript voice service continuously on Render with managed PostgreSQL, while preserving the current signed Twilio webhook behavior at:

`https://voice.lanternbell.com/v1/tenants/fh-demo/telephony/twilio/webhook`

The existing supervised Mac service and Cloudflare tunnel stay active until the cloud deployment passes validation.

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

The tenant configuration must use real handoff phone numbers before live customer traffic. Shape:

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
npm run smoke:twilio-readiness
```

Expected result:

- `/health` and `/version` return `200`.
- Tenant readiness is ready.
- Twilio mode is `signed_webhook`.
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

## 5. Validate Signed Traffic After Cutover

From a local shell with secrets exported:

```sh
export API_BASE_URL=https://voice.lanternbell.com
export TENANT_ID=fh-demo
export TENANT_API_KEY=<the-cloud-tenant-api-key>
export TWILIO_AUTH_TOKEN=<the-current-Twilio-Auth-Token>
export TWILIO_EXPECT_PUBLIC_READY=true
export TWILIO_EXPECT_SIGNED_WEBHOOK=true
npm run smoke:twilio-readiness
npm run smoke:twilio
npm run smoke:twilio-scenarios
```

Then complete one controlled real inbound phone call and inspect the tenant replay endpoint.

## 6. Retire The Mac Public Path

Only after all signed cloud checks and the real call pass:

1. Stop and disable `com.lanternbell.cloudflared`.
2. Keep the local TypeScript service available temporarily for development if desired.
3. Record the Render deployment ID, database identity, validation run IDs, and DNS cutover time in `docs/SESSION_HANDOFF.md`.

## Rollback

If cloud validation fails after DNS cutover:

1. Restore the prior Cloudflare named-tunnel DNS route for `voice.lanternbell.com`.
2. Confirm both macOS LaunchAgents are running.
3. Re-run signed readiness through the production hostname.
4. Investigate Render without changing the Twilio webhook URL.

## Before Customer Data

- Confirm the managed PostgreSQL backup retention that applies to the selected plan.
- Perform and document a restore drill.
- Add uptime and failed-call alerts.
- Rotate any secret that was exposed during setup.
