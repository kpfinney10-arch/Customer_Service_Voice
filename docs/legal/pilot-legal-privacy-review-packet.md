# Pilot Legal and Privacy Review Packet

- Prepared: 2026-08-16
- Last engineering refresh: 2026-09-08
- Product: LanternBell Voice
- Scope: proposed owner-operated, low-volume funeral-home pilot in the United States

## Purpose and limits

This packet gives qualified counsel a factual description of the current system and a bounded list of decisions needed before real customer data is accepted. It is an engineering artifact, not legal advice or a claim of compliance. Counsel should identify the laws, contracts, notices, and operating procedures that apply to LanternBell, each pilot funeral home, callers, and vendors.

Current launch decision: **no real customer data** until the open legal/privacy decisions in this packet are resolved in writing and any required engineering changes are verified.

## Executive summary

- The service answers inbound calls to a funeral home's Twilio number with an automated voice workflow. The prospective first pilot is a Texas funeral home, but callers may be located in other states.
- The pilot does not initiate outbound marketing or artificial-voice calls.
- Call recording is disabled, and LanternBell does not retain audio or full transcript text.
- Twilio ConversationRelay processes live audio and supplies transient Deepgram speech-recognition text to the application; it converts application text to speech using ElevenLabs.
- LanternBell retains structured intake facts and operational events for 30 days, with shorter or longer periods for limited security/operations records as documented below.
- The production service runs on Render with managed PostgreSQL. Twilio and Render process or host personal data; Cloudflare is currently DNS-only for the Voice hostname.
- The OpenAI extraction fallback is disabled in production; the pilot candidate uses the deterministic TypeScript extractor. The active reviewed caller-language bundle is a versioned source artifact and makes no OpenAI request.
- Handoffs remain simulated. The prospective tenant configuration is local, disabled, has no destination number, and is not deployed.
- The prospective pilot is bounded to five simultaneous inbound calls and the seven currently tested lanes. Outbound calling, live transfers, payments, medical or legal advice, automated dispatch, and production CRM/Dispatch transmission remain excluded.
- The pricing lane now has deployed automated and real-phone evidence that it fails closed without requesting contact information or running downstream tools. The final demo call ended after explaining that pricing and a staff transfer were unavailable, with no further gather or dial. This is containment, not an approved real-customer pricing procedure; automated pricing remains a launch blocker.

## Current data flow

1. A person places an inbound call to the funeral home's Twilio number.
2. Twilio sends a signed HTTPS webhook to `voice.lanternbell.com`; LanternBell verifies it and returns TwiML that opens a ConversationRelay connection.
3. Twilio sends live audio through its selected ConversationRelay speech-recognition path (currently Deepgram Flux) and delivers transient recognized text over a signed WebSocket. LanternBell does not receive or store an audio stream.
4. The Render-hosted TypeScript service determines intent, extracts structured facts, and selects the next controlled prompt or workflow action. State transitions, tool permissions, pricing containment, and handoffs are deterministic.
5. LanternBell sends response text to ConversationRelay, which currently uses an ElevenLabs voice to speak it. The active reviewed bundle contains eight generic, pre-reviewed phrases; prompts containing recognized names or addresses remain deterministic. No OpenAI or generative language-model request occurs during a production turn; ConversationRelay still uses its configured speech-recognition and text-to-speech models.
6. Managed PostgreSQL stores the tenant-scoped call session, structured facts, safe operational events, operator access audits, and maintenance receipts.
7. The operator console exposes only redacted operational categories and outcomes to a named, tenant-scoped user.
8. UptimeRobot requests only the aggregate public `/health/calls` endpoint. It does not receive caller, tenant, transcript, or case data.

Current production Voice does not send caller data to a production CRM or Dispatch product. Those products are scheduled for a later audit/rebuild and integration phase.

## Bounded pilot assumptions for review

The requested first-pilot review is limited to one Texas funeral home, inbound calls, no more than five simultaneous sessions, and these seven tested categories:

1. Hospice or nursing-facility death report.
2. Medical-examiner death report.
3. Hospital release or death report.
4. Police-reported residence death.
5. Family-reported residence death requiring authority verification.
6. Pricing or service-cost inquiry.
7. Existing-family or office-hours follow-up inquiry.

These categories describe routing tests, not legal approval. Counsel may exclude or condition any category. The pilot must not use the selected funeral home's identity, credentials, phone destinations, or caller data until the launch record is complete and the corresponding tenant remains disabled.

## Known open launch blockers

