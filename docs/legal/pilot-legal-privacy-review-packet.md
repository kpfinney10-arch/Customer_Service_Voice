# Pilot Legal and Privacy Review Packet

Prepared: 2026-08-16  
Product: LanternBell Voice  
Scope: proposed owner-operated, low-volume funeral-home pilot in the United States

## Purpose and limits

This packet gives qualified counsel a factual description of the current system and a bounded list of decisions needed before real customer data is accepted. It is an engineering artifact, not legal advice or a claim of compliance. Counsel should identify the laws, contracts, notices, and operating procedures that apply to LanternBell, each pilot funeral home, callers, and vendors.

Current launch decision: **no real customer data** until the open legal/privacy decisions in this packet are resolved in writing and any required engineering changes are verified.

## Executive summary

- The service answers inbound calls to a funeral home's Twilio number with an automated voice workflow.
- The pilot does not initiate outbound marketing or artificial-voice calls.
- Call recording is disabled, and LanternBell does not retain audio or full transcript text.
- Twilio processes caller speech to return transient speech-recognition text to the application.
- LanternBell retains structured intake facts and operational events for 30 days, with shorter or longer periods for limited security/operations records as documented below.
- The production service runs on Render with managed PostgreSQL. Twilio and Render process or host personal data; Cloudflare is currently DNS-only for the Voice hostname.
- The OpenAI extraction fallback is disabled in production; the approved pilot uses the deterministic TypeScript extractor.
- Handoffs remain simulated, and `fh-demo` is not a real customer tenant.
- The pricing lane is designed to fail closed without requesting contact information or running downstream tools, but its first real-phone check exposed a Twilio punctuation/vocabulary gap. The exact corrective regression passes locally and awaits deployment/recheck. This is containment, not an approved real-customer pricing procedure; automated pricing remains a launch blocker.

## Current data flow

1. A person places an inbound call to the funeral home's Twilio number.
2. Twilio plays LanternBell's TwiML prompts and uses speech recognition to create a `SpeechResult`.
3. Twilio sends a signed HTTPS webhook containing provider metadata and the current speech result to `voice.lanternbell.com`.
4. The Render-hosted TypeScript service verifies the Twilio signature, determines intent, extracts structured facts, and selects the next controlled prompt or workflow action.
5. Managed PostgreSQL stores the tenant-scoped call session, structured facts, safe operational events, operator access audits, and maintenance receipts.
6. The operator console exposes only redacted operational categories and outcomes to a named, tenant-scoped user.
7. UptimeRobot requests only the aggregate public `/health/calls` endpoint. It does not receive caller, tenant, transcript, or case data.

Current production Voice does not send caller data to a production CRM or Dispatch product. Those products are scheduled for a later audit/rebuild and integration phase.

## Data inventory and retention

| Data | Where processed or stored | Current rule |
| --- | --- | --- |
| Live caller audio | Twilio telephony/speech-recognition path | LanternBell recording disabled; no LanternBell audio storage. Confirm Twilio processing and diagnostic retention contractually. |
| Speech-recognition text | Twilio and transient LanternBell request processing | Processed to determine intent and facts; not stored as durable transcript text. |
| Caller and decedent names | Render PostgreSQL structured facts | 30 days from last call-session update. |
| Callback numbers and pickup/contact addresses | Render PostgreSQL structured facts | 30 days from last call-session update. |
| Relationship, place-of-death type, facility, case reference, requested funeral home, urgency, and workflow state | Render PostgreSQL structured facts | 30 days from last call-session update. |
| Safe call events and tool outcomes | Render PostgreSQL | 30 days with the call session; no transcript text or captured fact values in transcript events. |
| Twilio Call SID and call-resource metadata | Twilio and internal deletion boundary | 30-day application policy; LanternBell deletes the Twilio Call resource before deleting corresponding database call data. |
| Idempotency records | Render PostgreSQL | 7 days. |
| Expired or revoked operator sessions | Render PostgreSQL | 30 days after expiry or revocation. |
| Inactive operator accounts | Render PostgreSQL | 30 days after deactivation. |
| Operator access audits | Render PostgreSQL | 365 days; no caller facts or transcript text. |
| Content-free purge/retention receipts | Render PostgreSQL plus approved external operations record | No caller data or tenant ID; retained for the life of the platform unless policy changes. |
| Managed recovery points | Render Postgres | Provider recovery window; restored data is reconciled through retained purge receipts and a retention run before traffic resumes. |
| Application logs | Render | Request paths, status, duration, correlation IDs, event names, and safe failure categories only; no bodies, transcript, fact values, phone numbers, or addresses. |

