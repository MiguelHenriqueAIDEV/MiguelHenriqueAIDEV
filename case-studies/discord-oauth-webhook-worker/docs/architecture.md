# Architecture

## Purpose

The Worker coordinates three systems:

1. the browser initiating the link flow;
2. Discord OAuth2 for identity verification;
3. a downstream entitlement-validation webhook.

The Worker does not persist customer data in a database. Instead, it carries the minimum short-lived state required for the OAuth flow inside an encrypted cookie.

## Request flow

### 1. Access page

`GET /conectar-discord/`

- verifies the canonical origin;
- generates a random CSRF token;
- sets the token in a short-lived secure cookie;
- renders the form.

### 2. Link request

`POST /api/discord/link`

- rejects oversized requests;
- reads form data;
- compares CSRF token from form and cookie using a timing-safe comparison;
- checks `Origin` and `Sec-Fetch-Site`;
- validates email and purchase identifier;
- encrypts `{ email, invoice_id, created_at }` into a short-lived session cookie;
- clears the CSRF cookie;
- redirects to the OAuth start route.

### 3. OAuth start

`GET /api/discord/login`

- decrypts and validates the session;
- checks session age;
- generates a random OAuth `state` value;
- stores that state and `oauth_started_at` inside a new encrypted session cookie;
- redirects to Discord with `scope=identify`.

### 4. OAuth callback

`GET /api/discord/callback`

- validates callback origin;
- validates `code` and `state` sizes;
- decrypts the session;
- timing-safely compares returned `state` to the stored value;
- checks OAuth-session age;
- exchanges the authorization code for an access token;
- requests `/users/@me` from Discord;
- validates the returned Discord identity;
- sends the entitlement information and Discord identity to the downstream validation webhook;
- maps the webhook response to a user-facing result;
- clears the session cookie.

## Session model

The Worker uses HKDF-SHA256 to derive a 256-bit AES-GCM key from `DISCORD_LINK_SESSION_SECRET`.

The encrypted cookie contains short-lived state only:

```json
{
  "email": "user@example.com",
  "invoice_id": "example-id",
  "created_at": 0,
  "state": "oauth-state-when-present",
  "oauth_started_at": 0
}
```

No Discord access token is stored in the cookie.

## Downstream response contract

| HTTP | status | Worker result |
|---:|---|---|
| 200 | `linked` | success |
| 200 | `already_linked` | success / idempotent |
| 403 | `invalid_entitlement` | access validation failed |
| 409 | `discord_already_linked` | conflict |
| other | any / invalid JSON | temporary service error |

## Failure strategy

External calls use explicit timeouts. Errors returned to the browser are intentionally generic while the HTTP status still distinguishes validation failures, conflicts and temporary service failures.
