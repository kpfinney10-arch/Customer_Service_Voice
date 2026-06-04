# ADR 0001: Initial Voice Platform Scaffold

## Status

Accepted

## Context

The larger funeral home platform will include dispatch, CRM, and voice AI customer service modules. The voice AI module must not become an isolated chatbot that later needs to be stitched into the platform.

## Decision

Start with a provider-agnostic TypeScript scaffold focused on deterministic orchestration:

- Explicit call session model.
- Explicit state machine.
- Typed event creation.
- Deterministic rule evaluation.
- Typed tool registry.
- Funeral-home-specific intent and rules as a vertical module.

Provider integrations are deferred until contracts are stable.

## Consequences

This creates more structure up front, but it reduces future risk around debugging, tenant isolation, customer growth, CRM/dispatch integration, and unsafe LLM behavior.

