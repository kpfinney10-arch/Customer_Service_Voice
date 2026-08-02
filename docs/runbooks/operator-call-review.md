# Operator Call Review

## Purpose

Use the browser-based operator console during controlled call testing to confirm how the deterministic workflow handled recent calls. The first version intentionally exposes only redacted session summaries and event metadata.

Production URL:

`https://voice.lanternbell.com/operator/calls`

## Sign In

1. Open the operator URL over HTTPS.
2. Keep the tenant ID as `fh-demo` for the current demo environment.
3. Retrieve the Render tenant API key from macOS Keychain without writing it to a file:

   ```bash
   security find-generic-password -s "LanternBell Render Tenant API Key" -w
   ```

4. Paste the key into the API key field and select **Load activity**.
5. Use **Refresh** after a test call.
6. Select **Review** on a call row to open its redacted detail panel.
7. Use **Forget key** when the review is finished.

## Data Shown

- Recent session state, intent, escalation score, retry count, timestamps, and shortened session ID.
- Recent event type, redaction status, timestamp, and shortened correlation ID.
- Aggregate counts for sessions shown, calls still in progress, and escalated calls.
- A selected call's duration, event count, retry count, and redacted-turn count.
- Completed and failed tool names.
- Captured and missing information category names without their values.
- The complete event-type timeline, including safe tool outcomes and duplicate-prevention reasons.
- Safe Twilio handoff screening and final outcomes, without destination or caller details.

The console does not request or display raw event payloads, transcripts, caller phone numbers, names, addresses, or captured structured fact values. It never calls the raw replay endpoint.

## Credential Handling

- The API key is stored only in `sessionStorage`, so it is limited to the current browser tab and is removed when the tab is closed.
- The key is sent to the same-origin tenant diagnostics endpoint in an `Authorization: Bearer` header.
- The key is never placed in the URL, HTML, source repository, logs, cookies, or long-lived browser storage.
- Do not paste the key into screenshots, support messages, or shared documents.
- The current API-key screen is for controlled demo testing. Before funeral-home staff use the console, replace it with named users, role-based authorization, short-lived sessions, and access auditing.

## Troubleshooting

- **API key is required:** enter the tenant key and retry.
- **API key is not authorized:** confirm the key belongs to the displayed tenant ID.
- **No sessions found:** complete a call against the same deployment and tenant, then refresh.
- **Service unavailable:** check `https://voice.lanternbell.com/health/calls` and the independent uptime monitor before changing any call settings.
