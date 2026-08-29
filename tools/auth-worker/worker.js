/**
 * Travel Tracker — persistent sign-in Worker
 * ==========================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The app is a single static HTML file with no server, so it signs in with
 * Google's browser-only token flow (`initTokenClient`). That flow deliberately
 * never issues a REFRESH token — access tokens live ~1 hour and the only way to
 * get a new one silently is a hidden iframe against accounts.google.com
 * (`prompt: ''`). Safari/iOS ITP blocks exactly that iframe, so the owner's iPad
 * kept getting bounced to the sign-in screen roughly hourly.
 *
 * A refresh token requires the authorization-CODE flow, and exchanging a code
 * requires a client secret, which must never sit in a public HTML file. That is
 * all this Worker does: it holds the client secret, exchanges the code, keeps the
 * resulting refresh token server-side, and hands the app a fresh access token on
 * demand. No iframe, no third-party cookies, so ITP has nothing to block.
 *
 * THE DEVICE CREDENTIAL (and why it isn't the Drive-file secret)
 * -------------------------------------------------------------
 * The sibling parse-trigger Worker gates on a shared secret READ FROM DRIVE. That
 * cannot work here: reading Drive needs an access token, which is the very thing
 * this endpoint mints — a chicken-and-egg. So instead, /auth/exchange mints a
 * high-entropy random `device_id`, stores the refresh token under it, and returns
 * it to the browser to keep in localStorage. From then on the device presents
 * that id to get access tokens.
 *
 * Treat a `device_id` as equivalent to a logged-in session: anyone holding one can
 * mint access tokens for that Google account (Drive + possibly Gmail) until it is
 * revoked. It is per-device, revocable individually (/auth/revoke, or Sign out in
 * the app), and revocable wholesale at
 * https://myaccount.google.com/permissions.
 *
 * DEPLOYING
 * ---------
 * See README.md in this folder — it lists the Google Cloud Console steps, the KV
 * namespace, and the two secrets this expects.
 *
 * Bindings expected:
 *   KV namespace binding : AUTH_KV
 *   Secret               : GOOGLE_CLIENT_SECRET
 *   Var                  : GOOGLE_CLIENT_ID   (must match DRIVE_CLIENT_ID in index.html)
 *   Var                  : ALLOWED_ORIGIN     (e.g. https://jskagan.github.io)
 */

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
// How long a device credential survives with no use at all. Refreshed on every
// successful /auth/token, so an actively-used device never expires; an abandoned
// one drops out on its own rather than lingering forever.
const DEVICE_TTL_SECONDS = 400 * 24 * 60 * 60; // ~13 months

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

// A device id is the bearer credential for this account, so it must be
// unguessable: 32 random bytes, hex-encoded, from the platform CSPRNG.
function newDeviceId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Shared by both grant types. Returns the parsed Google response plus the raw
// status, so callers can tell "Google said no" (bad/revoked grant -> the device
// must sign in again) from "we couldn't reach Google" (transient -> retry later).
async function googleTokenRequest(params) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* leave {} — status still tells us enough */ }
  return { ok: res.ok, status: res.status, data };
}

// POST /auth/exchange  { code }  ->  { device_id, access_token, expires_in }
//
// `redirect_uri: 'postmessage'` is the documented value for Google Identity
// Services' POPUP code flow (initCodeClient with ux_mode:'popup'): there is no
// real redirect, the code comes back through the popup, and Google expects this
// literal string at exchange time.
async function handleExchange(request, env) {
  const { code } = await request.json();
  if (!code) return json({ error: 'missing_code' }, 400, env);

  const { ok, status, data } = await googleTokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code',
  });
  if (!ok) return json({ error: 'exchange_failed', detail: data.error || String(status) }, 502, env);

  // No refresh token means Google treated this as a re-authorization of a grant
  // the account already has. The client asks for prompt:'consent' precisely to
  // avoid that, but if it happens there is nothing durable to store, so say so
  // rather than minting a device id that can never refresh.
  if (!data.refresh_token) return json({ error: 'no_refresh_token' }, 409, env);

  const deviceId = newDeviceId();
  await env.AUTH_KV.put(
    `device:${deviceId}`,
    JSON.stringify({ refresh_token: data.refresh_token, created_at: Date.now() }),
    { expirationTtl: DEVICE_TTL_SECONDS },
  );

  return json({
    device_id: deviceId,
    access_token: data.access_token,
    expires_in: data.expires_in,
  }, 200, env);
}

