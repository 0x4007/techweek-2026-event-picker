# Deno Universal Auth

Central passkey identity hub for Deno apps. This project is the passkey authority;
apps consume short-lived signed tokens instead of owning WebAuthn credentials.

## Current shape

- Stable WebAuthn RP ID is configured in `src/config.ts`.
- Account, credential, challenge, SSO-code, signing-key, and agent-token state lives in Deno KV.
- `GET /api/auth/jwks` exposes the public signing key for app-side JWT verification.
- SSO codes are single-use, short-lived, audience-bound, and origin-bound.
- Agent tokens are stored only as SHA-256 hashes and exchange into normal short-lived access tokens.
- No app-local passkey compatibility layer is included.

## Local run

```sh
deno task dev
```

Open an app through the deployed hub:

```text
https://deno-universal-auth.0x4007.deno.net/authorize?client_id=techweek-2026-event-picker&audience=techweek-2026-event-picker&origin=http%3A%2F%2Flocalhost%3A8788&redirect_uri=http%3A%2F%2Flocalhost%3A8788%2Fauth.html&state=dev
```

The default local RP ID is `localhost`. Before production, hard-code the real
stable auth hostname in `src/config.ts`:

- `issuer`: full auth hub origin, for example `https://auth.example.com`.
- `rpId`: hostname only, for example `auth.example.com`.
- `clients`: exact app origins, redirect URIs, and audiences.

## API

### WebAuthn

- `POST /api/auth/register/start`
- `POST /api/auth/register/finish`
- `POST /api/auth/login/start`
- `POST /api/auth/login/finish`

Registration/login return a hub-scoped bearer token with audience `auth-hub`.

### SSO

- `POST /api/auth/sso/authorize`
- `POST /api/auth/sso/exchange`
- `GET /api/auth/session/me`
- `GET /api/auth/jwks`

Authorize requires a hub bearer token. Exchange consumes a code and returns a
signed access token for the requested client audience. Clients may request a
bounded persistent app session with `ttlDays`; the hub clamps that TTL to its
configured maximum.

### Agent tokens

- `GET /api/auth/agent-tokens`
- `POST /api/auth/agent-tokens`
- `DELETE /api/auth/agent-tokens/:id`
- `POST /api/auth/agent-tokens/exchange`

Create/list/delete requires a hub bearer token. Exchange accepts the raw agent
token once per request and returns a signed access token for the token's
configured audience. Clients may request `ttlDays`, clamped by both the hub
maximum and the remaining lifetime of the agent token.

## App migration contract

1. Delete local `/api/auth/*` WebAuthn routes from the consuming app.
2. Add a callback page or popup listener that receives `code` and `state`.
3. Call `POST /api/auth/sso/exchange` with `code`, `clientId`, `audience`,
   `origin`, and the registered `redirectUri` if one was used.
4. Verify returned access tokens against `GET /api/auth/jwks`.
5. Build request context from token claims: `sub`, `handle`, `isAdmin`,
   `scopes`, `aud`, and `clientId`.
6. Remove app-local credential/session KV keys after importing users into this
   hub or after the short re-registration window.

## Smoke test checklist

- Register first account and confirm it receives `isAdmin: true`.
- Authenticate from the hub domain and exchange a code for each registered app.
- Confirm a code cannot be reused.
- Confirm wrong `clientId`, `audience`, `origin`, or `redirectUri` is rejected.
- Create an agent token, exchange it, revoke it, then confirm exchange fails.
