# LanternBell Product Scope of Work

Status: Agreed product direction; active implementation remains limited to Voice  
Decision date: 2026-08-01

## Purpose

This document records the agreed scope boundaries for the LanternBell product program. It distinguishes the currently authorized Voice work from planned future modules so long-term compatibility can shape engineering decisions without creating uncontrolled scope expansion.

## Product Vision

LanternBell will become an integrated software platform for funeral-home operations:

- Voice handles inbound conversations and safely initiates operational workflows.
- CRM maintains customer, family, case, and interaction records.
- Dispatch coordinates assignments, statuses, notifications, and field operations.
- The public website supports customer acquisition.
- The authenticated customer gateway provides a unified entry point to LanternBell products.

The products should feel seamless to customers while retaining clear service, data-ownership, security, and deployment boundaries.

## Active Authorized Scope: Voice

The current work remains focused on completing and hardening the funeral-home Voice application for a controlled production pilot.

Included outcomes:

- Reliable supported call workflows and deterministic orchestration.
- Safe handling of unsupported, urgent, sensitive, failed, and interrupted calls.
- Typed and audited tool execution with fake CRM and Dispatch adapters until real integrations are authorized.
- Tenant isolation, authentication, access control, sensitive-data redaction, and durable storage.
- Production deployment, health monitoring, recovery validation, operator review, and operating runbooks.
- Automated unit, integration, security, and call-scenario coverage appropriate to changed behavior.
- A controlled pilot readiness decision based on evidence from live testing and operational checks.

The Voice milestone means production-ready for a controlled pilot, not feature-complete forever. Lower-value refinements may be prioritized after real customer feedback.

## Planned Future Scope

The following work is approved as product direction but is not yet active implementation scope:

1. Audit the existing Lovable-built CRM and Dispatch repositories.
2. Decide independently whether to retain, harden, modernize, selectively reuse, or replace each application.
3. Establish shared identity, tenancy, authorization, audit, API, event, navigation, and design foundations.
4. Build or modernize CRM as the likely system of record, subject to audit findings.
5. Integrate Voice with CRM through typed, versioned contracts.
6. Build or modernize Dispatch and integrate it through APIs and events.
7. Build the public LanternBell website and separate authenticated customer gateway.
8. Add consolidated onboarding, administration, reporting, support, and billing capabilities when justified.

Each future phase requires a specific discovery and go/no-go decision before implementation.

## Existing CRM and Dispatch Code

The existing applications are treated as working prototypes, not automatically as production foundations or disposable code. Their workflows, terminology, screens, and business behavior may be valuable even when implementation details are not.

The later audit will evaluate:

- Product behavior and workflow fit.
- Architecture and maintainability.
- Security, privacy, authentication, authorization, and tenant isolation.
- Data ownership, schema quality, and migration feasibility.
- Testability and existing automated coverage.
- Integration boundaries and external dependencies.
- Deployment, monitoring, recovery, and operating cost.
- Technical debt and the cost/risk of modernization compared with replacement.

## Platform Engineering Requirements

- Use TypeScript as the default application and integration language unless a documented technical decision justifies an exception.
- Use explicit, typed, versioned module contracts.
- Keep tenant and organization identity consistent across modules.
- Use named users, roles, permissions, short-lived sessions, and access auditing for customer applications.
- Give each module authoritative ownership of its data; prohibit direct cross-module database access.
- Make cross-module commands and events authenticated, authorized, idempotent, auditable, and observable.
- Keep services independently deployable even when they share repositories, libraries, visual conventions, or infrastructure.
- Apply consistent security, testing, deployment, observability, backup, and recovery standards.
- Preserve sensitive-data minimization and least-privilege access throughout the platform.

## Scope Guardrails and Non-Goals

- The master roadmap does not authorize simultaneous development of all products.
- "Same platform" does not mean a mandatory monolith, single database, or premature microservice decomposition.
- We will not choose rebuild versus modernization before inspecting the existing applications.
- We will not couple Voice orchestration to CRM or Dispatch implementation details while fake adapters are in use.
- We will not delay the Voice pilot for speculative future features.
- We will not combine the public marketing surface with authenticated product authorization concerns merely because they share a brand or domain.

## Phase Completion and Change Control

A phase is complete when its agreed acceptance criteria and relevant quality, security, deployment, recovery, documentation, and operational checks pass. Perfection and exhaustive future functionality are not completion requirements.

Material additions, reordered phases, shared-data changes, or new customer-impacting integrations require an explicit scope decision and corresponding roadmap/documentation update.

The detailed sequence is maintained in [the master product roadmap](architecture/mvp-roadmap.md).
