# Operator Identity and Access Boundary

## Decision

The Voice controlled-pilot console uses a narrow first-party identity boundary rather than reusing tenant API keys as staff passwords. This is the first implementation of the roadmap's shared identity rules, but it is not a decision that every future LanternBell application must maintain its own login database.

The CRM and Dispatch audits will determine whether these contracts move behind a shared LanternBell identity service or an external identity provider. Voice depends only on the concepts that must remain stable: tenant, user, role, permission, session, and access audit.

## Boundaries

- Staff browser: named-user password login and opaque server session.
- Machine integrations and engineering diagnostics: tenant-scoped API key.
- Twilio callbacks: provider signature verification.
- Cross-module integrations in future phases: dedicated service authentication, never a staff cookie.

These mechanisms are intentionally separate so a leaked or revoked credential has the smallest practical authority.

## Roles and Current Permissions

| Role | `calls:read` | `access_audit:read` |
| --- | --- | --- |
| `owner` | Yes | Yes |
| `operator` | Yes | No |
| `viewer` | Yes | No |

The access-audit permission is defined for the future administrative view; the current HTTP surface exposes no audit-list endpoint.

## Security Properties

- Password verifier: salted Node `scrypt`, `N=32768`, `r=8`, `p=3`, 32-byte result.
- Login throttling: five failures per normalized tenant/email key in 15 minutes, plus the platform request limiter.
- Session secret: 32 cryptographically random bytes; only its SHA-256 digest is stored.
- Cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, no JavaScript access.
- Expiration: 30-minute idle timeout and eight-hour absolute timeout, enforced server-side.
- Authorization: role is checked server-side on every operator request; active user state and tenant are revalidated.
- CSRF boundary: state-changing browser routes enforce same-origin requests and the cookie is strict same-site.
- Audit: append-only lifecycle and call-access decisions with request correlation; no raw token, password, transcript, caller data, or captured fact values.

## Production Activation

The production migration can be deployed before account activation. The console becomes usable after `OPERATOR_USERS_JSON` contains at least one provisioned user. Password hashes are generated locally with `npm run operator:provision`; the plaintext password must never enter Render configuration, chat, source control, or documentation.
