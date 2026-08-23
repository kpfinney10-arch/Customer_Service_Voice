# ADR 0003: Release-Scoped Caller-Language Cache

Status: Accepted for implementation behind the existing disabled production flag  
Decision date: 2026-08-23

## Context

The first constrained caller-language release requested an OpenAI rewrite during each live ConversationRelay turn. Complete-output validation kept the wording safe, but production probes observed provider response times from roughly 1.7 seconds through the 4-second deadline. That exceeds the voice latency budget and makes a caller wait even though the deterministic TypeScript prompt is already available.

The eligible prompts are a small, exact allowlist of generic questions. They contain no caller transcript, collected fact, tenant data, name, phone number, address, or case detail. Generating the same rewrite during every call adds latency and repeated cost without adding useful call-specific behavior.

## Decision

1. In `openai` mode, generate and validate every allowlisted generic rewrite once during process startup. Requests use synthetic system identifiers and never use a caller or tenant identifier.
2. Hold validated generated text only in process memory. A deployment, restart, crash, or scale-out process creates a new release-scoped cache and performs its own preparation.
3. The live ConversationRelay turn path must never call or await OpenAI. It performs an in-memory lookup only.
4. If preparation has not completed, a prompt failed generation or validation, or an entry is absent, speak the exact deterministic TypeScript prompt immediately.
5. Treat the cache as fully ready only when every approved prompt has a validated entry. Partial preparation is reported as degraded even though individual prepared entries remain usable and every missing entry has deterministic fallback.
6. Report preparation state through the authenticated Twilio readiness response. The report contains counts, failure categories, aggregate token usage, estimated one-time cost, and explicit privacy flags, but no canonical or generated wording.
7. Emit one privacy-safe structured startup log for preparation metering. Per-call `TTS_STARTED` events record the cache hit and lookup latency with zero model tokens and zero model cost so one preparation charge is not counted once per caller.
8. Dynamic prompts and any prompt outside the exact allowlist continue to bypass OpenAI and use deterministic wording.

## Consequences

- OpenAI provider latency is removed from the live caller turn.
- A temporary provider outage during startup cannot block service startup or a caller; it produces degraded readiness and deterministic wording.
- Wording remains fixed for the lifetime of a process. Changing the prompt policy, model, or generated wording requires a deployment or restart, which makes the rollout auditable.
- Each running process incurs the small one-time preparation cost. Future horizontal scaling cost estimates must multiply preparation cost by process starts, not by calls.
- Generated wording is not durably stored. It cannot be recovered after process loss and is intentionally regenerated under the deployed policy.

## Verification

- Unit tests cover full preparation, validation failure, provider timeout, cache-not-ready fallback, dynamic-prompt bypass, one-time cost accounting, and zero provider calls from the live path.
- The signed ConversationRelay integration test verifies a cache hit, content-free per-call metering, provider-failure fallback, and no caller transcript in the preparation request.
- The phone-free production smoke requires complete caller-language readiness before opening the WebSocket and requires a generated cache hit within 100 milliseconds.

