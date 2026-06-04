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
- `src/session`: call session creation and updates.
- `src/state-machine`: allowed call transitions.
- `src/rules`: deterministic rule evaluation.
- `src/tools`: typed tool registry and execution boundary.
- `src/orchestrator`: first turn-level orchestration slice.
- `src/security`: redaction utilities.
- `src/events`: event construction helpers.
- `src/verticals/funeral-home`: funeral-home-specific intents and rules.
- `docs/architecture/first-call-death-report-intake.md`: MVP call-flow definition.
- `tests/fixtures/first-call`: realistic transcript fixtures and expected extraction/flow outcomes.
- `docs/architecture/integration-contracts.md`: CRM and dispatch handoff boundaries.
- `docs/architecture/mvp-roadmap.md`: staged build plan.
- `schemas`: JSON schema placeholders for shared contracts.
- `docs`: architecture notes and ADRs.

## Build Notes

This scaffold is dependency-light on purpose. Provider-specific telephony, STT, TTS, LLM, CRM, and dispatch adapters should be added behind the existing typed interfaces rather than coupled directly into orchestration code.
