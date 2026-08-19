# Security Notes

This document describes controls visible in the public sample. It is not a formal security audit.

## Implemented controls

### CSRF protection

The access page generates a cryptographically random CSRF token. The value is stored in an HttpOnly secure cookie and echoed into a hidden form field. The POST route requires both values and compares them with a timing-safe comparison.

The POST route also rejects `Sec-Fetch-Site: cross-site` and validates the request `Origin` when present.

### OAuth state

A separate cryptographically random OAuth `state` value is generated immediately before redirecting to Discord. It is included in the encrypted session and timing-safely compared when the OAuth callback returns.

### Session confidentiality and integrity

The short-lived session is encrypted with AES-GCM. A 256-bit AES key is derived from the configured session secret with HKDF-SHA256.

### Cookie properties

State cookies use:

```text
HttpOnly
Secure
SameSite=Lax
Path=/
short Max-Age
```

### Canonical origin enforcement

The origin is derived from the configured HTTPS Discord redirect URI. Requests that arrive on another origin are redirected or rejected depending on the route.

### Input validation

The Worker validates email and purchase-identifier shape/length, OAuth code/state size and the Discord identity returned by the upstream API.

### Outbound timeouts

Discord and webhook calls use `AbortController` timeouts so external dependencies cannot keep a request open indefinitely.

### Response headers

Responses include a restrictive Content Security Policy plus:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cache-Control: no-store, max-age=0
```

### Secret handling

The public sample contains secret names only. Real values must be configured using Cloudflare secrets and must never be committed to source control.

## Intentionally excluded

- production secrets;
- customer information;
- production domain names;
- internal webhook implementation;
- client-specific operational configuration.

## Additional production considerations

Depending on threat model and traffic volume, a production deployment may also add rate limiting, structured audit logging, monitoring/alerting and automated integration tests around the external OAuth and webhook boundaries.
