# Durable Persistence

The voice platform keeps storage behind narrow interfaces so call orchestration does not depend on a specific database vendor.

## Current Storage Boundary

- `SessionStore` owns the latest call session state.
- `EventStore` owns the append-only call event timeline.
- `IdempotencyStore` owns replay records for tenant POST retries.
- The first-call service receives both stores through dependency injection.
- API routing, telephony adapters, tools, rules, and model adapters do not read or write persistence directly.

## Storage Drivers

`STORAGE_DRIVER=memory` is the default. It is best for unit tests, local experiments, and fast development, but data is lost when the process exits.

`STORAGE_DRIVER=file` enables local durable storage:

- Session snapshots are written under `STORAGE_DATA_DIR/sessions`.
- Call events are appended to `STORAGE_DATA_DIR/events.jsonl`.
- Idempotency replay records are written under `STORAGE_DATA_DIR/idempotency`.
- The default file data directory is `.voice-ai-data`.

The file driver is useful for early human testing because sessions, replay data, and idempotency records survive server restarts. It is not intended as the final production storage layer for multiple app instances.

`STORAGE_DRIVER=postgres` enables production database storage:

- `DATABASE_URL` is required.
- `POSTGRES_POOL_MAX` controls the connection pool and defaults to `10`.
- Startup runs versioned schema migrations under a PostgreSQL advisory transaction lock.
- Sessions use `(tenant_id, session_id)` as their key.
- Events use `(tenant_id, event_id)` as their key and ignore duplicate event deliveries.
- Idempotency records use `(tenant_id, idempotency_key)` as their key.
- Every read query includes tenant scope.
- Shutdown closes the database pool after the HTTP listener drains.

The initial production schema includes:

- Append-only call events with tenant id, session id, event type, correlation id, schema version, redaction status, and timestamp indexes.
- Latest session state keyed by tenant id and session id.
- Tenant isolation in every query.
- Idempotency support for webhook retries and tool execution.
- Migration-managed schema changes.
- Content-free purge and retention receipts that survive active tenant-row deletion.

## Pilot Data Lifecycle

The owner-approved pilot policy is `docs/security/pilot-data-handling-policy.md`; operating commands are in `docs/runbooks/data-lifecycle-operations.md`.

- Transcript text is processed transiently and is not stored in durable events. Migration `004_pilot_data_lifecycle` scrubs transcript text from existing event payloads.
- `npm run data:purge` defaults to a tenant-scoped dry-run and requires exact confirmation, an idempotent request ID, an audit secret, and provider deletion before transactional execution.
- `npm run data:retention` defaults to dry-run and enforces the approved fixed pilot periods when explicitly executed.
- Twilio Call SIDs are kept internal to the deletion boundary and never included in command receipts.
- A restore must replay externally retained purge receipts and run current retention before it can receive production traffic.

Render deployment is defined in `render.yaml`; operational steps are in `docs/runbooks/render-cloud-deployment.md`.

## Remaining Production Requirement

The managed backup/restore drill is complete. Before accepting real customer data, deploy migration `004_pilot_data_lifecycle`, configure the protected lifecycle secrets, verify the production dry-runs, establish the daily retention execution owner, and obtain appropriate legal/privacy review.

## Operating Rule

Business workflow code should continue to depend only on narrow storage interfaces such as `SessionStore`, `EventStore`, and `IdempotencyStore`. New persistence backends should be introduced as adapters, not by adding database calls inside orchestration, tools, or telephony handlers.
