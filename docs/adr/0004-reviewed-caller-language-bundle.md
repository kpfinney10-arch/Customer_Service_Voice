# ADR 0004: Reviewed Caller-Language Bundle

Status: Accepted for implementation behind a disabled production flag
Decision date: 2026-09-08

## Context

The release-scoped OpenAI cache removed model latency from live calls, but production drills showed that deployment readiness still depended on nondeterministic provider timing and wording. A deployment could prepare all eight generic prompts successfully while the next deployment failed semantic validation for one prompt, even with identical code and configuration.

The eligible prompts are generic, release-scoped, and independent of caller, tenant, transcript, or collected facts. Regenerating them at every process start adds failure modes and cost without adding caller-specific value.

## Decision

1. Add `CALLER_LANGUAGE_MODE=reviewed` as the production candidate for natural caller-facing wording.
2. Store the eight reviewed English prompts in a versioned, immutable source artifact.
3. Validate every bundled prompt during startup with the same purpose anchors, one-question rule, length bound, and prohibited-content rules used for model output.
4. Report ready only when all eight entries validate. A missing or invalid entry produces degraded readiness and immediate deterministic fallback for that purpose.
5. Serve reviewed wording through the existing in-memory lookup. A live caller turn never invokes or awaits a model.
6. Record the bundle version, cache hit, and zero model usage in content-free readiness, startup logs, and `TTS_STARTED` metadata. Do not durably retain canonical or reviewed wording.
7. Keep `openai` mode available only for controlled non-production generation experiments. It is no longer the recommended production activation path.
8. Keep `deterministic` mode as the immediate rollback without changing ConversationRelay transport, state transitions, tools, or handoff configuration.

## Consequences

- Production startup no longer depends on OpenAI availability, timing, or output consistency.
- Preparation incurs zero model tokens and zero model cost.
- Wording changes become ordinary reviewed code changes with a stable version, diff, test history, and deployment record.
- Natural language remains fixed until a new bundle version is reviewed and deployed.
- The deterministic TypeScript orchestrator continues to own facts, state, tools, pricing containment, escalation, and handoffs.

## Verification

- Unit tests require all eight reviewed prompts to pass the existing semantic validator.
- Invalid or missing bundled wording must degrade readiness and fall back to the exact canonical TypeScript prompt.
- Event tests require the bundle version and zero model usage without retaining caller-facing text.
- The phone-free ConversationRelay smoke requires reviewed readiness, a bundle cache hit within 100 milliseconds, zero model attempts, zero token usage, zero model cost, and both text-retention flags set to false.
