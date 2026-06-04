# AGENTS.md

## Mission

Build a secure, scalable voice-AI customer service platform for funeral home operations. Treat this module as sensitive production infrastructure, not a chatbot prototype.

## Source Of Truth

Read the parent project guidance first:

- `../AGENTS.md`
- `../docs/architecture/overview.md`
- `../docs/architecture/state-machine.md`
- `../docs/architecture/event-model.md`
- `../docs/architecture/rules-engine.md`
- `../docs/architecture/tool-calling.md`
- `../docs/architecture/multi-tenancy.md`
- `../docs/architecture/observability.md`
- `../docs/security/pii-redaction.md`
- `../docs/testing/call-scenario-tests.md`

Use local files in this module for implementation-specific decisions.

## Non-Negotiables

- The LLM never directly calls CRM, dispatch, billing, telephony, storage, or database APIs.
- Tool requests must be typed, validated, authorized, rate-limited, and audited.
- State transitions must be explicit and testable.
- PII and sensitive death-care details must be redacted from logs unless there is a documented exception.
- Tenant context is required in sessions, events, tools, rules, and logs.
- Escalation behavior must be available for urgent, high-risk, or unsupported calls.

## Implementation Style

- Prefer small pure modules for orchestration, rules, state transitions, and contracts.
- Keep provider adapters thin and replaceable.
- Add scenario tests for call-flow behavior before expanding capabilities.
- Keep integration points for CRM and dispatch explicit.

