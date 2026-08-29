# Persistent sign-in Worker

Ends the roughly-hourly re-login on iPad/Safari. `worker.js` in this folder holds the
Google client secret, exchanges an authorization code for a **refresh token**, keeps
that token server-side, and hands the app a fresh access token whenever it asks.

The app falls back to the old browser-only sign-in whenever this Worker is unreachable
or not yet configured, so deploying it is safe to do in stages and nothing breaks if it
is never deployed at all.

## Why the app can't do this alone

Access tokens live ~1 hour. The browser-only flow (`initTokenClient`) never issues a
refresh token, so the only silent renewal available to it is a hidden iframe against
`accounts.google.com` — which Safari/iOS ITP blocks. Getting a refresh token requires
the authorization-code flow, which requires a client secret, which must never sit in a
public HTML file. Hence a Worker.

## Setup

### 1. Google Cloud Console

Open the **existing** OAuth client (the one whose id is `DRIVE_CLIENT_ID` in
`index.html`) at <https://console.cloud.google.com/apis/credentials>.

- It must be of type **Web application**.
- Copy its **Client secret** (create one if the client has none). This is what the
  Worker needs — it never goes in `index.html`.
- Under **Authorized JavaScript origins**, make sure the app's origin is listed:
  `https://jskagan.github.io`
- No redirect URI is needed: the popup code flow exchanges against the literal
  `postmessage`, not a real redirect.

If the OAuth consent screen is still in **Testing**, refresh tokens are expired by
Google after 7 days — which would reintroduce a weekly re-login. Publish the app
(**OAuth consent screen → Publish app**) to avoid that. It stays private in practice
because access is controlled by Drive file sharing, not by who can sign in.

### 2. Cloudflare

```sh
cd tools/auth-worker
npm install -g wrangler        # if you don't have it
wrangler login

# One KV namespace to hold the refresh tokens
wrangler kv namespace create AUTH_KV
# -> copy the printed id into wrangler.toml

wrangler secret put GOOGLE_CLIENT_SECRET   # paste the secret from step 1
wrangler deploy
```

Then set `AUTH_WORKER_URL` in `index.html` to the deployed URL if it differs from the
default already there.

### 3. Verify

Sign in once in the app. You should see a normal Google consent screen (it asks again
because it now needs offline access). After that, closing the tab and reopening it —
even a day later, even on iPad — should land you straight in the app with no sign-in
screen.

## Endpoints

| Endpoint | Body | Returns |
|---|---|---|
| `POST /auth/exchange` | `{code}` | `{device_id, access_token, expires_in}` |
| `POST /auth/token` | `{device_id}` | `{access_token, expires_in}` |
| `POST /auth/revoke` | `{device_id}` | `{ok:true}` |

`401` from `/auth/token` means the device credential is dead (revoked, expired,
unknown) and the app should fall back to interactive sign-in. Other errors are
transient and worth retrying.

## Security

A `device_id` is a **session credential**: whoever holds one can mint access tokens for
that Google account (Drive, plus Gmail if the account was granted that scope) until it
is revoked. It is 32 random bytes from the platform CSPRNG, stored in that browser's
`localStorage`, and never leaves the device except to this Worker.

- The Worker rejects requests whose `Origin` isn't `ALLOWED_ORIGIN`.
- Signing out in the app calls `/auth/revoke`, which revokes the grant with Google and
  deletes the stored token.
- Everything can be revoked at once at <https://myaccount.google.com/permissions>.
- Unused device credentials expire on their own after ~13 months; the clock resets on
  every successful refresh, so a device in regular use never expires.

This is the ordinary "keep me signed in" tradeoff: real persistence means a long-lived
credential exists somewhere. The alternative is the hourly re-login this replaces.
