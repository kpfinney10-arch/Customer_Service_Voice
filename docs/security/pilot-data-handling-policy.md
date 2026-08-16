# Pilot Data Handling Policy

Status: owner-approved engineering baseline as of 2026-08-16. Appropriate legal and privacy review is still required before accepting real customer data.

## Purpose

This policy minimizes the sensitive information retained by the LanternBell Voice application during a controlled funeral-home pilot. Voice is an intake and workflow system, not the permanent system of record. Long-term customer records belong in the funeral home's approved CRM or case-management system.

## Recording and Transcript Decision

- Call recording is disabled. The application does not issue Twilio recording instructions or store audio.
- Each speech result is processed transiently by the application for intent and structured fact extraction. Twilio necessarily processes speech to produce `SpeechResult`; provider-side processing and contractual retention must be included in the pre-pilot legal/privacy review.
- Durable `TRANSCRIPT_RECEIVED` events store only `transcriptRetained: false` and redaction-category metadata. They do not store transcript text.
- Migration `004_pilot_data_lifecycle` replaces text in existing transcript events with the same safe metadata.
- Enabling recording or durable transcript text later requires a new documented decision, tenant-specific configuration, access controls, retention rules, caller-notice review, and appropriate legal/privacy approval.

Twilio still maintains provider call-resource metadata even when recording is disabled. Twilio documents normal Calls API retrieval for 13 months and supports deleting past call records. Tenant purge and retention therefore include the corresponding Twilio Call SIDs: <https://www.twilio.com/docs/voice/api/call-resource>. This application policy does not replace review of Twilio's data-processing terms, account settings, and any provider-side diagnostic data associated with speech gathering.

## Approved Retention Schedule

| Data category | Active-system retention | Notes |
| --- | --- | --- |
| Audio recordings | None | Recording remains disabled. |
| Transcript text | None | Processed transiently and not written to durable events or application logs. |
| Call sessions and structured facts | 30 days from last session update | Includes caller/decedent names, callback numbers, pickup addresses, case references, and workflow state. |
| Call events | 30 days with their call session | Contains safe operational outcomes and transcript-event metadata without transcript text. |
| Twilio call-resource records | 30 days | Deleted by Call SID before the corresponding application call data is removed. |
| Idempotency records | 7 days | Supports safe webhook/API retries without long-term response retention. |
| Operator login sessions | 30 days after expiry or revocation | Raw browser tokens are never stored; only digests are stored. |
| Inactive operator accounts | 30 days after deactivation | Tenant offboarding may remove them earlier through the verified tenant purge. |
| Operator access audits | 365 days | Contains operational identifiers and outcomes, not caller facts or transcript text. |
| Purge and retention receipts | Life of the platform unless superseded by reviewed policy | Contains an HMAC tenant fingerprint and aggregate counts, not the tenant ID, caller data, or record contents. |
| Schema migration history | Life of the database | Contains migration identifiers and timestamps only. |

## Access

- Named `owner`, `operator`, and `viewer` users may read tenant-scoped operational call views according to server-side role checks.
- The operator browser does not receive transcript text, structured fact values, caller phone numbers, addresses, raw event payloads, API keys, or password material.
- Owners may read access-audit information when an administrative surface is added; operators and viewers do not receive that permission.
- Engineering database access is limited to authorized maintenance, recovery, incident response, and reviewed deletion operations.

## Tenant Deletion

A verified customer deletion or offboarding request uses the TypeScript data-lifecycle command. Dry-run is the default. Execution requires all of the following:

- exact tenant ID confirmation;
- a unique request ID;
- an opaque requesting-user identifier;
- an approved reason category;
- a server-held HMAC audit secret of at least 32 characters;
- Twilio credentials whenever the tenant has Twilio Call SIDs.

The workflow deletes Twilio call resources first, then deletes only rows matching the tenant inside a PostgreSQL transaction. It removes operator sessions before users and emits a content-free purge receipt. Reusing the same request ID is idempotent; reusing it for another tenant is rejected.

Tenant offboarding must also remove or disable that tenant's API key, tenant configuration, provisioned environment user entry, webhook route, and telephony routing. Otherwise startup synchronization could recreate an environment-provisioned user.

## Backups and Restores

Active-database deletion does not selectively rewrite historical recovery points. Render currently documents a three-day point-in-time recovery window for Hobby workspaces and seven days for Pro or higher; Render-created logical backups are retained for seven days: <https://render.com/docs/postgresql-backups>.

- No long-term logical backup may be exported without an owner, expiry date, encryption, and deletion procedure.
- Purged or expired data can remain in managed recovery points only until the provider recovery window expires.
- A restored database must not receive production traffic until externally retained purge receipts are replayed, the retention command is executed, aggregate validation passes, and the restored environment is rechecked.
- The content-free purge receipt must be stored in the approved operational record outside the restored database so a restore cannot erase the deletion history.

## Application Logs

Application logs contain request paths, response codes, durations, tenant/call/session correlation identifiers, event names, and safe failure categories. They exclude request bodies, transcript text, structured fact values, phone numbers, and addresses. Render documents log retention by workspace plan: seven days for Hobby, 14 days for Pro, and 30 days for Scale/Enterprise: <https://render.com/docs/logging>.

## Review Triggers

Review and reapprove this policy before enabling recordings, durable transcripts, payment workflows, medical workflows, customer-configurable retention, long-term exports, a new telephony provider, or a new permanent system of record.