Detailed engineering policy: [`pilot-data-handling-policy.md`](../security/pilot-data-handling-policy.md).  
Deletion/restore procedure: [`data-lifecycle-operations.md`](../runbooks/data-lifecycle-operations.md).

## Implemented safeguards

- Tenant-scoped storage and server-side authorization.
- Named operator login with role and tenant revalidation on every authenticated request.
- Signed Twilio webhook verification.
- Secure, HTTP-only operator session cookies and durable access auditing.
- No call recordings and no durable full transcript text.
- Migration `004` scrubbed legacy transcript-event text.
- Dry-run-first, exact-confirmation, idempotent tenant purge with content-free receipts.
- Fixed retention cleanup and Twilio call-resource deletion.
- Database point-in-time restore drill and restore reconciliation procedure.
- Redacted public health, operator, and incident evidence.
- Production health monitoring with down and recovery notifications.
- Real handoffs disabled until a separate controlled-phone drill and customer configuration are complete.
- Intent-first automated-assistant opening and a fail-closed pricing design. Its first live verification failed; the corrective patch must be deployed and pass signed plus real-phone revalidation before this safeguard is treated as verified.

## Confirmed operating constraint: telephone pricing

The FTC's current Funeral Rule guidance says a funeral provider must provide accurate available price information to telephone callers who ask about offerings or prices and may not require the caller's name, address, or phone number before providing it.

The intended LanternBell containment ends after identifying pricing intent, says pricing is not enabled, states that contact information is not required, and creates no CRM or dispatch work. The first real-phone check did not select that path because of speech punctuation and vocabulary gaps; a focused patch is pending deployment and recheck. Even after that verification, the containment will not provide approved price-list information or a live human route, so it is not a final real-customer pricing procedure.

Required pre-pilot disposition:

- [ ] Counsel confirms how the Funeral Rule and any stricter pilot-state rules apply to the funeral home and LanternBell workflow.
- [ ] The pilot funeral home supplies controlled, effective-dated General Price List, Casket Price List, and Outer Burial Container Price List data or approves an immediate human-routing procedure.
- [ ] Signed and real-phone evidence confirms the corrected containment path does not require a name, address, or telephone number and does not create a CRM lead.
- [ ] A real pricing caller can obtain required available price information through the counsel- and customer-approved procedure.
- [ ] The workflow does not invent, estimate, summarize incorrectly, or make unauthorized pricing promises.
- [ ] Complex questions route according to a counsel- and customer-approved business-hours/after-hours procedure.
- [ ] Automated and real-phone tests prove the approved behavior before pricing is enabled for a real tenant.

Until those items pass, the real pilot must exclude automated pricing handling or route pricing calls through a separately approved human process.

## Decisions requested from counsel

### 1. Entity and contract roles

- Identify the contracting LanternBell entity and whether LanternBell acts as a controller, processor/service provider, business associate, independent contractor, or another role for each data flow.
- Define the funeral home's responsibilities as customer/controller and LanternBell's documented processing instructions.
- Identify required pilot agreement, data-processing, confidentiality, security, deletion, incident, indemnity, limitation-of-liability, and insurance terms.
- Confirm whether a separate end-customer privacy notice, website privacy policy, terms of service, or call-specific notice is required before launch.

### 2. Automated assistant and call notice

- Approve exact opening language that clearly identifies the automated assistant and the funeral home it serves.
- Determine whether the transient speech-recognition process is an interception, transcription, or other regulated processing even though LanternBell does not save an audio recording or full transcript.
- Determine the consent/notice rule for Texas callers and for callers located in other states. The system can receive calls from anywhere, so Texas-only analysis is insufficient.
- Decide whether a caller must have an immediate human option, a message option, or another opt-out, including after hours.
- Confirm whether the notice must mention Twilio or simply describe the purpose and processing.

