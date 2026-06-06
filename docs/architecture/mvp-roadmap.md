# MVP Roadmap

## Phase 1: Deterministic Core

- Call session model.
- State machine.
- Event model.
- Redaction.
- Funeral-home intent classifier.
- First-call death report intake facts and flow decision model.
- Rule engine.
- Tool registry.
- Fake CRM and dispatch adapters.
- Tool request/executed/failed event tests.
- HTTP API boundary for first-call session and transcript turns.
- Tenant API key enforcement for tenant-scoped routes.
- In-memory session store for local development and API tests.
- In-memory event timeline store and session events endpoint.
- Human handoff summary for escalated first-call death reports.
- Tenant handoff routing for on-call phone, dispatch desk, queue, or manual review.
- Environment-loadable tenant configuration for adding funeral home customers without code edits.
- Tenant config lookup endpoint for deployment verification.
- Tenant readiness endpoint for first-call traffic go/no-go checks.
- Tenant feature flags for voice intake access and CRM/dispatch tool execution.
- Structured API request logging with request ids and tenant context.
- Tenant-route rate limiting with `429` responses and retry headers.
- Environment-configurable rate-limit window and request count.
- Startup environment validation with structured startup errors.
- Session replay snapshot endpoint for debugging and future replay tooling.
- Scenario tests.

## Phase 2: Provider Adapters

- Generic telephony inbound-call webhook boundary.
- Generic telephony speech-turn boundary.
- Generic telephony audio-turn boundary.
- Generic telephony call-end boundary.
- Generic voice response action envelope.
- Telephony streaming interface for live audio sessions.
- STT adapter contract and fake adapter.
- TTS adapter contract and fake adapter.
- Barge-in and cancellation model.
- LLM structured-output adapter contract and fake fallback extractor.

## Phase 3: Funeral Home Workflow

- First-call intake scenario.
- Family question scenario.
- Dispatch status scenario.
- Pricing/billing routing scenario.
- After-hours escalation.
- Tenant-specific handoff configuration.
- CRM intake tool adapter.
- Dispatch review request tool adapter.

## Phase 4: Production Hardening

- Durable event persistence.
- Tenant-aware auth and permissions.
- Prompt and rule versioning.
- Audit log UI.
- Latency metrics.
- Replayable call timeline.
- Load and scenario testing.

## Phase 5: Platform Integration

- CRM handoff.
- Dispatch handoff.
- Billing/reporting hooks.
- Shared tenant and user model.
- Cross-module event taxonomy.