- No counsel response, approved pilot agreement, data-processing terms, or legal go/no-go has been recorded.
- The current automated-assistant opening has engineering acceptance but no recorded legal approval.
- The interstate communications/consent analysis is incomplete; inbound callers may be outside Texas.
- The HIPAA/BAA and consumer-health-data determination is incomplete. The current Render workspace is not documented as HIPAA enabled, and the Twilio account/project BAA configuration has not been verified.
- Deepgram and ElevenLabs provider-path terms and any required coverage or agreements have not been approved for real caller data.
- The current pricing lane is safe demo containment only; it does not yet give the caller required available price information or an approved live route.
- The funeral home's privacy/request procedure, incident-notification ownership, and required customer-facing notices have not been approved.
- The real-handoff drill and customer destination configuration remain incomplete.

## Data inventory and retention

| Data | Where processed or stored | Current rule |
| --- | --- | --- |
| Live caller audio | Twilio ConversationRelay and its selected speech provider | LanternBell recording disabled; LanternBell receives no audio stream and stores no audio. Confirm Twilio, Deepgram-path, and diagnostic processing/retention contractually. |
| Speech-recognition text | Twilio ConversationRelay/Deepgram path and transient LanternBell WebSocket processing | Processed to determine intent and facts; not stored as durable transcript text. |
| Spoken application response | LanternBell, Twilio ConversationRelay, and ElevenLabs path | Application text is converted to audio for the caller. Reviewed generic wording is versioned in source; dynamic response text is not retained as transcript text. Confirm provider processing/retention contractually. |
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
- Intent-first automated-assistant opening and a fail-closed pricing design. The initial live recognition failures are pinned in automated regressions, and the corrected guard passed a final signed real-phone call against deployed commit `f34e848` with no contact prompt, gather, dial, CRM, or dispatch action.
- Signed ConversationRelay WebSocket validation across all seven lanes passed in batches of up to five simultaneously open calls under run `render-conversation-relay-concurrency-5-1788907443`; handoffs remained simulated and no real customer data was used.
- Current deployed application release: `d9f8d284007da9238022ccefc33bffbdf6242ea3`, with the selected Eric ElevenLabs voice and reviewed caller-language bundle. Later repository-only test/documentation commits do not change the deployed runtime.

## Confirmed operating constraint: telephone pricing

The FTC's current Funeral Rule guidance says a funeral provider must provide accurate available price information to telephone callers who ask about offerings or prices and may not require the caller's name, address, or phone number before providing it.

The LanternBell containment ends after identifying pricing intent, says that the automated assistant cannot provide pricing, states that contact information is not required, and creates no CRM or dispatch work. The initial real-phone checks exposed punctuation, vocabulary, and `know one/know 1` recognition gaps; those variants are now pinned in automated regressions. Final real-phone call `CAb263deda9817bf9960c6720c11cce0d8` passed against deployed commit `f34e848`, returning the simulation-only closure and a hangup with no follow-up gather or dial. The containment still does not provide approved price-list information or a live human route, so it is not a final real-customer pricing procedure.

Required pre-pilot disposition:

- [ ] Counsel confirms how the Funeral Rule and any stricter pilot-state rules apply to the funeral home and LanternBell workflow.
- [ ] The pilot funeral home supplies controlled, effective-dated General Price List, Casket Price List, and Outer Burial Container Price List data or approves an immediate human-routing procedure.
- [x] Signed and real-phone evidence confirms the corrected containment path does not require a name, address, or telephone number and does not create a CRM lead.
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

Current deployed generic opening, provided for comparison and not yet legally approved:

> I am an automated assistant helping the funeral director. How may I help you today?

The current opening discloses automation before collecting facts but does not identify the funeral home, describe transient speech processing, or promise a human/message option. Counsel should approve either this exact form or replacement wording. Any approved replacement requires automated, phone-free, and real-audio verification before customer traffic.

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
- Twilio currently identifies ConversationRelay as HIPAA eligible when properly configured and used under a signed Twilio BAA. That product eligibility is not itself proof that this account, project, provider path, or application is HIPAA compliant.
- Render currently requires a Scale or Enterprise plan, a signed BAA, and explicit irreversible HIPAA workspace enablement. Render instructs customers never to process or store PHI outside a HIPAA-enabled workspace. The current workspace is not documented as HIPAA enabled.
- If counsel classifies an intended lane as involving PHI, that lane remains blocked until the Twilio account/project and every used Twilio service are verified against the signed BAA, the Render workspace is appropriately upgraded and enabled, the application's shared-responsibility controls are verified, and any other required vendor agreements are complete.
- Determine whether the FTC Health Breach Notification Rule or state consumer-health-data laws apply if HIPAA does not.

No HIPAA-regulated real-data pilot should begin unless counsel resolves this section and engineering verifies every required vendor plan, BAA, workspace, product feature, and configuration.

### 6. Incident and breach obligations

