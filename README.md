# Voice AI Platform

This module is the production scaffold for the funeral-home-aware voice AI customer service platform.

The system is intentionally designed as a deterministic workflow engine that uses conversational AI. The LLM does not directly control calls, business tools, CRM data, dispatch data, billing, scheduling, or customer-impacting actions.

## Initial Scope

The first implementation target is inbound funeral home customer service intake:

- Greeting and call purpose identification.
- Caller/family/contact fact extraction.
- Supported funeral-home call intents.
- Escalation for urgent, sensitive, unsupported, or high-risk calls.
- Future handoff to CRM and dispatch modules through typed tools.
- First MVP call flow: first-call death report intake.
- Deterministic first-call fact extraction before any LLM dependency.
- Fake CRM/dispatch adapters for contract testing before real integrations.
- HTTP API boundary for starting sessions and submitting transcript turns.
- Session event timeline for debugging and future replay.
- Tenant API key enforcement for tenant-scoped routes.
- Human handoff summaries for escalated first-call death reports.
- Session replay snapshots for debugging current call state from stored events.
- Generic telephony inbound-call boundary for future provider adapters.
- Generic telephony speech-turn boundary for provider/STT transcript turns.
- Generic telephony call-end boundary for provider lifecycle completion.
- Generic voice response actions for say/listen/handoff/hangup provider translation.
- STT/TTS provider contracts with fake adapters for local testing.
- Generic telephony audio-turn boundary for local audio-in/audio-out testing.
- Generic telephony interrupt boundary for barge-in and output cancellation.
- LLM structured-output provider contract for controlled fact extraction fallback.
- Tenant funeral-home configuration for handoff queues and on-call routing.

## Architecture Pillars

- Explicit call state machine.
- Typed session model.
- Durable event model.
- Rule engine before action.
- Tool registry with schemas and permissions.
- PII redaction before logs and analytics.
- Observability from the first slice.
- Tenant-aware design from the beginning.

## Current Scaffold

- `src/domain`: shared types and state names.
- `src/debug`: replay snapshots and diagnostic summaries.
- `src/session`: call session creation and updates.
- `src/state-machine`: allowed call transitions.
- `src/rules`: deterministic rule evaluation.
- `src/tools`: typed tool registry and execution boundary.
- `src/orchestrator`: first turn-level orchestration slice.
- `src/providers`: provider-facing adapters for telephony, STT, TTS, and future model services.
- `src/security`: redaction utilities and tenant API key verification.
- `src/tenants`: tenant configuration stores for routing, feature flags, and tenant-specific operations.
- `src/events`: event construction helpers and in-memory event timeline store.
- `src/api`: first-call application service and HTTP API boundary.
- `src/verticals/funeral-home`: funeral-home-specific intents, rules, first-call flow, and handoff summaries.
- `docs/architecture/first-call-death-report-intake.md`: MVP call-flow definition.
- `tests/fixtures/first-call`: realistic transcript fixtures and expected extraction/flow outcomes.
- `docs/architecture/integration-contracts.md`: CRM and dispatch handoff boundaries.
- `docs/architecture/mvp-roadmap.md`: staged build plan.
- `schemas`: JSON schema placeholders for shared contracts.
- `docs`: architecture notes and ADRs.

## Build Notes

This scaffold is dependency-light on purpose. Provider-specific telephony, STT, TTS, LLM, CRM, and dispatch adapters should be added behind the existing typed interfaces rather than coupled directly into orchestration code.

## Local API

Build and run:

```bash
export TENANT_API_KEYS=fh-demo:replace-with-local-dev-key
export TENANT_CONFIGS_JSON='{"fh-demo":{"tenantId":"fh-demo","displayName":"Demo Funeral Home","timezone":"America/Chicago","handoff":{"defaultQueue":"first-call-dispatch","onCallPhone":"+15555550100","dispatchDeskPhone":"+15555550101","afterHoursQueue":"first-call-after-hours"},"features":{"crmHandoff":true,"dispatchHandoff":true,"voiceIntake":true}}}'
npm run build
npm start
```

Endpoints:

