# Voice Platform Scaffold

## Purpose

This scaffold starts the voice AI system from the architecture principles already documented in the parent project. The first code slice is intentionally small and deterministic.

## Current Boundaries

- Domain types define call states, events, intents, sentiment, and escalation reasons.
- Session module creates and updates tenant-scoped call sessions.
- State machine module validates legal state transitions.
- Rules module evaluates deterministic business rules.
- Tool registry defines the execution boundary for CRM, dispatch, billing, scheduling, and future integrations.
- Funeral home tools define CRM intake and dispatch request handoff contracts.
- Orchestrator module handles one transcript turn without direct provider coupling.
- Redaction module removes common sensitive data before logging.

## Next Implementation Slices

1. Add provider-agnostic telephony gateway interfaces.
2. Add STT/TTS adapter interfaces.
3. Add LLM structured-output interface.
4. Add persistence for sessions and events.
5. Add scenario tests for funeral home call flows.
6. Add admin-visible prompt/rule versioning.

## Design Constraint

Any module that can affect a customer, case, dispatch job, CRM record, bill, or escalation must go through typed tools and rules. Do not wire LLM output directly to external systems.
