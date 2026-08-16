# Data Lifecycle Operations

Use this runbook only from an authorized terminal with the production build and database connection. Never paste database URLs, Twilio tokens, the audit secret, transcript text, caller data, or command output containing secrets into chat, email, source control, or tickets.

## Safety Rules

- Commands default to dry-run.
- Never add `--execute` until the dry-run counts and tenant identity have been independently checked.
- Use an opaque staff user ID for `--requested-by`, not an email address.
- Use a new request or run ID for each approved operation. Save the content-free execution receipt in the approved operational record.
- Stop tenant traffic and remove environment-provisioned tenant access before an offboarding purge.
- Do not run a production purge merely to test the command. Use a dedicated test tenant.

## Tenant Purge Preview

Build the exact release, connect to the intended database, and run:

```sh
npm run data:purge -- --tenant TENANT_ID
```

The JSON output contains aggregate row counts and a Twilio call count only. It does not include call IDs, transcripts, facts, user emails, phone numbers, addresses, or the tenant ID. Confirm the expected scope with the approved request.

## Tenant Purge Execution

Confirm that the protected environment contains `DATA_PURGE_AUDIT_SECRET`, `TWILIO_ACCOUNT_SID`, and `TWILIO_AUTH_TOKEN`. Do not place their values on the command line.

```sh
npm run data:purge -- \
  --tenant TENANT_ID \
  --execute \
  --confirm-tenant TENANT_ID \
  --request-id UNIQUE_REQUEST_ID \
  --requested-by OPAQUE_USER_ID \
  --reason customer_request
```

Allowed reasons are `customer_request`, `tenant_offboarding`, and `test_data_cleanup`.

After execution:

1. Save the content-free receipt outside the application database.
2. Run the same command with the same request ID; it must return the same receipt with `duplicate: true` and perform no new provider deletion.
3. Repeat the preview; all tenant database and provider counts must be zero.
4. Verify another tenant's aggregate counts were unchanged.
5. For offboarding, confirm the tenant API key, configuration, environment-provisioned users, webhook route, and telephony routing are removed or disabled.

If Twilio deletion fails, the database purge does not begin. If database deletion fails after Twilio deletion, rerun with the same request ID; Twilio HTTP 404 is treated as already deleted.

## Retention Preview

Run at least daily during a real-data pilot:

```sh
npm run data:retention
```

Review the calculated cutoffs and aggregate counts. The fixed pilot periods are 30 days for call data, 7 days for idempotency, 30 days for expired/revoked operator sessions, 365 days for access audits, and 30 days for inactive operator users.

## Retention Execution

Use a unique run ID, such as the UTC date plus an operations identifier:

```sh
npm run data:retention -- \
  --execute \
  --confirm RETENTION \
  --run-id UNIQUE_RUN_ID
```

Save the content-free receipt. Repeating the same run ID must return `duplicate: true`.

During any real-data pilot, Kyle Finney is the assigned primary execution owner. Run the preview and reviewed execution once per calendar day, targeted for 9:00 AM `America/Chicago`. If the owner cannot complete the run by the end of that day, stop real-data traffic until retention is current. The 2026-08-16 production dry-run verified the owner's Render shell access and command path. A reviewed scheduler may replace this manual cadence later; adding a paid Render cron service requires separate cost approval and failed-run alerting.

## Restore Reconciliation

Before a restored database receives production traffic:

1. Keep the web service stopped or tenant traffic disabled.
2. Validate the restored database using `npm run validate:postgres-recovery`.
3. Compare the restore timestamp with all externally retained purge receipts.
4. Replay any purge whose execution occurred after the restore point, using its original request ID and approved tenant reference.
5. Run the retention preview and execution for the current time.
6. Re-run aggregate recovery validation and tenant-isolation checks.
7. Record approval before directing traffic to the restored database.