Draft for counsel review only; do not deploy without approval:

> Thank you for calling [FUNERAL HOME]. I am LanternBell, an automated assistant helping the funeral director. We do not save an audio recording of this call, but information you provide will be processed to respond to your request. You may ask for a team member at any time.

The final sentence must match the tenant's actual staffing and after-hours routing; the system must not promise an immediate person when none is available.

### 3. Texas and other state privacy law

- Determine whether the Texas Data Privacy and Security Act applies to LanternBell, the funeral home, or both, including processor/controller terms, sensitive-data treatment, notices, consumer rights, deletion, appeals, assessments, and small-business provisions.
- Determine which other state comprehensive privacy, health-data, biometric/voiceprint, wiretap, or call-recording laws apply based on caller and customer locations.
- Confirm that ordinary speech recognition does not create or use a biometric `voiceprint`; if a vendor feature would create one later, require a new review before enabling it.
- Define the consumer/requestor identity-verification process and division of responsibility for access, correction, deletion, and appeal requests.

### 4. Texas AI law

- Determine how the Texas Responsible Artificial Intelligence Governance Act, effective January 1, 2026, applies to LanternBell and each funeral-home customer.
- Confirm whether the proposed automated-assistant disclosure is sufficient and whether any additional disclosure applies to a funeral home as a health-care service provider or other regulated deployer.
- Review prohibited uses, discrimination controls, documentation, complaint handling, and any customer contract allocation.

### 5. HIPAA, decedent information, and health-data rules

- Determine whether LanternBell or a pilot funeral home is a HIPAA covered entity or business associate for any intended call lane. Do not assume that all funeral-home data is or is not PHI.
- Consider calls from hospitals, hospices, nursing facilities, medical examiners, coroners, police, and families. Federal rules allow covered entities to disclose certain PHI to funeral directors as necessary for their duties, but counsel must decide whether LanternBell's processing changes the contractual or business-associate analysis.
- If a HIPAA-regulated workflow is possible, determine whether LanternBell must execute a BAA with the funeral home and whether Twilio and Render must provide BAAs before that lane is enabled.
- Confirm whether the current Twilio account/edition, speech-recognition configuration, and Render workspace/plan are eligible. They are not presently documented as HIPAA-enabled.
- Determine whether the FTC Health Breach Notification Rule or state consumer-health-data laws apply if HIPAA does not.

No HIPAA-regulated real-data pilot should begin unless counsel resolves this section and engineering verifies every required vendor plan, BAA, workspace, product feature, and configuration.

### 6. Incident and breach obligations

- Approve the incident-notification decision tree for the customer, affected individuals, Texas Attorney General, FTC/HHS if applicable, vendors, law enforcement, insurers, and other states.
- Confirm deadlines and thresholds; do not rely on the engineering runbook as a legal notice calculation.
- Approve who may make privilege-sensitive decisions and who is authorized to file regulatory notices.
- Align the customer contract with LanternBell's stop-traffic, evidence-preservation, vendor-escalation, restoration, and deletion-replay procedures.

### 7. Vendor and subprocessor review

- Review and approve the Twilio Terms, Data Protection Addendum, subprocessor list, product-specific terms, retention behavior, deletion limits, speech-recognition configuration, and any required BAA/edition.
- Review and approve the Render Terms, Data Processing Addendum, region, backup/log retention, support access, subprocessor list, security documents, and any required HIPAA-enabled workspace/BAA.
- Confirm Cloudflare's DNS-only role and re-review it if proxying, tunnels, WAF, analytics, or other processing is enabled later.
- Confirm that UptimeRobot receives only content-free health status and re-review if monitoring scope changes.
- Keep OpenAI disabled for real call data unless counsel and the customer approve the OpenAI contractual/data-processing path and engineering completes a separate privacy review.

### 8. Funeral-home operating rules