- `GET /health`
- `GET /v1/tenants/:tenantId/config`
- `POST /v1/tenants/:tenantId/telephony/:provider/inbound-call`
- `POST /v1/tenants/:tenantId/telephony/:provider/calls/:providerCallId/speech-turn`
- `POST /v1/tenants/:tenantId/telephony/:provider/calls/:providerCallId/audio-turn`
- `POST /v1/tenants/:tenantId/telephony/:provider/calls/:providerCallId/interrupt`
- `POST /v1/tenants/:tenantId/telephony/:provider/calls/:providerCallId/end`
- `POST /v1/tenants/:tenantId/first-call/sessions`
- `POST /v1/tenants/:tenantId/first-call/sessions/:sessionId/transcript`
- `GET /v1/tenants/:tenantId/first-call/sessions/:sessionId/events`
- `GET /v1/tenants/:tenantId/first-call/sessions/:sessionId/replay`

All tenant routes require either `x-api-key` or `Authorization: Bearer <key>`. `GET /health` remains public.

API responses include an `x-request-id` header. If the caller sends `x-request-id`, the server echoes it; otherwise it generates one. The HTTP boundary writes structured request logs with method, path, tenant id, status code, duration, request id, and error code when applicable. Request bodies, transcripts, and API keys are not logged.

`TENANT_CONFIGS_JSON` is optional for local development because the server includes an `fh-demo` default. In staging or production, set it to a JSON object keyed by tenant id so each funeral home can own its display name, timezone, handoff queues, phone routing, and feature flags without a code change.

The tenant config endpoint returns the authenticated tenant's loaded display name, timezone, handoff routing, and feature flags. It is intended for deployment verification and operator debugging; it never returns tenant API keys.

Tenant feature flags gate workflow execution. If `voiceIntake` is disabled, new first-call sessions and telephony inbound calls return `TENANT_FEATURE_DISABLED`. If `crmHandoff` or `dispatchHandoff` is disabled, the workflow emits a `TOOL_SKIPPED` audit event instead of calling that tool. This lets a tenant start with voice intake and human routing before every downstream integration is live.

The generic telephony inbound-call endpoint accepts provider call metadata, creates the first-call session, and returns the opening prompt plus the next expected input. Provider-specific webhook translation should stay outside the core first-call workflow.

The generic speech-turn endpoint accepts provider/STT transcript text, advances the first-call workflow, and returns the next spoken response. When escalation is reached, it returns `nextExpectedInput: "human_handoff"` plus the handoff summary and tenant-specific routing decision.

The generic audio-turn endpoint accepts base64 audio, runs STT, advances the first-call workflow, and returns TTS audio for the response. The default local server uses fake STT/TTS adapters.

The generic interrupt endpoint records caller barge-in, increments the session retry count, and returns voice actions to stop current output and resume listening.

The generic call-end endpoint marks the session as ended and records a `CALL_ENDED` event for replay and audit.

The telephony provider endpoints return a `voiceResponse` action list. This generic envelope can later be translated into provider-specific instructions such as Twilio TwiML, a WebRTC client message, or another voice platform format.

Speech provider contracts live under `src/providers/speech`. Fake STT/TTS adapters are included so call-flow tests can exercise provider boundaries before real credentials or SDKs are introduced.

Model provider contracts live under `src/providers/model`. The first LLM-facing use is a structured-output fallback for first-call fact extraction; deterministic extraction remains primary and the LLM does not control tools, state transitions, CRM, dispatch, or billing.

The transcript endpoint runs deterministic first-call fact extraction, chooses the next call-flow step, updates session facts, and emits fake CRM/dispatch tool results when the collected facts are sufficient.

Transcript text is redacted before it is stored in events. Fact extraction still runs against the original transcript so operational details like callback numbers are not lost before the system can safely route the call.

When a first-call transcript reaches escalation, the response includes a `handoff` summary for the funeral home team member who receives the call plus `handoffRouting`, which identifies the configured on-call phone, dispatch desk, queue, or manual-review fallback.

The replay endpoint returns the current session, stored events, and a compact diagnostic snapshot with event count, latest event, escalation status, tool outcomes, redaction count, and any reconstructed handoff.
