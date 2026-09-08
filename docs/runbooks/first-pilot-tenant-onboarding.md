# First Pilot Tenant Onboarding

This runbook prepares the first funeral-home tenant without committing customer data, credentials, or live transfer destinations to source control. Preparation does not authorize real customer traffic. The launch gates in `controlled-pilot-readiness.md` remain controlling.

## Current Product Boundary

The first monitored pilot is intentionally narrow:

- Inbound voice intake only.
- Deterministic orchestration with the reviewed caller-language bundle and the pinned production voice.
- No call recording and no durable raw transcript text.
- Simulated handoffs until the separate real-handoff drill and final go/no-go approval are complete.
- No customer pricing answers, payments, Social Security numbers, dates of birth, medical advice, or other unsupported sensitive-data collection.
- CRM and Dispatch integrations remain disabled until their interfaces and customer environment are approved and tested.
- The operator console is operational support tooling, not a replacement for the future CRM or Dispatch products.

## Information to Collect Securely

Keep personal contacts, credentials, and real phone destinations in the approved password manager or deployment environment—not in GitHub, tickets, test fixtures, screenshots, or this runbook.

- Stable tenant id in lower-kebab-case, public business display name, and IANA timezone.
- Customer operational owner and LanternBell incident owner.
- Pilot operating hours, expected call volume, and maximum concurrent calls.
- Inbound-number ownership and forwarding plan.
- Primary and backup on-call destinations, dispatch desk destination, and queue names.
- Approved pilot call lanes and explicitly excluded call lanes.
- Feature-flag decision for voice intake, CRM handoff, and Dispatch handoff.
- Named operator users and least-privilege roles.
- Customer support contact and the person authorized to stop traffic.
- Accepted retention, deletion, recording, privacy, and legal-review decisions.

## Configuration Preparation

1. Copy `config/examples/pilot-tenant.example.json` to a secure working location outside the repository.
2. Replace the fictional tenant id and display name with approved non-secret values.
3. Keep all three feature flags `false` during preparation.
4. Keep `TWILIO_HANDOFF_MODE=simulate` and do not add real phone destinations until the real-handoff drill is scheduled and approved.
5. Validate the JSON against `schemas/tenants/tenant-config.schema.json`. The application performs additional startup validation, including the requirement that the object key exactly match `tenantId` and that the timezone be recognized by the runtime.
6. When deployment is approved, update `TENANT_CONFIGS_JSON` atomically: preserve the existing `fh-demo` entry and add the pilot entry in the same JSON object.

The `+1555...` values in the example are reserved fictional placeholders. They must never be treated as live destinations.

## Provisioning Sequence

1. Create the disabled tenant configuration with `voiceIntake=false`, `crmHandoff=false`, and `dispatchHandoff=false`.
2. Generate a tenant-specific machine key and create named operator users with least-privilege roles. Store secrets only in the deployment secret store.
3. Deploy the combined configuration while handoffs remain simulated.
4. Verify authenticated tenant configuration and readiness without printing keys, phone numbers, or caller data.
5. Test tenant isolation across configuration, API authentication, call activity, call detail, access audit, and webhook routing.
6. Complete the legal/privacy gate and the separate real-handoff drill.
7. Record the final pilot hours, volume limit, incident contacts, and stop-traffic authority outside source control.
8. Obtain an explicit go/no-go decision before enabling `voiceIntake` or routing customer traffic.

## Acceptance Checklist

- [ ] Stable tenant id, display name, and timezone approved.
- [ ] Pilot call lanes, operating hours, volume, and concurrency limit approved.
- [ ] Customer support contact, LanternBell incident owner, and stop-traffic owner recorded securely.
- [ ] Tenant config passes schema and application startup validation.
- [ ] Existing `fh-demo` configuration remains present and unchanged.
- [ ] Tenant-specific machine secret and named operator accounts created securely.
- [ ] CRM and Dispatch flags remain disabled unless their separate integration gates are complete.
- [ ] Handoff mode remains simulated until the real-handoff drill is complete.
- [ ] Tenant-isolation checks pass for every authenticated surface.
- [ ] Legal/privacy review and data-policy acceptance are recorded.
- [ ] Exact candidate commit passes typecheck, build, automated tests, signed readiness, and pilot rebaseline.
- [ ] Owner records an explicit Go, Conditional Go, or No-go decision.

## Rollback and Stop-Traffic Procedure

If onboarding validation fails or the pilot must stop:

1. Set the pilot tenant's `voiceIntake` flag to `false`.
2. Keep `TWILIO_HANDOFF_MODE=simulate` or restore it immediately if a controlled drill temporarily changed it.
3. Restore the last known-good `TENANT_CONFIGS_JSON` value and redeploy.
4. Confirm `/version`, `/health`, authenticated readiness, and tenant isolation on the restored release.
5. Preserve only redacted operational evidence and follow the incident-response and data-handling runbooks.

Disabling the pilot tenant is the primary traffic stop. Deleting tenant data is a separate audited retention/deletion action and must not be used as an improvised rollback.
