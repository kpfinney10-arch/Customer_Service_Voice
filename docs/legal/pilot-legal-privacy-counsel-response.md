# Pilot Legal and Privacy Counsel Response

- Status: **unreviewed template — not a legal approval**
- Product: LanternBell Voice
- Companion engineering packet: [`pilot-legal-privacy-review-packet.md`](pilot-legal-privacy-review-packet.md)

## Instructions

This worksheet records the qualified review required before LanternBell accepts real funeral-home caller data. It does not ask engineering or the product owner to make legal determinations. For each section, choose `approved`, `approved with required change`, `not applicable`, or `blocked`; identify the authority, agreement, version, and assumptions reviewed; and describe any required implementation or operating control.

Do not record caller data, credentials, API keys, destination phone numbers, or privileged legal advice in this repository copy. Counsel may return a privileged or confidential attachment through an approved secure channel and reference it here by a non-sensitive document identifier.

## Review identification

| Field | Response |
| --- | --- |
| Reviewer name |  |
| Firm/organization and role |  |
| Review date |  |
| LanternBell contracting entity |  |
| Pilot funeral-home contracting entity |  |
| Privileged/confidential attachment identifier, if any |  |
| Laws and source versions reviewed through |  |
| Approved customer/caller jurisdictions |  |
| Excluded customer/caller jurisdictions |  |

## Product and pilot facts acknowledged

Mark each fact `confirmed`, `needs correction`, or `not reviewed`.

| Fact | Status | Correction or condition |
| --- | --- | --- |
| One Texas funeral-home pilot; callers may be located in other states |  |  |
| Inbound calls only; no outbound AI-voice or marketing calls |  |  |
| No more than five simultaneous sessions |  |  |
| Twilio ConversationRelay with Deepgram Flux transcription and ElevenLabs speech |  |  |
| Render-hosted TypeScript service and managed PostgreSQL |  |  |
| Recording disabled; no LanternBell audio storage or durable full transcript |  |  |
| Structured call facts retained for 30 days under the engineering policy |  |  |
| Deterministic extractor; active reviewed language bundle makes no model request |  |  |
| Live handoffs, customer destinations, and production CRM/Dispatch transmission disabled |  |  |
| Payments, medical advice, legal advice, and automated dispatch excluded |  |  |

## Determinations

### 1. Entity, contracts, and processing roles

- Decision:
- Authority/agreements reviewed:
- Required customer contract, DPA, confidentiality, security, deletion, incident, insurance, indemnity, and liability terms:
- LanternBell role by data flow:
- Funeral-home role and documented instructions:
- Required changes and owner:

### 2. Automated-assistant notice and communications consent

- Decision:
- Jurisdictions and assumptions:
- Approved exact opening language:
- Required human, message, opt-out, or after-hours option:
- Treatment of transient speech recognition/transcription:
- Interstate caller rule and any excluded states:
- Required changes and owner:

### 3. Texas and other privacy laws

- Decision:
- Texas Data Privacy and Security Act applicability and roles:
- Sensitive-data/consent requirements:
- Notice and consumer-rights procedure:
- Identity verification, appeal, and response ownership:
- Other state privacy, health-data, biometric/voiceprint, or communications laws:
- Required changes and owner:

### 4. Texas AI law

- Decision:
- TRAIGA applicability:
- Disclosure requirement and approved delivery:
- Health-care-service-provider treatment, if any:
- Prohibited-use, discrimination, documentation, and complaint controls:
- Required changes and owner:

### 5. HIPAA, BAAs, and health-data obligations

- Decision:
- Approved or excluded call lanes:
- Covered-entity/business-associate analysis:
- LanternBell–customer BAA requirement:
- Twilio BAA, account/project, eligible-service, and configuration requirement:
- Render Scale/Enterprise, BAA, and HIPAA-workspace requirement:
- Deepgram/ElevenLabs route coverage or separate agreement requirement:
- FTC Health Breach Notification Rule/state consumer-health-data determination:
- Required changes and owner:

If any approved lane may contain PHI, do not authorize traffic until engineering attaches non-sensitive evidence that every required BAA, eligible service, workspace, and configuration is active. Product eligibility alone is not sufficient.

### 6. Funeral Rule and telephone pricing

- Decision:
- Approved pricing-call disposition:
- Effective-dated GPL/CPL/OBCPL source and change owner, if automated:
- Approved immediate human/callback procedure, if not automated:
- Name/address/phone collection restrictions:
- Business-hours and after-hours procedure:
- Required tests and owner:

The current demo containment is not a final disposition because it neither supplies available price information nor uses an approved real-human procedure.

### 7. Incident and breach obligations

- Decision:
- Notification decision tree and jurisdictions:
- Customer, individual, regulator, vendor, insurer, and law-enforcement responsibilities:
- Decision authority and privilege handling:
- Contractual notice deadlines:
- Required changes and owner:

### 8. Vendor and subprocessor approval

- Decision:
- Twilio documents/version and permitted configuration:
- Deepgram and ElevenLabs route terms/coverage:
- Render documents/version and permitted workspace:
- Cloudflare DNS-only role:
- UptimeRobot aggregate-health-only role:
- OpenAI exclusion or permitted future scope:
- Approved vendor/subprocessor list and change-notice process:
- Required changes and owner:

### 9. Funeral-home operating boundaries

- Decision:
- Approved lanes:
- Excluded lanes:
- Required facility/authority verification:
- Emergency, minor, medical, legal, payment, insurance, and deletion-request procedures:
- Approved retention or required variance:
- Required changes and owner:

## Required engineering and operational changes

| ID | Requirement | Owner | Evidence required | Due date | Status |
| --- | --- | --- | --- | --- | --- |
| LEG-001 |  |  |  |  |  |

## Final bounded-pilot decision

- Decision: `Go` / `Conditional Go` / `No-go`
- Decision date:
- Conditions that must be satisfied before traffic:
- Approved lanes:
- Excluded lanes:
- Approved jurisdictions:
- Pilot expiration or mandatory re-review date:
- Reviewer name and signature/reference:
- LanternBell owner acceptance and date:

## Engineering closure record

Complete only after counsel's response and all required changes are received.

- [ ] Every required change has an implementation owner and acceptance evidence.
- [ ] Approved opening language passes automated and real-audio tests.
- [ ] Pricing uses the approved disposition and passes automated and real-audio tests.
- [ ] Required contracts, DPAs, BAAs, vendor settings, and workspace controls have non-sensitive verification evidence.
- [ ] Approved/excluded lanes and jurisdictions are enforced in configuration and operations.
- [ ] Customer privacy/request and incident contacts are stored in the approved secure system.
- [ ] Real-handoff drill is complete, or live handoffs remain expressly excluded.
- [ ] Exact release, tenant isolation, signed matrix, five-call ceiling, health, and rollback checks pass.
- [ ] Final go/no-go is recorded in `docs/SESSION_HANDOFF.md` without privileged content.