// POST /auth/token  { device_id }  ->  { access_token, expires_in }
//
// 401 here is meaningful to the client: it means this device credential is dead
// (unknown, expired, or the grant was revoked at myaccount.google.com) and the
// only way forward is an interactive sign-in. Anything else is transient.
async function handleToken(request, env) {
  const { device_id: deviceId } = await request.json();
  if (!deviceId) return json({ error: 'missing_device_id' }, 400, env);

  const raw = await env.AUTH_KV.get(`device:${deviceId}`);
  if (!raw) return json({ error: 'unknown_device' }, 401, env);
  const record = JSON.parse(raw);

  const { ok, status, data } = await googleTokenRequest({
    refresh_token: record.refresh_token,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });

  if (!ok) {
    // invalid_grant specifically = the user revoked access, changed their
    // password, or the token aged out. That is permanent, so drop the record
    // instead of leaving a credential that will fail on every future startup.
    if (data.error === 'invalid_grant') {
      await env.AUTH_KV.delete(`device:${deviceId}`);
      return json({ error: 'revoked' }, 401, env);
    }
    return json({ error: 'refresh_failed', detail: data.error || String(status) }, 502, env);
  }

  // Sliding expiry: an actively-used device keeps its credential alive. Google
  // may also hand back a ROTATED refresh token, which must replace the stored
  // one or the next refresh fails.
  await env.AUTH_KV.put(
    `device:${deviceId}`,
    JSON.stringify({
      refresh_token: data.refresh_token || record.refresh_token,
      created_at: record.created_at,
      last_used_at: Date.now(),
    }),
    { expirationTtl: DEVICE_TTL_SECONDS },
  );

  return json({ access_token: data.access_token, expires_in: data.expires_in }, 200, env);
}

// POST /auth/revoke  { device_id }  ->  { ok: true }
// Always reports success: the caller's goal is "this device is signed out", and a
// record that is already gone satisfies that. Telling an unauthenticated caller
// whether a given device id existed would also be a needless oracle.
async function handleRevoke(request, env) {
  const { device_id: deviceId } = await request.json();
  if (!deviceId) return json({ error: 'missing_device_id' }, 400, env);

  const raw = await env.AUTH_KV.get(`device:${deviceId}`);
  if (raw) {
    const record = JSON.parse(raw);
    // Best-effort: tell Google too, so the grant disappears from the account's
    // permissions page rather than just from our store.
    try {
      await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: record.refresh_token }).toString(),
      });
    } catch (_) { /* the local delete below is what actually signs this device out */ }
    await env.AUTH_KV.delete(`device:${deviceId}`);
  }
  return json({ ok: true }, 200, env);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, env);

    // Only the app's own origin may call this — a device_id leaked into someone
    // else's page is otherwise enough to mint tokens from their site. Browsers
    // enforce the CORS response headers, but this check refuses the work outright.
    const origin = request.headers.get('Origin');
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'forbidden_origin' }, 403, env);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    // Health check, answered BEFORE the configuration guard below so it can report
    // being unconfigured rather than just failing with it. The app probes this once
    // at startup and only offers the code flow when it comes back configured:true --
    // otherwise a not-yet-deployed Worker would send the owner through a code popup
    // that cannot be exchanged, followed by a second popup for the fallback token
    // flow. Deliberately reveals nothing but whether the bindings are present.
    if (path === '/auth/health') {
      return json({
        ok: true,
        configured: !!(env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CLIENT_ID && env.AUTH_KV),
      }, 200, env);
    }

    if (!env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CLIENT_ID || !env.AUTH_KV) {
      return json({ error: 'worker_not_configured' }, 500, env);
    }

    try {
      if (path === '/auth/exchange') return await handleExchange(request, env);
      if (path === '/auth/token') return await handleToken(request, env);
      if (path === '/auth/revoke') return await handleRevoke(request, env);
      return json({ error: 'not_found' }, 404, env);
    } catch (e) {
      return json({ error: 'server_error', detail: String((e && e.message) || e) }, 500, env);
    }
  },
};
