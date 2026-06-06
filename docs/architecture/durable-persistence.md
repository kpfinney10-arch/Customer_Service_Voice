# Durable Persistence

The voice platform keeps storage behind narrow interfaces so call orchestration does not depend on a specific database vendor.

## Current Storage Boundary

- `SessionStore` owns the latest call session state.
- `EventStore` owns the append-only call event timeline.
- The first-call service receives both stores through dependency injection.
- API routing, telephony adapters, tools, rules, and model adapters do not read or write persistence directly.

## Storage Drivers

`STORAGE_DRIVER=memory` is the default. It is best for unit tests, local experiments, and fast development, but data is lost when the process exits.

`STORAGE_DRIVER=file` enables local durable storage:

- Session snapshots are written under `STORAGE_DATA_DIR/sessions`.
- Call events are appended to `STORAGE_DATA_DIR/events.jsonl`.
- The default file data directory is `.voice-ai-data`.

The file driver is useful for early human testing because sessions and replay data survive server restarts. It is not intended as the final production storage layer for multiple app instances.

## Production Direction

The next production-grade adapter should target a transactional database such as Postgres or Supabase Postgres.

Minimum production requirements:

- Append-only call events with tenant id, session id, event type, correlation id, schema version, redaction status, and timestamp indexes.
- Latest session state keyed by tenant id and session id.
- Tenant isolation in every query.
- Idempotency support for webhook retries and tool execution.
- Migration-managed schema changes.
- Backup and restore process before real customer data.

## Operating Rule

Business workflow code should continue to depend only on `SessionStore` and `EventStore`. New persistence backends should be introduced as adapters, not by adding database calls inside orchestration, tools, or telephony handlers.