- Approve the caller-intake boundaries for death reports, transfers, pricing, existing-family questions, service schedules, payment, insurance, medical advice, legal advice, emergencies, and minors.
- Confirm what authority/facility facts can be collected before human verification and what must never trigger automated dispatch.
- Approve whether callers may request deletion and whether the funeral home or LanternBell owns response communications.
- Approve customer-specific retention if it must differ from the conservative 30-day pilot baseline; engineering does not yet support configurable retention.

## Counsel response record

For each item, record: `approved`, `approved with required change`, `not applicable`, or `blocked`, with the reviewer, date, jurisdiction assumptions, contract/version reviewed, required wording, and follow-up owner.

Minimum written launch record:

- [ ] Reviewer name, firm/role, and date.
- [ ] LanternBell contracting entity and pilot funeral-home entity.
- [ ] Approved jurisdictions and excluded jurisdictions.
- [ ] Approved call opening and human/message option.
- [ ] Funeral Rule pricing disposition.
- [ ] HIPAA/BAA and health-breach determination.
- [ ] Texas and other state privacy/AI/communications-law determination.
- [ ] Approved customer and vendor agreements.
- [ ] Approved privacy notice and data-subject request procedure.
- [ ] Approved incident-notification decision tree.
- [ ] List of required engineering changes and evidence of completion.
- [ ] Explicit legal/privacy **Go**, **Conditional Go**, or **No-go** for the bounded pilot.

## Official sources for reviewer verification

These links were checked on 2026-08-16. Counsel should confirm current versions and applicability.

### Texas

- [Texas Penal Code Chapter 16, including Section 16.02](https://statutes.capitol.texas.gov/Docs/PE/pdf/PE.16.pdf)
- [Texas Business & Commerce Code Chapter 541, Texas Data Privacy and Security Act](https://statutes.capitol.texas.gov/Docs/BC/pdf/BC.541.pdf)
- [Texas Attorney General data-breach reporting guidance](https://www.texasattorneygeneral.gov/consumer-protection/data-breach-reporting)
- [Texas Attorney General TRAIGA consumer AI rights overview](https://www.texasattorneygeneral.gov/consumer-protection/file-consumer-complaint/consumer-ai-rights)
- [Texas HB 149 enrolled bill summary and effective date](https://capitol.texas.gov/billlookup/BillSummary.aspx?Bill=HB149&LegSess=89R)

### Federal

- [FTC: Complying with the Funeral Rule](https://www.ftc.gov/business-guidance/resources/complying-funeral-rule)
- [HHS: Covered entities and business associates](https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html)
- [HHS: Health information of deceased individuals](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/health-information-of-deceased-individuals/index.html)
- [45 CFR 164.512(g): disclosures to funeral directors](https://www.law.cornell.edu/cfr/text/45/164.512)
- [FTC Health Breach Notification Rule](https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule)
- [FCC declaratory ruling on outbound AI-generated artificial voice calls](https://docs.fcc.gov/public/attachments/FCC-24-17A1_Rcd.pdf) — relevant if LanternBell later initiates outbound AI-voice calls; the current pilot is inbound only.

### Vendors

- [Twilio Data Protection Addendum](https://www.twilio.com/en-us/legal/data-protection-addendum)
- [Twilio Call resource retention and deletion](https://www.twilio.com/docs/voice/api/call-resource)
- [Twilio HIPAA account requirements](https://www.twilio.com/docs/iam/twilio-editions/hippa)
- [Twilio HIPAA-eligible services](https://www.twilio.com/content/dam/twilio-com/global/en/other/hipaa/pdf/HIPAA-Eligible-Services.pdf)
- [Render Data Processing Addendum](https://render.com/dpa)
- [Render HIPAA-enabled workspace requirements](https://render.com/docs/hipaa-compliance)

## Change control

Repeat or amend this review before enabling a new state, new customer type, recordings, durable transcripts, live CRM/Dispatch transmission, real handoffs, automated pricing, payment processing, medical workflows, outbound AI voice, OpenAI extraction, customer-configurable retention, a new telephony/hosting provider, or a new permanent system of record.
