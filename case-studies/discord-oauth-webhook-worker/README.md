# Discord OAuth + Webhook Access Worker

> Portfolio-safe derivative of a real Cloudflare Worker integration. Brand names, production URLs, client data and secrets were removed or generalized before publication.

A Cloudflare Worker that links a purchase/entitlement record to a Discord account through OAuth2 and a downstream validation webhook.

## What it demonstrates

- Cloudflare Workers / Fetch API
- Discord OAuth2 authorization-code flow
- OAuth `state` validation
- CSRF protection
- encrypted short-lived session cookies with AES-GCM
- HKDF key derivation
- timing-safe token comparison
- origin / `Sec-Fetch-Site` checks
- strict input validation
- request timeouts with `AbortController`
- security headers and `no-store` responses
- downstream webhook integration
- explicit mapping of business-result states

## Flow

```text
User opens access page
        ↓
CSRF token issued in HttpOnly cookie
        ↓
POST purchase identifier + email
        ↓
CSRF / origin / input validation
        ↓
Encrypted short-lived session cookie
        ↓
Discord OAuth2 authorization
        ↓
Callback validates OAuth state + session age
        ↓
Discord user identity fetched
        ↓
Validation webhook receives entitlement + Discord identity
        ↓
linked / already_linked / invalid_entitlement / conflict
```

## Routes

| Route | Method | Purpose |
|---|---:|---|
| `/conectar-discord/` | GET | Renders the access-link form and creates the CSRF token |
| `/api/discord/link` | POST | Validates form input and starts the short-lived encrypted session |
| `/api/discord/login` | GET | Creates OAuth `state` and redirects to Discord |
| `/api/discord/callback` | GET | Exchanges the OAuth code, fetches the Discord identity and calls the validation webhook |

## Required secrets / configuration

The Worker reads these values from `env`:

```text
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_REDIRECT_URI
DISCORD_LINK_SESSION_SECRET
VALIDATION_WEBHOOK_URL
VALIDATION_WEBHOOK_API_KEY
```

Do not commit real values. Use Cloudflare secrets for sensitive values. The example `.dev.vars.example` contains placeholders only.

## Local development

1. Copy `.dev.vars.example` to `.dev.vars`.
2. Replace placeholders with development-only values.
3. Run:

```bash
npx wrangler dev
```

## Deployment configuration

`wrangler.jsonc` uses a current compatibility date and explicit observability settings. Production secrets should be configured separately, for example with Wrangler secret commands or the Cloudflare dashboard.

## Security design

See [`docs/security.md`](docs/security.md) for the controls implemented in the sample.

Key controls include:

- cryptographically random CSRF and OAuth-state tokens;
- short-lived cookies with `HttpOnly`, `Secure` and `SameSite=Lax`;
- session encryption with AES-GCM;
- HKDF-based key derivation from the configured session secret;
- timing-safe comparison for CSRF and OAuth state;
- canonical-origin enforcement;
- cross-site request rejection;
- payload-size limits and input validation;
- strict security headers;
- outbound request timeouts;
- generic error messages that avoid leaking internal details.

## Architecture

See [`docs/architecture.md`](docs/architecture.md).

## Portfolio context

This sample was derived from a production-oriented integration built to connect a customer's purchase entitlement to a Discord identity. The public version intentionally removes client branding, production endpoints and credentials while preserving the core technical design.

The goal is to show the engineering decisions without exposing operational or customer-sensitive information.

## What is intentionally not included

- production URLs;
- real API keys or OAuth secrets;
- customer records;
- webhook implementation from the downstream automation platform;
- internal commercial rules beyond the response contract required by this Worker.

## Source

The sanitized Worker implementation is in [`src/worker.js`](src/worker.js).
