# Operator Call Review

## Purpose

Use the browser-based operator console during controlled call testing to confirm how the deterministic workflow handled recent calls. The console exposes only redacted session summaries and operational event metadata.

Production URL:

`https://voice.lanternbell.com/operator/calls`

## Sign In

1. Open the operator URL over HTTPS.
2. Keep the tenant ID as `fh-demo` for the current demo environment.
3. Enter the email and password for a named operator account.
4. Select **Sign in**, then use **Refresh** after a test call.
5. Select **Review** on a call row to open its redacted detail panel.
6. Select **Sign out** when the review is finished.

The browser session expires after 30 minutes without an authenticated request and after eight hours regardless of activity.

## First-Account Provisioning

Generate the account configuration locally. The command hides password input and outputs only a memory-hard password hash:

```bash
npm run operator:provision -- --email kpfinney10@gmail.com --name "Kyle Finney" --tenant fh-demo --role owner
```

Copy the single-line JSON output into the Render `OPERATOR_USERS_JSON` secret environment variable. Never commit the output: it is a password verifier and must still be treated as secret. Redeploy the current commit, then validate sign-in, activity loading, call detail, sign-out, and `/health/calls`.

Use `owner` only for the LanternBell account administrator. Funeral-home staff should normally receive `operator` or read-only `viewer` roles. Adding, changing, or disabling a user is done by updating `OPERATOR_USERS_JSON` and redeploying. Stable user IDs are derived from tenant and normalized email unless an explicit `userId` is supplied.

## Data Shown

- Recent session state, intent, escalation score, retry count, timestamps, and shortened session ID.
- Recent event type, redaction status, timestamp, and shortened correlation ID.
- Aggregate counts for sessions shown, calls still in progress, and escalated calls.
- A selected call's duration, event count, retry count, and redacted-turn count.
- Completed and failed tool names.
- Captured and missing information category names without their values.
- The complete event-type timeline, including safe tool and Twilio handoff outcomes.

The console does not request or display raw event payloads, transcripts, caller phone numbers, names, addresses, or captured structured fact values. It never calls the raw replay endpoint.

## Credential and Session Handling

- Passwords are stored only as salted `scrypt` hashes; plaintext passwords are never persisted.
- Session identifiers are 256-bit random values. Only SHA-256 digests are stored in PostgreSQL.
- The browser cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, same-origin, and unavailable to JavaScript.
- Session tokens are never placed in URLs, HTML, source control, browser storage, application logs, or audit metadata.
- Tenant and role come from the authenticated server session, not browser-supplied call requests.
- Login success/failure, expiry, logout, denied authorization, activity views, and call-detail views are appended to `operator_access_audit`.
- Existing tenant API keys remain for machine integrations and engineering diagnostics only.

## Troubleshooting

- **Sign-in details are not valid:** confirm tenant, normalized email, account status, and password; repeated failures are throttled.
- **Operator session is required/expired:** sign in again. An expired cookie is not reusable.
- **No sessions found:** complete a call against the same deployment and tenant, then refresh.
- **Service unavailable:** check `https://voice.lanternbell.com/health/calls` and the independent uptime monitor before changing call settings.