- Approve the incident-notification decision tree for the customer, affected individuals, Texas Attorney General, FTC/HHS if applicable, vendors, law enforcement, insurers, and other states.
- Confirm deadlines and thresholds; do not rely on the engineering runbook as a legal notice calculation.
- Approve who may make privilege-sensitive decisions and who is authorized to file regulatory notices.
- Align the customer contract with LanternBell's stop-traffic, evidence-preservation, vendor-escalation, restoration, and deletion-replay procedures.

### 7. Vendor and subprocessor review

- Review and approve the Twilio Terms, Data Protection Addendum, subprocessor list, Predictive and Generative AI/ML Features Addendum, product-specific terms, retention behavior, deletion limits, ConversationRelay configuration, and any required BAA/account configuration.
- Review the current Deepgram Flux speech-recognition and ElevenLabs text-to-speech routes exposed through Twilio ConversationRelay. Confirm the contractual roles, data-use and retention terms, geographic processing, and whether the selected routes fall within the required BAA coverage or require separate agreements. Do not infer coverage merely because Twilio lists ConversationRelay as HIPAA eligible.
- Review and approve the Render Terms, Data Processing Addendum, region, backup/log retention, support access, subprocessor list, security documents, and any required HIPAA-enabled workspace/BAA.
- Confirm Cloudflare's DNS-only role and re-review it if proxying, tunnels, WAF, analytics, or other processing is enabled later.
- Confirm that UptimeRobot receives only content-free health status and re-review if monitoring scope changes.
- Keep OpenAI disabled for real call data unless counsel and the customer approve the OpenAI contractual/data-processing path and engineering completes a separate privacy review.
- The active reviewed caller-language production bundle makes no OpenAI request and sends no caller, tenant, transcript, collected-fact, or prompt data to a model. Its eight generic prompts are versioned source artifacts validated at startup; prompts containing dynamic recognized names or addresses stay deterministic. OpenAI caller-language generation is limited to controlled non-production experiments and is not an approved real-data path.

### 8. Funeral-home operating rules

- Approve the caller-intake boundaries for death reports, transfers, pricing, existing-family questions, service schedules, payment, insurance, medical advice, legal advice, emergencies, and minors.
- Confirm what authority/facility facts can be collected before human verification and what must never trigger automated dispatch.
- Approve whether callers may request deletion and whether the funeral home or LanternBell owns response communications.
- Approve customer-specific retention if it must differ from the conservative 30-day pilot baseline; engineering does not yet support configurable retention.

## Counsel response record

Use [`pilot-legal-privacy-counsel-response.md`](pilot-legal-privacy-counsel-response.md) to record each determination as `approved`, `approved with required change`, `not applicable`, or `blocked`, with the reviewer, date, jurisdiction assumptions, contract/version reviewed, required wording, and follow-up owner.

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

These links were refreshed on 2026-09-08. Counsel should confirm current versions and applicability.

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
- [eCFR 45 CFR 164.512(g): disclosures to funeral directors](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.512)
- [FTC Health Breach Notification Rule](https://www.ftc.gov/legal-library/browse/rules/health-breach-notification-rule)
- [FCC declaratory ruling on outbound AI-generated artificial voice calls](https://docs.fcc.gov/public/attachments/FCC-24-17A1_Rcd.pdf) — relevant if LanternBell later initiates outbound AI-voice calls; the current pilot is inbound only.

### Vendors

- [Twilio Data Protection Addendum](https://www.twilio.com/en-us/legal/data-protection-addendum)
- [Twilio Call resource retention and deletion](https://www.twilio.com/docs/voice/api/call-resource)
- [Twilio ConversationRelay reference and HIPAA configuration note](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay)
- [Twilio Predictive and Generative AI/ML Features Addendum](https://www.twilio.com/en-us/legal/ai-terms/predictive-generative-ai-features)
- [Twilio Architecting for HIPAA](https://www.twilio.com/content/dam/twilio-com/global/en/other/hipaa/pdf/Architecting-for-HIPAA.pdf)
- [Twilio HIPAA-eligible services](https://www.twilio.com/content/dam/twilio-com/global/en/other/hipaa/pdf/HIPAA-Eligible-Services.pdf)
- [Render Data Processing Addendum](https://render.com/dpa)
- [Render HIPAA-enabled workspace requirements](https://render.com/docs/hipaa-compliance)

## Change control

Repeat or amend this review before enabling a new state, new customer type, recordings, durable transcripts, live CRM/Dispatch transmission, real handoffs, automated pricing, payment processing, medical workflows, outbound AI voice, OpenAI extraction, customer-configurable retention, a new telephony/hosting provider, or a new permanent system of record.
