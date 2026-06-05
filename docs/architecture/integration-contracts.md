# Integration Contracts

## Purpose

The voice platform must integrate with dispatch and CRM without becoming tightly coupled to either UI application.

## Current Tool Contracts

Initial funeral-home tool contracts are defined in `src/verticals/funeral-home/tools.ts`.

### CRM Intake

Tool name:

```text
crm.create_intake_lead
```

Purpose:

- Create a CRM-visible lead or case intake record from a call.
- Preserve caller, decedent, urgency, and reason-for-call facts.
- Give human staff a durable record even when the call escalates.

### Dispatch Removal Request

Tool name:

```text
dispatch.create_removal_request
```

Purpose:

- Create a dispatch-reviewable removal request.
- Avoid letting the LLM directly assign drivers, vehicles, or case status.
- Keep dispatch control inside the dispatch product.

## Boundary Rules

- The voice platform requests tools.
- The orchestrator and rules decide whether a tool can run.
- The CRM and dispatch modules own their internal records and workflow.
- Tool adapters should be tenant-scoped and idempotent.
- Tool results should return caller-safe summaries, not raw internal records.
- Human handoff routing uses tenant configuration and returns an operational destination without letting the LLM choose phone numbers, queues, or staff assignments.

## Future Work

- Add JSON schemas for each concrete tool input/output.
- Add idempotency keys based on tenant, call, session, and tool purpose.
- Add audit events for requested, approved, executed, and failed tool calls.
- Add a staging adapter before connecting production CRM or dispatch.

## Current Test Adapters

The current build includes fake adapters at:

```text
src/verticals/funeral-home/fake-adapters.ts
```

They are not production integrations. They exist to prove:

- tool requests are generated from first-call facts
- tool calls go through the registry
- success and failure paths emit audit events
- CRM and dispatch can evolve independently behind stable contracts
