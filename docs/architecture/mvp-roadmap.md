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
- Tenant diagnostics activity endpoint for early human testing.
- Redacted operator call-review page for recent session and audit-event summaries.
- Tenant feature flags for voice intake access and CRM/dispatch tool execution.
- Structured API request logging with request ids and tenant context.
- Tenant-route rate limiting with `429` responses and retry headers.
- Tenant POST idempotency keys for webhook retry protection.
- Telephony webhook signature verification scaffold.
- File-backed idempotency replay records for restart-safe retry protection.
- Environment-configurable rate-limit window and request count.
- Startup environment validation with structured startup errors.
- Graceful shutdown handling for `SIGINT` and `SIGTERM`.
- Public build/version endpoint for deployment identification.
- File-backed session and event persistence for early human testing.
- Local human-testing runbook and smoke script.
- Telnyx webhook testing runbook and smoke script.
- Telnyx smoke script coverage for initiated calls and AI gather speech-turn handoff.
- Telnyx readiness preflight endpoint for dry-run and controlled live testing.
- Telnyx provider command audit events for dry-run and controlled live diagnostics.
- Replay snapshot provider command summaries for live-test troubleshooting.
- Telnyx smoke script replay verification for handoff and provider command summaries.
- Sanitized Telnyx command failure summaries for live-test troubleshooting.
- Session replay snapshot endpoint for debugging and future replay tooling.
- Scenario tests.

## Phase 2: Provider Adapters

- Generic telephony inbound-call webhook boundary.
- Generic telephony speech-turn boundary.
- Generic telephony audio-turn boundary.
- Generic telephony call-end boundary.
- Generic voice response action envelope.
- Telnyx Call Control webhook adapter boundary.
- Telnyx Call Control client adapter with dry-run default.
- Telnyx AI gather speech-turn event translation.
- Telnyx `gather_using_speak` command strategy for live caller speech collection.
- Telephony streaming interface for live audio sessions.
- Signed Twilio ConversationRelay WebSocket transport behind a disabled production feature switch, initially reusing deterministic orchestration and simulated handoffs.
- STT adapter contract and fake adapter.
- TTS adapter contract and fake adapter.
- Barge-in and cancellation model.
- LLM structured-output adapter contract and fake fallback extractor.
- Constrained caller-language generation after ConversationRelay transport acceptance: the buffered, structured, allowlisted foundation is complete behind a default-off switch with deterministic fallback and content-free usage/cost metering. Direct token streaming remains a later latency optimization; state, rules, tools, pricing policy, and handoffs remain deterministic.

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
- Audit log UI with redacted activity and per-call timeline views behind named, role-based production access.
- Persisted orchestration-turn latency and repeated-prompt health classification for the controlled pilot; deeper provider/STT/TTS metrics remain future work.
- Replayable call timeline (initial redacted operator timeline complete; engineering replay remains available).
- Signed Twilio screening and final handoff outcome callbacks with caller-safe failure fallback and aggregate alerting.
- Load and scenario testing.

## Phase 5: Platform Integration

- CRM handoff.
- Dispatch handoff.
- Billing/reporting hooks.
- Shared tenant and user model.
- Cross-module event taxonomy.

## LanternBell Master Product Roadmap

This is the agreed product sequence. Future phases document direction and architectural constraints; they do not authorize work that would interrupt the active voice-platform scope.

### Phase A: Complete and Pilot Voice

- Bring the voice application to a production-ready controlled-pilot milestone rather than waiting for theoretical perfection.
- Require reliable core call paths, safe failure and escalation behavior, tenant isolation, access control, redaction, durable data, monitoring, recovery procedures, and tested operating runbooks.
- Use pilot results to prioritize remaining voice work by customer and operational value.

### Phase B: Audit the Existing CRM and Dispatch Applications

- Treat the Lovable-built applications as working product prototypes and sources of validated workflows, terminology, and user-interface requirements.
- Review each application for architecture, security, tenant isolation, data model quality, tests, integrations, deployment, maintainability, and reusable behavior.
- Make a separate evidence-based decision for each module: retain and harden, incrementally modernize, selectively reuse, or replace.
- Do not assume that both applications require the same remediation strategy.

### Phase C: Establish the Shared Platform Foundation

- Define shared organization and tenant identifiers, named users, roles, permissions, session behavior, and access auditing.
- Treat the Voice operator identity boundary as the pilot implementation of those concepts, while deferring the shared identity-provider decision until the CRM and Dispatch audits.
- Define versioned APIs, cross-module event conventions, integration authentication, idempotency, and error contracts.
- Use TypeScript as the default application and integration language unless a documented audit finding justifies an exception.
- Establish common product navigation and design conventions without creating a tightly coupled monolith.

### Phase D: Build or Modernize CRM

- Make CRM the likely system of record for customer, family, case, and interaction data, subject to findings from the audit.
- Apply the same explicit engineering, security, testing, observability, tenancy, and deployment standards used for Voice.
- Migrate existing data and workflows only through an explicit, tested migration plan.

### Phase E: Connect Voice to CRM

- Replace fake CRM behavior through the existing typed tool boundary.
- Keep voice orchestration isolated from CRM storage and implementation details.
- Make cross-module actions authorized, idempotent, auditable, observable, and safe to retry.

### Phase F: Build or Modernize Dispatch

- Implement Dispatch using the audit decision and shared platform standards.
- Connect Dispatch to CRM and Voice through versioned APIs and events rather than shared database access.
- Preserve explicit ownership of dispatch assignments, statuses, notifications, and operational history.

### Phase G: Build the LanternBell Web Presence and Customer Gateway

- Build a public marketing and customer-acquisition experience for prospective customers.
- Build a separate authenticated gateway where existing customers can launch and navigate LanternBell products.
- Allow both experiences to share the LanternBell brand and domain strategy while maintaining separate security and deployment concerns.

### Phase H: Consolidate Platform Operations

- Add unified customer onboarding, administration, reporting, support tooling, and billing capabilities when product usage justifies them.
- Provide cross-product operational visibility without weakening module ownership or tenant isolation.

## Roadmap Guardrails

- A shared platform means shared identity, contracts, standards, and user experience; it does not require one codebase, one deployment, or one database.
- Voice, CRM, Dispatch, and the customer gateway must remain independently deployable and evolvable.
- No module may read or write another module's database directly.
- Current fake CRM and Dispatch adapters remain replaceable typed boundaries until real integrations are authorized.
- Future compatibility should guide present architecture without delaying completion of the active Voice milestone.
- Each phase has a deliberate go/no-go decision before material implementation begins.
