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
 *   Var                  : OWNER_EMAIL        (watch feed: whose stored sign-in reads Drive)
 *   Secret               : FEED_TOKEN         (watch feed: the secret in its URLs; unset = feed off)
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

// ===========================================================================
// WATCH FEED (read-only): a calendar subscription + three plain-text/line
// endpoints an Apple Watch Shortcut calls ("see events for the current day,
// next day, and select a particular day from any upcoming trip," 2026-11-08).
//
// All under GET /feed/<FEED_TOKEN>/… — the token is a secret in the PATH
// because a calendar subscription cannot send headers. Anyone holding the URL
// can read the trip schedule (nothing else, and never write), so treat it like
// a private calendar link; rotate it by changing the FEED_TOKEN secret.
//
// Drive access re-uses a refresh token this Worker already holds: the most
// recently used device credential whose Google account is OWNER_EMAIL. So the
// feed works for as long as the owner stays signed in on at least one device
// through this Worker; signing out everywhere stops it (it answers 503).
//
//   GET /feed/<t>/calendar.ics        iCalendar of current + upcoming trips
//   GET /feed/<t>/day?date=YYYY-MM-DD one day's events as readable text
//                                     (date may also be a /days line, e.g.
//                                     "Thu, Nov 12 2026")
//   GET /feed/<t>/trips?from=YYYY-MM-DD  one line per current/upcoming trip
//   GET /feed/<t>/days?trip=<a /trips line>  one line per day of that trip
// ===========================================================================

const FEED_ACCESS_KEY = 'feed:access';
const FEED_DEVICE_KEY = 'feed:device';
const FEED_TRIPS_KEY = 'feed:trips';
const FEED_TRIPS_FILE_KEY = 'feed:tripsFileId';
const FEED_TRIPS_CACHE_SECONDS = 300;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function textResponse(body, status = 200, type = 'text/plain; charset=utf-8') {
  return new Response(body, { status, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

async function feedTokenMatches(given, expected) {
  if (!given || !expected) return false;
  const enc = new TextEncoder();
  const a = enc.encode(given), b = enc.encode(expected);
  if (a.length !== b.length) return false;
  if (crypto.subtle && crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// An access token for the owner's Drive, cached ~50 minutes in KV.
async function feedAccessToken(env) {
  const cached = await env.AUTH_KV.get(FEED_ACCESS_KEY);
  if (cached) return cached;
  const owner = String(env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!owner) throw Object.assign(new Error('OWNER_EMAIL not set'), { status: 503 });

  const candidates = [];
  const remembered = await env.AUTH_KV.get(FEED_DEVICE_KEY);
  if (remembered) candidates.push(remembered);
  const listed = await env.AUTH_KV.list({ prefix: 'device:' });
  const records = [];
  for (const k of listed.keys || []) {
    if (k.name === remembered) continue;
    const raw = await env.AUTH_KV.get(k.name);
    if (!raw) continue;
    try { const r = JSON.parse(raw); records.push({ key: k.name, at: r.last_used_at || r.created_at || 0 }); } catch (_) {}
  }
  records.sort((x, y) => y.at - x.at);
  for (const r of records) candidates.push(r.key);

  for (const key of candidates.slice(0, 6)) {
    const raw = await env.AUTH_KV.get(key);
    if (!raw) continue;
    const record = JSON.parse(raw);
    const { ok, data } = await googleTokenRequest({
      refresh_token: record.refresh_token,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    if (!ok) {
      if (data.error === 'invalid_grant') await env.AUTH_KV.delete(key);
      continue;
    }
    if (data.refresh_token && data.refresh_token !== record.refresh_token) {
      await env.AUTH_KV.put(key, JSON.stringify({ ...record, refresh_token: data.refresh_token }), { expirationTtl: DEVICE_TTL_SECONDS });
    }
    const who = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` } });
    const email = who.ok ? String((await who.json()).email || '').toLowerCase() : '';
    if (email !== owner) continue;
    await env.AUTH_KV.put(FEED_DEVICE_KEY, key);
    const ttl = Math.max(60, Math.min(3000, (Number(data.expires_in) || 3600) - 300));
    await env.AUTH_KV.put(FEED_ACCESS_KEY, data.access_token, { expirationTtl: ttl });
    return data.access_token;
  }
  throw Object.assign(new Error('No signed-in owner device to read Drive with. Sign in to the app once, then try again.'), { status: 503 });
}

async function driveGet(env, url) {
  let token = await feedAccessToken(env);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    await env.AUTH_KV.delete(FEED_ACCESS_KEY);
    token = await feedAccessToken(env);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  return res;
}

// trips-data.json, found the way the app finds it (oldest same-named file wins),
// cached for five minutes.
async function feedTrips(env) {
  const cached = await env.AUTH_KV.get(FEED_TRIPS_KEY);
  if (cached) return JSON.parse(cached);
  let fileId = await env.AUTH_KV.get(FEED_TRIPS_FILE_KEY);
  let res = fileId ? await driveGet(env, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`) : null;
  if (!res || !res.ok) {
    const q = encodeURIComponent("name='trips-data.json' and trashed=false");
    const list = await driveGet(env, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,createdTime)&spaces=drive`);
    if (!list.ok) throw Object.assign(new Error(`Drive search failed (${list.status})`), { status: 502 });
    const files = ((await list.json()).files || []).sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
    if (!files.length) throw Object.assign(new Error('trips-data.json not found'), { status: 502 });
    fileId = files[0].id;
    await env.AUTH_KV.put(FEED_TRIPS_FILE_KEY, fileId);
    res = await driveGet(env, `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!res.ok) throw Object.assign(new Error(`Drive download failed (${res.status})`), { status: 502 });
  }
  const doc = await res.json();
  const trips = Array.isArray(doc && doc.trips) ? doc.trips : [];
  await env.AUTH_KV.put(FEED_TRIPS_KEY, JSON.stringify(trips), { expirationTtl: FEED_TRIPS_CACHE_SECONDS });
  return trips;
}

// ---- pure helpers (tools/tests/watchfeed_test.js extracts these) ----

function feedDayKey(s) { return /^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? String(s).slice(0, 10) : ''; }
function feedHasTime(s) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(s || '')); }
function feedTimeLabel(s) {
  if (!feedHasTime(s)) return '';
  let h = Number(String(s).slice(11, 13)); const m = String(s).slice(14, 16);
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
function feedDayDate(key) { const [y, mo, d] = key.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d)); }
function feedAddDays(key, n) { const d = feedDayDate(key); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function feedDayLabel(key) {
  const d = feedDayDate(key);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
}
// Accepts "2026-11-12", or a /days line such as "Thu, Nov 12 2026".
function feedParseDate(s) {
  const t = String(s || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return '';
  const mo = MONTHS.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
  if (mo < 0) return '';
  return `${m[3]}-${String(mo + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

function feedVisibleTrips(trips) { return (trips || []).filter(t => t && !t.hidden && Array.isArray(t.events)); }
function feedVisibleEvents(trip) { return (trip.events || []).filter(e => e && !e.hidden && e.tripsyRaw); }

// The trip's real span: the days its events cover (the app's own rule), else
// its stored start/end.
function feedTripSpan(trip) {
  const keys = [];
  for (const e of feedVisibleEvents(trip)) {
    const r = e.tripsyRaw;
    for (const s of [e.start, e.end, r.departureAt, r.arrivalAt]) { const k = feedDayKey(s); if (k) keys.push(k); }
  }
  keys.sort();
  const start = keys[0] || feedDayKey(trip.start);
  const end = keys[keys.length - 1] || feedDayKey(trip.end) || start;
  return { start, end };
}

function feedTripLabel(trip) {
  const { start, end } = feedTripSpan(trip);
  const name = String(trip.name || 'Trip').trim();
  if (!start) return name;
  const a = feedDayDate(start), b = feedDayDate(end || start);
  const sm = MONTHS[a.getUTCMonth()], em = MONTHS[b.getUTCMonth()];
  const range = start === end ? `${sm} ${a.getUTCDate()}`
    : sm === em && a.getUTCFullYear() === b.getUTCFullYear() ? `${sm} ${a.getUTCDate()}–${b.getUTCDate()}`
    : `${sm} ${a.getUTCDate()} – ${em} ${b.getUTCDate()}`;
  const year = b.getUTCFullYear();
  return `${name} (${range}, ${year})`;
}

// Current and upcoming trips (not yet over on `fromKey`), in start order.
function feedTripList(trips, fromKey) {
  return feedVisibleTrips(trips)
    .map(t => ({ t, span: feedTripSpan(t) }))
    .filter(x => x.span.start && (!fromKey || x.span.end >= fromKey))
    .sort((x, y) => x.span.start.localeCompare(y.span.start))
    .map(x => x.t);
}

function feedTripDays(trip) {
  const { start, end } = feedTripSpan(trip);
  const out = [];
  if (!start) return out;
  for (let k = start, n = 0; k <= end && n < 400; k = feedAddDays(k, 1), n++) out.push(k);
  return out;
}

const FEED_TRANSPORT_GLYPH = { airplane: '✈️', car: '🚗', taxi: '🚕', train: '🚆', bus: '🚌', ferry: '⛴️', boat: '⛴️', cruise: '🚢', walk: '🚶', bike: '🚲' };
const FEED_TYPE_GLYPH = { flight: '✈️', hotel: '🏨', dining: '🍽️', concert: '🎭', tour: '🗺️', spa: '💆', reception: '🥂', cooking: '👩‍🍳' };
const FEED_CATEGORY_GLYPH = { restaurant: '🍽️', bar: '🍸', cafe: '☕', theater: '🎭', concert: '🎵', museum: '🖼️', tour: '🗺️', spa: '💆', reception: '🥂' };

function feedTransportLine(e) {
  const r = e.tripsyRaw;
  const route = e.location || [r.departureDescription, r.arrivalDescription].filter(Boolean).join(' → ');
  const carrier = [r.company, r.transportNumber].filter(Boolean).join(' ');
  return [route, carrier].filter(Boolean).join(' • ') || e.summary || 'Transportation';
}

// Every row a day shows: {sort, time, glyph, text, sub}.
function feedRowsForDay(trips, dayKey) {
  const rows = [];
  for (const trip of feedVisibleTrips(trips)) {
    for (const e of feedVisibleEvents(trip)) {
      const r = e.tripsyRaw;
      if (r.resource === 'transportation') {
        const glyph = FEED_TRANSPORT_GLYPH[r.category] || (e.type === 'flight' ? '✈️' : '🚗');
        const dep = r.departureAt || e.start, arr = r.arrivalAt || e.end;
        const line = feedTransportLine(e);
        if (feedDayKey(dep) === dayKey) {
          const sameDayArr = feedDayKey(arr) === dayKey && feedHasTime(arr);
          rows.push({ sort: dep, time: feedTimeLabel(dep), glyph, text: line, sub: sameDayArr ? `Arrives ${feedTimeLabel(arr)}` : (arr ? `Arrives ${feedDayLabel(feedDayKey(arr)).replace(/ \d{4}$/, '')} ${feedTimeLabel(arr)}`.trim() : '') , trip: trip.name, extra: e.tripsyExtra || '' });
        } else if (feedDayKey(arr) === dayKey) {
          rows.push({ sort: arr, time: feedTimeLabel(arr), glyph, text: `Arrive: ${r.arrivalDescription || line}`, sub: [r.company, r.transportNumber].filter(Boolean).join(' '), trip: trip.name, extra: '' });
        }
        continue;
      }
      const glyph = FEED_CATEGORY_GLYPH[r.category] || FEED_TYPE_GLYPH[e.type] || '📍';
      const title = e.summary || r.name || 'Event';
      if (r.resource === 'hosting') {
        const inK = feedDayKey(e.start), outK = feedDayKey(e.end);
        if (inK === dayKey) rows.push({ sort: e.start, time: feedTimeLabel(e.start), glyph, text: `Check in: ${title}`, sub: e.location || '', trip: trip.name, extra: e.tripsyExtra || '' });
        else if (outK === dayKey) rows.push({ sort: e.end, time: feedTimeLabel(e.end), glyph, text: `Check out: ${title}`, sub: '', trip: trip.name, extra: '' });
        else if (inK && outK && inK < dayKey && dayKey < outK) rows.push({ sort: `${dayKey}T00:00`, time: '', glyph: '🛏️', text: `Staying at ${title}`, sub: '', trip: trip.name, extra: '' });
        continue;
      }
      if (feedDayKey(e.start) !== dayKey) continue;
      const end = feedDayKey(e.end) === dayKey && feedHasTime(e.end) ? `–${feedTimeLabel(e.end)}` : '';
      rows.push({ sort: e.start, time: feedTimeLabel(e.start) + end, glyph, text: title, sub: e.location || '', trip: trip.name, extra: '' });
    }
  }
  return rows.sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
}

function feedDayText(trips, dayKey) {
  const rows = feedRowsForDay(trips, dayKey);
  const head = feedDayLabel(dayKey);
  const tripNames = [...new Set(rows.map(r => r.trip).filter(Boolean))];
  if (!rows.length) {
    const on = feedVisibleTrips(trips).filter(t => { const s = feedTripSpan(t); return s.start && s.start <= dayKey && dayKey <= s.end; });
    return `${head}\n${on.length ? on.map(t => t.name).join(' / ') + '\n' : ''}\nNothing scheduled.`;
  }
  const lines = [head];
  if (tripNames.length) lines.push(tripNames.join(' / '));
  for (const r of rows) {
    lines.push('');
    lines.push(`${r.glyph} ${r.time ? r.time + '  ' : ''}${r.text}`);
    if (r.sub) lines.push(`   ${r.sub}`);
    if (r.extra) lines.push(`   ${r.extra}`);
  }
  return lines.join('\n');
}

// ---- iCalendar ----

// Wall-clock digits in an IANA zone -> a UTC instant (two passes cover DST).
function feedWallToUtc(wall, tz) {
  const m = String(wall).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m || !tz) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return null; }
  const asWall = ms => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  };
  let guess = target;
  for (let i = 0; i < 2; i++) guess += target - asWall(guess);
  return new Date(guess);
}
function feedIcsUtc(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function feedIcsFloating(wall) { return String(wall).slice(0, 16).replace(/[-:]/g, '') + '00'; }
function feedIcsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function feedIcsFold(line) {
  const enc = new TextEncoder();
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// Zone for a moment of an event: its own, else the trip's nearest known zone
// at or before that time, else the nearest after; '' = floating time.
function feedZoneFinder(trip) {
  const known = [];
  for (const e of feedVisibleEvents(trip)) {
    const r = e.tripsyRaw;
    if (r.resource === 'transportation') {
      if (r.departureTimezone && r.departureAt) known.push([String(r.departureAt), r.departureTimezone]);
      if (r.arrivalTimezone && r.arrivalAt) known.push([String(r.arrivalAt), r.arrivalTimezone]);
    } else if (r.timezone && e.start) {
      known.push([String(e.start), r.timezone]);
      if (e.end) known.push([String(e.end), r.timezone]);
    }
  }
  known.sort((a, b) => a[0].localeCompare(b[0]));
  return (wall, own) => {
    if (own) return own;
    let before = '', after = '';
    for (const [w, z] of known) { if (w <= wall) before = z; else { after = z; break; } }
    return before || after || '';
  };
}

function feedIcsTime(prop, wall, tz) {
  if (!feedHasTime(wall)) return `${prop};VALUE=DATE:${feedDayKey(wall).replace(/-/g, '')}`;
  const utc = feedWallToUtc(wall, tz);
  return utc ? `${prop}:${feedIcsUtc(utc)}` : `${prop}:${feedIcsFloating(wall)}`;
}
function feedPlusMinutes(wall, min) {
  if (!feedHasTime(wall)) return feedAddDays(feedDayKey(wall), 1);
  const d = new Date(String(wall).slice(0, 16) + ':00Z'); d.setUTCMinutes(d.getUTCMinutes() + min);
  return d.toISOString().slice(0, 16);
}

function feedIcs(trips, fromKey, nowMs) {
  const stamp = feedIcsUtc(new Date(nowMs));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Travel Tracker//Watch Feed//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Travel Tracker', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  const add = (uid, summary, startWall, startTz, endWall, endTz, location, description) => {
    if (!feedDayKey(startWall)) return;
    lines.push('BEGIN:VEVENT', `UID:${uid}@travel-tracker`, `DTSTAMP:${stamp}`,
      feedIcsTime('DTSTART', startWall, startTz), feedIcsTime('DTEND', endWall, endTz),
      `SUMMARY:${feedIcsEscape(summary)}`);
    if (location) lines.push(`LOCATION:${feedIcsEscape(location)}`);
    if (description) lines.push(`DESCRIPTION:${feedIcsEscape(description)}`);
    lines.push('END:VEVENT');
  };
  for (const trip of feedTripList(trips, fromKey)) {
    const zone = feedZoneFinder(trip);
    for (const e of feedVisibleEvents(trip)) {
      const r = e.tripsyRaw;
      const desc = [e.tripsyExtra, e.notes || r.notes, trip.name].filter(Boolean).join('\n');
      if (r.resource === 'transportation') {
        const dep = r.departureAt || e.start, arr = r.arrivalAt || e.end || feedPlusMinutes(dep, 60);
        if (!dep) continue;
        add(e.id, e.summary || feedTransportLine(e), dep, zone(dep, r.departureTimezone), arr, zone(arr, r.arrivalTimezone), e.location || '', desc);
      } else if (r.resource === 'hosting') {
        const title = e.summary || r.name || 'Hotel';
        if (e.start) add(`${e.id}-in`, `Check in: ${title}`, e.start, zone(e.start, r.timezone), feedPlusMinutes(e.start, 30), zone(e.start, r.timezone), e.location || '', desc);
        if (e.end) add(`${e.id}-out`, `Check out: ${title}`, e.end, zone(e.end, r.timezone), feedPlusMinutes(e.end, 30), zone(e.end, r.timezone), e.location || '', desc);
      } else if (e.start) {
        const end = e.end && feedHasTime(e.end) === feedHasTime(e.start) && e.end > e.start ? e.end : feedPlusMinutes(e.start, 60);
        add(e.id, e.summary || r.name || 'Event', e.start, zone(e.start, r.timezone), end, zone(end, r.timezone), e.location || '', desc);
      }
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(feedIcsFold).join('\r\n') + '\r\n';
}

async function handleFeed(request, env, parts, url) {
  if (!env.FEED_TOKEN || !(await feedTokenMatches(parts[1] || '', env.FEED_TOKEN))) return textResponse('Not found', 404);
  const what = parts[2] || '';
  // Runs the trip-edits drain now instead of waiting for the next minute's tick,
  // and whether or not a trip is in progress.
  // It can only apply a relay already sitting in the owner's Drive folder.
  if (what === 'apply-edits') return textResponse(editsRunText(await editsDrain(env)));
  const trips = await feedTrips(env);
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (what === 'calendar.ics') {
    return textResponse(feedIcs(trips, feedAddDays(todayUtc, -7), Date.now()), 200, 'text/calendar; charset=utf-8');
  }
  if (what === 'day') {
    const key = feedParseDate(url.searchParams.get('date')) || todayUtc;
    return textResponse(feedDayText(trips, key));
  }
  if (what === 'trips') {
    const from = feedParseDate(url.searchParams.get('from')) || todayUtc;
    const list = feedTripList(trips, from).map(feedTripLabel);
    return textResponse(list.length ? list.join('\n') : 'No upcoming trips');
  }
  if (what === 'days') {
    const want = String(url.searchParams.get('trip') || '').trim();
    const trip = feedVisibleTrips(trips).find(t => feedTripLabel(t) === want || t.key === want);
    if (!trip) return textResponse('Trip not found', 404);
    return textResponse(feedTripDays(trip).map(feedDayLabel).join('\n'));
  }
  return textResponse('Not found', 404);
}

// ===========================================================================
// TRIP EDITS DRAIN (scheduled): applies tripsy-trip-edits.json without the app
// being opened ("I want to ... give voice commands in a chat session and those
// will get automatically integrated into travel tracker," 2026-11-23).
//
// A Claude chat can only CREATE files in Drive, so it leaves its changes as a
// small tripsy-trip-edits.json relay; until now nothing applied one until the
// owner next opened the app (drainTripsyTripEdits in index.html). A Cron
// Trigger on this Worker now does the same job every minute: find the relay,
// apply each entry to trips-data.json with the app's OWN logic, save, delete
// the relay.
//
// PARITY IS BY CONSTRUCTION. Everything between the MIRROR markers below is
// copied byte-for-byte from index.html by tools/auth-worker/mirror.js (this
// file deploys as one pasted file, so it cannot import). Never edit that block
// by hand; tools/tests/workertripedits_test.js fails when it drifts.
//
// The Worker is a SECOND WRITER of trips-data.json, so it follows the app's
// own optimistic-concurrency rule (persistTripsData): re-read the head
// revision just before saving, and if it moved, reload and re-apply. Every
// re-apply runs the replay checks again, so nothing is created twice.
//
// Three files it writes beside trips-data.json:
//   tripsy-trip-edits-log.json  what each run did, newest first (a chat reads
//                               this to confirm, and to learn a new event's key)
//   tripsy-applied-edits.json   written after every save: the deletes/moves/
//                               edits it applied, so the app can take the newer
//                               trips and clean its derived caches (the Worker
//                               never touches flight-log-data.json) -- see
//                               drainTripsyAppliedEdits in index.html
//   tripsy-trip-edits.invalid-<time>.json  a relay it could not read, renamed
//                               so it is neither retried forever nor lost
//
// Unlike the app's drain, an entry that fails to APPLY (unknown resource, a
// trip that is gone) is recorded and dropped rather than kept for retry: the
// same input fails the same way every minute. A Drive failure aborts the whole
// run before anything is deleted, so that IS retried.
//
// ONLY WHILE A TRIP IS IN PROGRESS ("Let's only have the worker check when I
// am on a trip. When there is no trip in progress, it is fine to only update
// when the app is opened," 2026-11-23). The timer reads a small list of trip
// date windows from KV (edits:tripWindows, rebuilt from trips-data.json every
// six hours and after each save); off a trip a tick is that one KV read and no
// Drive call at all, and the app's own drain applies the relay on next open.
// A window runs from the day before a trip's first event to the day after its
// last, because the Worker's clock is UTC and event days are local.
//
// No KV writes on an idle tick (the free plan allows 1,000 a day and sign-in
// needs them): on a trip, one KV read and one Drive list call, nothing else.
// ===========================================================================

// >>> MIRROR BEGIN (generated by tools/auth-worker/mirror.js -- do not edit by hand)
let tripsyDecryptedTrips = null;
const TRIPSY_EDIT_FIELDS = {
  activity: [{ key: 'name' }, { key: 'category' }, { key: 'startsAt' }, { key: 'endsAt' }, { key: 'address' }, { key: 'confirmation' }, { key: 'phone' }, { key: 'website' }, { key: 'agentName' }, { key: 'agency' }, { key: 'agentPhone' }, { key: 'agencyReservationNumber' }, { key: 'agentWebsite' }, { key: 'notes' }],
  hosting: [{ key: 'name' }, { key: 'confirmation' }, { key: 'startsAt' }, { key: 'endsAt' }, { key: 'address' }, { key: 'phone' }, { key: 'website' }, { key: 'agentName' }, { key: 'agency' }, { key: 'agentPhone' }, { key: 'agencyReservationNumber' }, { key: 'agentWebsite' }, { key: 'notes' }],
  transportation: [{ key: 'category' }, { key: 'confirmation' }, { key: 'company' }, { key: 'transportNumber' }, { key: 'vehicleDescription' }, { key: 'departureDescription' }, { key: 'departureTerminal' }, { key: 'departureAt' }, { key: 'arrivalDescription' }, { key: 'arrivalTerminal' }, { key: 'arrivalAt' }, { key: 'seatClass' }, { key: 'seatNumber' }, { key: 'agentName' }, { key: 'agency' }, { key: 'agentPhone' }, { key: 'agencyReservationNumber' }, { key: 'agentWebsite' }, { key: 'notes' }],
};
const TRIPSY_CUSTOM_CATEGORY_SPA_SLUG = '7XGVGtMARwoON7rl52N1P4j36dI9gf4NDgw';
const TRIPSY_CUSTOM_CATEGORY_RECEPTION_SLUG = 'Y16QHWPgO5Z7T7jTBdfgdEK0ZvGDecv8jW0';
const TRIPSY_CUSTOM_CATEGORY_COOKING_SLUG = 'VuucvcPkCXTTzz6FHsSY5AMjvcmtx42pO5s';
const TRIPSY_CUSTOM_CATEGORY_LABELS = {
  [TRIPSY_CUSTOM_CATEGORY_SPA_SLUG]: 'Spa',
  [TRIPSY_CUSTOM_CATEGORY_RECEPTION_SLUG]: 'Reception',
  [TRIPSY_CUSTOM_CATEGORY_COOKING_SLUG]: 'Cooking',
};
const TRIPSY_ACTIVITY_TYPES = [
  'general', 'note', 'event', 'meeting', 'relax', 'fit', 'kids', 'shopping', 'parking', 'atm', 'bank',
  'restaurant', 'bar', 'cafe', 'bakery', 'brewery', 'winery', 'foodMarket',
  'concert', 'theater', 'movieTheater', 'nightlife',
  'tour', 'museum', 'nationalPark', 'zoo', 'aquarium', 'amusementPark', 'park', 'beach', 'marina', 'stadium', 'campground',
  'evCharger', 'fireStation', 'fitnessCenter', 'gasStation', 'hospital', 'laundry', 'library', 'pharmacy',
  'police', 'postOffice', 'publicTransport', 'restroom', 'school', 'university',
];
const TRIPSY_TRANSPORTATION_TYPES = ['airplane', 'bike', 'bus', 'car', 'taxi', 'roadtrip', 'cruise', 'ferry', 'motorcycle', 'train', 'walk'];
const TRIPSY_ACTIVITY_CATEGORY_TO_TYPE = {
  restaurant: 'dining', bar: 'dining', cafe: 'dining', bakery: 'dining', brewery: 'dining', winery: 'dining', foodMarket: 'dining',
  concert: 'concert', theater: 'concert',
  tour: 'tour', museum: 'tour', nationalPark: 'tour', zoo: 'tour', aquarium: 'tour', amusementPark: 'tour',
  // The owner's custom "Spa"/"Reception" categories (Tripsy has no built-in
  // type for either) get their own dot rather than falling through to the
  // generic 'other' pin. Kept in lockstep with build_tripsy_snapshot.py's
  // ACTIVITY_CATEGORY_TO_TYPE, which stamps the same type into the snapshot
  // for already-synced events (this map only re-derives pending/edited ones).
  [TRIPSY_CUSTOM_CATEGORY_SPA_SLUG]: 'spa',
  [TRIPSY_CUSTOM_CATEGORY_RECEPTION_SLUG]: 'reception',
  [TRIPSY_CUSTOM_CATEGORY_COOKING_SLUG]: 'cooking',
};
const TRIPSY_AIRPORT_ZONE_GROUPS = {
  'America/Los_Angeles': 'LAX BUR LGB SNA ONT PSP SAN SBA SMO VNY SFO OAK SJC SMF MRY STS APC FAT SEA PDX GEG LAS RNO',
  'America/Boise': 'BOI SUN', 'America/Phoenix': 'PHX SCF TUS',
  'America/Denver': 'SLC ABQ SAF DEN ASE EGE HDN MTJ TEX GUC JAC BZN',
  'America/Chicago': 'DFW DAL IAH HOU AUS SAT MSY OKC MCI STL ORD MDW MSP MKE BNA MEM',
  'America/Detroit': 'DTW', 'America/Indiana/Indianapolis': 'IND',
  'America/New_York': 'CLE CMH CVG PIT ATL CLT RDU MIA FLL PBI MCO TPA RSW JAX SRQ EYW JFK LGA EWR HPN TEB ISP BOS PVD BDL ACK MVY PWM BTV PHL BWI DCA IAD',
  'Pacific/Honolulu': 'HNL OGG KOA LIH ITO', 'America/Anchorage': 'ANC',
  'America/Vancouver': 'YVR YYJ', 'America/Toronto': 'YYZ YUL YOW YQB', 'America/Edmonton': 'YYC YEG', 'America/Halifax': 'YHZ',
  'America/Mexico_City': 'MEX GDL MTY', 'America/Cancun': 'CUN', 'America/Mazatlan': 'SJD', 'America/Bahia_Banderas': 'PVR',
  'America/Nassau': 'NAS', 'America/Jamaica': 'MBJ', 'America/Puerto_Rico': 'SJU', 'America/Santo_Domingo': 'PUJ', 'America/St_Thomas': 'STT',
  'America/Lower_Princes': 'SXM', 'America/Aruba': 'AUA', 'America/Barbados': 'BGI', 'America/Cayman': 'GCM',
  'America/Bogota': 'BOG', 'America/Lima': 'LIM CUZ', 'America/Santiago': 'SCL', 'America/Argentina/Buenos_Aires': 'EZE AEP',
  'America/Sao_Paulo': 'GRU GIG', 'America/Guayaquil': 'UIO', 'America/Costa_Rica': 'SJO', 'America/Panama': 'PTY',
  'Europe/London': 'LHR LGW LCY STN LTN MAN EDI GLA', 'Europe/Dublin': 'DUB', 'Europe/Lisbon': 'LIS OPO FAO',
  'Europe/Paris': 'CDG ORY NCE LYS MRS BOD', 'Europe/Amsterdam': 'AMS', 'Europe/Brussels': 'BRU', 'Europe/Luxembourg': 'LUX',
  'Europe/Berlin': 'FRA MUC BER TXL HAM DUS CGN STR NUE HAJ LEJ', 'Europe/Zurich': 'ZRH GVA BSL', 'Europe/Vienna': 'VIE SZG INN',
  'Europe/Prague': 'PRG', 'Europe/Budapest': 'BUD', 'Europe/Warsaw': 'WAW KRK',
  'Europe/Rome': 'FCO CIA MXP LIN VCE FLR NAP PSA BLQ CTA PMO OLB', 'Europe/Madrid': 'MAD BCN AGP SVQ PMI IBZ VLC BIO',
  'Europe/Athens': 'ATH JTR JMK HER', 'Europe/Copenhagen': 'CPH', 'Europe/Stockholm': 'ARN', 'Europe/Oslo': 'OSL',
  'Europe/Helsinki': 'HEL', 'Atlantic/Reykjavik': 'KEF', 'Europe/Istanbul': 'IST SAW', 'Europe/Zagreb': 'DBV SPU ZAG',
  'Asia/Jerusalem': 'TLV', 'Asia/Dubai': 'DXB DWC AUH', 'Asia/Qatar': 'DOH', 'Asia/Riyadh': 'RUH JED', 'Asia/Amman': 'AMM',
  'Asia/Bahrain': 'BAH', 'Asia/Muscat': 'MCT', 'Africa/Cairo': 'CAI', 'Africa/Casablanca': 'RAK CMN',
  'Africa/Johannesburg': 'JNB CPT', 'Africa/Nairobi': 'NBO', 'Africa/Kigali': 'KGL', 'Africa/Dar_es_Salaam': 'DAR JRO ZNZ',
  'Indian/Mauritius': 'MRU', 'Indian/Mahe': 'SEZ', 'Asia/Kolkata': 'DEL BOM BLR MAA CCU GOI JAI', 'Asia/Colombo': 'CMB',
  'Indian/Maldives': 'MLE', 'Asia/Kathmandu': 'KTM', 'Asia/Singapore': 'SIN', 'Asia/Kuala_Lumpur': 'KUL',
  'Asia/Bangkok': 'BKK DMK HKT CNX CEI USM', 'Asia/Ho_Chi_Minh': 'HAN SGN DAD', 'Asia/Phnom_Penh': 'REP PNH', 'Asia/Yangon': 'RGN',
  'Asia/Jakarta': 'CGK', 'Asia/Makassar': 'DPS', 'Asia/Manila': 'MNL CEB', 'Asia/Hong_Kong': 'HKG', 'Asia/Macau': 'MFM',
  'Asia/Taipei': 'TPE', 'Asia/Shanghai': 'PEK PKX PVG SHA CAN SZX CTU',
  'Asia/Tokyo': 'NRT HND KIX ITM NGO FUK CTS OKA KOJ OIT', 'Asia/Seoul': 'ICN GMP PUS CJU',
  'Australia/Sydney': 'SYD', 'Australia/Melbourne': 'MEL', 'Australia/Brisbane': 'BNE CNS OOL', 'Australia/Perth': 'PER',
  'Australia/Adelaide': 'ADL', 'Pacific/Auckland': 'AKL ZQN CHC WLG', 'Pacific/Fiji': 'NAN', 'Pacific/Tahiti': 'PPT BOB',
};
const TRIPSY_AIRPORT_ZONES = {};
for (const [zone, codes] of Object.entries(TRIPSY_AIRPORT_ZONE_GROUPS)) for (const c of codes.split(' ')) TRIPSY_AIRPORT_ZONES[c] = zone;
function parseTripLocalParts(iso) {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { year: Number(y), month: Number(mo), day: Number(d), hour: h != null ? Number(h) : null, minute: mi != null ? Number(mi) : null };
}
function tripsyZonedWallClockToUtcMs(iso, timeZone) {
  const parts = parseTripLocalParts(iso);
  if (!parts || parts.hour == null || !timeZone) return null;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute || 0);
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const get = type => Number(dtf.formatToParts(new Date(asUtc)).find(p => p.type === type).value);
    const hour = get('hour') % 24; // Intl can report hour "24" for midnight
    const asZoned = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));
    return asUtc - (asZoned - asUtc);
  } catch (e) {
    return null;
  }
}
function tripsyAirportCodeOf(desc) {
  const d = String(desc || '').trim();
  if (/^[A-Z]{3}$/.test(d)) return d;
  const paren = d.match(/\(([A-Z]{3})\)\s*$/);
  if (paren) return paren[1];
  const lead = d.match(/^([A-Z]{3})\s+(?=\S)/);
  return lead ? lead[1] : '';
}
function tripsySlugToLabel(slug) {
  if (!slug) return '';
  if (TRIPSY_CUSTOM_CATEGORY_LABELS[slug]) return TRIPSY_CUSTOM_CATEGORY_LABELS[slug];
  if (!TRIPSY_ACTIVITY_TYPES.includes(slug) && !TRIPSY_TRANSPORTATION_TYPES.includes(slug)) return slug;
  return slug.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}
function tripsyActivityCategoryToType(category) {
  return TRIPSY_ACTIVITY_CATEGORY_TO_TYPE[category] || 'other';
}
function tripsyShortenPlaceDescription(desc) {
  return desc ? desc.split(',')[0].trim() : desc;
}
function tripsyTransportationFallbackSummary(raw, dep, arr) {
  const type = raw.category === 'airplane' ? 'Flight' : (tripsySlugToLabel(raw.category) || 'Transportation');
  const shortDep = tripsyShortenPlaceDescription(dep);
  const shortArr = tripsyShortenPlaceDescription(arr);
  // Ordinary point-to-point transport (not flights/roadtrips/cruises) joins its two
  // endpoints with an arrow rather than the word "to": "Car from A → B".
  const routeSep = ['airplane', 'roadtrip', 'cruise'].includes(raw.category) ? ' to ' : ' → ';
  if (shortDep && shortArr) return `${type} from ${shortDep}${routeSep}${shortArr}`;
  if (shortDep) return `${type} from ${shortDep}`;
  if (shortArr) return `${type} to ${shortArr}`;
  return type;
}
function tripsySeatLabel(raw) {
  if (!raw.seatClass && !raw.seatNumber) return null;
  if (raw.seatClass && raw.seatNumber) return `Seat: ${raw.seatClass} (${raw.seatNumber})`;
  return `Seat: ${raw.seatClass || raw.seatNumber}`;
}
function tripsyFlightDurationLabel(raw) {
  const zoneOf = (tz, desc) => tz || TRIPSY_AIRPORT_ZONES[tripsyAirportCodeOf(desc)] || null;
  const depMs = tripsyZonedWallClockToUtcMs(raw.departureAt, zoneOf(raw.departureTimezone, raw.departureDescription));
  const arrMs = tripsyZonedWallClockToUtcMs(raw.arrivalAt, zoneOf(raw.arrivalTimezone, raw.arrivalDescription));
  if (depMs == null || arrMs == null) return null;
  const minutes = Math.round((arrMs - depMs) / 60000);
  if (!(minutes > 0)) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function tripsySeatAndFlightTimeLabel(raw) {
  const seat = tripsySeatLabel(raw);
  const ft = raw && raw.category === 'airplane' ? tripsyFlightDurationLabel(raw) : null;
  return [seat, ft ? `Flight time: ${ft}` : null].filter(Boolean).join(' • ') || null;
}
function tripsyRawToDisplay(resource, raw) {
  const extra = parts => parts.filter(Boolean).join(' • ') || null;
  if (resource === 'hosting') {
    return {
      type: 'hotel',
      summary: raw.name,
      location: raw.address || null,
      notes: raw.notes || null,
      start: raw.startsAt,
      end: raw.endsAt,
      tripsyExtra: extra([raw.confirmation ? `Confirmation: ${raw.confirmation}` : '', raw.phone || '', raw.website || '']),
    };
  }
  if (resource === 'activity') {
    return {
      type: tripsyActivityCategoryToType(raw.category),
      summary: raw.name,
      location: raw.address || null,
      notes: raw.notes || null,
      start: raw.startsAt,
      end: raw.endsAt,
      tripsyExtra: extra([raw.confirmation ? `Confirmation: ${raw.confirmation}` : '', raw.phone || '', raw.website || '']),
    };
  }
  // transportation
  const dep = raw.departureDescription || '';
  const arr = raw.arrivalDescription || '';
  // A name that's just the literal word "transportation" is a doc/email
  // parser's generic placeholder, not a real name someone would recognize
  // (unlike, say, "Hotel Shuttle") -- treat it the same as no name at all
  // so the from/to fallback below still kicks in instead of surfacing it
  // verbatim.
  const usableName = raw.name && raw.name.trim().toLowerCase() !== 'transportation' ? raw.name : null;
  // A real point-to-point route (from at least one of dep/arr) is more
  // useful as the title than the operating company's name -- "Car from
  // Soho Farmhouse to Brown's Hotel" says what the leg actually IS, where
  // "Bluetick Chauffeur Services" doesn't. Only fall back to company+
  // number (then name, then a bare type) when there's no route to
  // describe at all. The company name isn't lost when it loses the title
  // -- every caller still has it via tripsyRaw.company for its own
  // "Company Number" detail line (see tripsyTimelineDetailLines, and the
  // itinerary cards' own meta line for this same reason).
  const companyNumber = `${raw.company || ''} ${raw.transportNumber || ''}`.trim();
  const isFlight = raw.category === 'airplane';
  // When there's no departure/arrival route and the title falls back to the event's
  // NAME, and that name is itself a route (e.g. "Paddington → Heathrow"), prefix the
  // type + from/to so the timeline reads "Train from Paddington → Heathrow" (an arrow
  // in the name = origin+destination -> "from") or "Car to Heathrow" (a lone place ->
  // "to"). Flights/roadtrips/cruises keep their name as-is.
  const nameTitle = (usableName && !['airplane', 'roadtrip', 'cruise'].includes(raw.category))
    ? `${tripsySlugToLabel(raw.category) || 'Transportation'} ${usableName.includes('→') ? 'from' : 'to'} ${usableName}`
    : usableName;
  const baseSummary = (dep || arr) ? tripsyTransportationFallbackSummary(raw, dep, arr) : (companyNumber || nameTitle || tripsyTransportationFallbackSummary(raw, dep, arr));
  // Flights only: company + flight number moves INTO the header/title,
  // after the origin/destination, rather than living only in its own
  // detail line (tripsyTimelineDetailLines drops that line for flights
  // now that it's here instead -- see that function's own comment).
  // Guarded against duplicating companyNumber when baseSummary already
  // IS companyNumber (the no-route fallback case above).
  const summary = (isFlight && companyNumber && baseSummary !== companyNumber) ? `${baseSummary} • ${companyNumber}` : baseSummary;
  return {
    type: isFlight ? 'flight' : 'transportation',
    summary,
    // Full description, deliberately unshortened -- every caller besides
    // the My Trips timeline's own title (tripsyShortenRouteLocation, used
    // at that one call site instead of a field added here) uses this as a
    // detail/meta line, where the full address is exactly what's wanted.
    // NOT computing a shortened variant here: for an event with no pending
    // edit, `location` comes straight from trips-data.json (built at migration
    // time by tools/build_tripsy_snapshot.py) rather than a fresh call to this
    // function -- a field only this JS function knew how to compute would
    // silently be missing on every un-edited event, the vast majority of
    // them. Deriving the short form from `location` itself at the one
    // point of use works uniformly for both cases instead.
    location: dep && arr ? `${dep} → ${arr}` : (dep || arr || null),
    notes: raw.notes || null,
    start: raw.departureAt,
    end: raw.arrivalAt,
    tripsyExtra: extra([
      raw.confirmation ? `Confirmation: ${raw.confirmation}` : '',
      tripsySeatAndFlightTimeLabel(raw) || '',
      raw.vehicleDescription || '',
      raw.departureTerminal ? `Terminal ${raw.departureTerminal}` : '',
    ]),
  };
}
function tripsyEventKey(tripsyRaw) {
  return tripsyRaw ? `${tripsyRaw.resource}:${tripsyRaw.id}` : null;
}
function tripsyMintLocalId() {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}
function tripsyBlankRaw(resource, presetCategory) {
  const blank = { resource, id: null };
  for (const f of TRIPSY_EDIT_FIELDS[resource]) blank[f.key] = null;
  if (presetCategory) blank.category = presetCategory;
  return blank;
}
function applyTripsyChangeToTrips(change) {
  const trips = tripsyDecryptedTrips || [];
  const sortEvents = evs => [...evs].sort((a, b) => ((a.start || '') < (b.start || '') ? -1 : ((a.start || '') > (b.start || '') ? 1 : 0)));
  const sortTrips = ts => [...ts].sort((a, b) => ((a.start || '') < (b.start || '') ? -1 : ((a.start || '') > (b.start || '') ? 1 : 0)));
  const replaceTrip = (key, fn) => {
    const i = trips.findIndex(t => t.key === key);
    if (i < 0) throw new Error(`trip not found: ${key}`);
    const out = [...trips];
    out[i] = fn(trips[i]);
    return out;
  };
  let next;
  if (change.type === 'edit_event' || change.type === 'delete_event') {
    const ti = trips.findIndex(t => (t.events || []).some(ev => tripsyEventKey(ev.tripsyRaw) === change.eventKey));
    if (ti < 0) throw new Error(`event not found: ${change.eventKey}`);
    const trip = trips[ti];
    let events;
    if (change.type === 'delete_event') {
      events = trip.events.filter(ev => tripsyEventKey(ev.tripsyRaw) !== change.eventKey);
    } else {
      events = sortEvents(trip.events.map(ev => {
        if (tripsyEventKey(ev.tripsyRaw) !== change.eventKey) return ev;
        const mergedRaw = { ...ev.tripsyRaw, ...(change.changes || {}) };
        return { ...ev, ...tripsyRawToDisplay(mergedRaw.resource, mergedRaw), tripsyRaw: mergedRaw };
      }));
    }
    next = [...trips];
    next[ti] = { ...trip, events };
  } else if (change.type === 'create_event') {
    const id = tripsyMintLocalId();
    const raw = { ...tripsyBlankRaw(change.tripsyResource, null), ...(change.fields || {}), resource: change.tripsyResource, id };
    const ev = { id: `${change.tripsyResource}-${id}`, hidden: false, ...tripsyRawToDisplay(change.tripsyResource, raw), tripsyRaw: raw };
    next = replaceTrip(change.tripKey, t => ({ ...t, events: sortEvents([...(t.events || []), ev]) }));
  } else if (change.type === 'edit_trip') {
    next = sortTrips(replaceTrip(change.tripKey, t => ({ ...t, ...(change.changes || {}) })));
  } else if (change.type === 'delete_trip') {
    next = trips.filter(t => t.key !== change.tripKey);
  } else if (change.type === 'create_trip') {
    next = sortTrips([...trips, { key: change.tripKey, name: change.name || null, start: change.start || null, end: change.end || null, location: null, events: [] }]);
  } else if (change.type === 'move_event') {
    // Re-homes an event under another EXISTING trip. The very same event object
    // (same id, same tripsyRaw) is carried across -- NOT deleted and re-created --
    // so every id-keyed reference to it (attachments, outfit blocks, itinerary
    // baselines) still resolves after the move; only which trip's events[] holds
    // it changes. The source is located by eventKey exactly like edit/delete
    // (never trusting a caller-supplied tripKey that may have gone stale), and
    // moving an event onto the trip it's already in is refused as a no-op error
    // rather than silently dropping and re-adding it.
    const si = trips.findIndex(t => (t.events || []).some(ev => tripsyEventKey(ev.tripsyRaw) === change.eventKey));
    if (si < 0) throw new Error(`event not found: ${change.eventKey}`);
    const di = trips.findIndex(t => t.key === change.targetTripKey);
    if (di < 0) throw new Error(`trip not found: ${change.targetTripKey}`);
    if (si === di) throw new Error(`event is already in trip ${change.targetTripKey}`);
    const moving = trips[si].events.find(ev => tripsyEventKey(ev.tripsyRaw) === change.eventKey);
    next = [...trips];
    next[si] = { ...trips[si], events: trips[si].events.filter(ev => ev !== moving) };
    next[di] = { ...trips[di], events: sortEvents([...(trips[di].events || []), moving]) };
  } else {
    throw new Error(`unknown change type: ${change.type}`);
  }
  tripsyDecryptedTrips = next;
}
const TRIPSY_TRIP_EDIT_KNOWN_TYPES = ['edit_event', 'delete_event', 'create_event', 'edit_trip', 'create_trip', 'delete_trip', 'move_event'];
function tripsyTripEditCreateIdentity(resource, raw) {
  const r = raw || {};
  const parts = resource === 'transportation'
    ? [r.departureAt, r.departureDescription, r.arrivalDescription]
    : [r.name, r.startsAt];
  if (!parts.some(v => v)) return '';
  return [resource || '', ...parts.map(v => String(v || '').trim().toLowerCase())].join('|');
}
// <<< MIRROR END

const EDITS_FILENAME = 'tripsy-trip-edits.json';
const EDITS_LOG_FILENAME = 'tripsy-trip-edits-log.json';
const EDITS_FOLLOWUP_FILENAME = 'tripsy-applied-edits.json';
const EDITS_TRIPS_FILENAME = 'trips-data.json';
const EDITS_LOG_MAX_RUNS = 30;
const EDITS_SAVE_ATTEMPTS = 3;
const EDITS_SIMPLE_UPLOAD_MAX_BYTES = 4 * 1024 * 1024; // DRIVE_SIMPLE_UPLOAD_MAX_BYTES in index.html
const EDITS_WINDOWS_KEY = 'edits:tripWindows';
const EDITS_WINDOWS_TTL_SECONDS = 6 * 60 * 60;

// ---- pure: is a trip in progress? ----

// [[firstDay, lastDay], ...] for every visible trip not yet over on `todayKey`,
// each widened by a day either side (UTC clock vs. local event days). Same span
// rule as the app and the watch feed: the days a trip's EVENTS cover.
function editsTripWindows(trips, todayKey) {
  const out = [];
  for (const t of feedVisibleTrips(trips)) {
    const { start, end } = feedTripSpan(t);
    if (!start) continue;
    const from = feedAddDays(start, -1), to = feedAddDays(end || start, 1);
    if (to >= todayKey) out.push([from, to]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
function editsOnTrip(windows, todayKey) {
  return (Array.isArray(windows) ? windows : []).some(w => Array.isArray(w) && w[0] <= todayKey && todayKey <= w[1]);
}

// ---- pure: apply one relay's entries to a trips array ----

function editsIsPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function editsFindEventTrip(trips, eventKey) {
  return trips.find(t => (t.events || []).some(ev => tripsyEventKey(ev.tripsyRaw) === eventKey)) || null;
}
// Why an entry must be SKIPPED ('' = apply it). The same tests, in the same
// order, as applyTripsyTripEditsRelay in index.html -- these are what make a
// replayed relay create nothing twice.
function editsSkipReason(trips, change) {
  if (!change || !TRIPSY_TRIP_EDIT_KNOWN_TYPES.includes(change.type)) return 'unknown type';
  if (change.type === 'edit_event' || change.type === 'delete_event' || change.type === 'move_event') {
    if (!editsFindEventTrip(trips, change.eventKey)) return 'event not found';
  } else if (change.type === 'create_event') {
    const trip = trips.find(t => t.key === change.tripKey);
    if (!trip) return 'trip not found';
    const id = tripsyTripEditCreateIdentity(change.tripsyResource, change.fields || {});
    const dup = id && (trip.events || []).find(ev => ev.tripsyRaw
      && tripsyTripEditCreateIdentity(ev.tripsyRaw.resource, ev.tripsyRaw) === id);
    if (dup) return `already exists as ${tripsyEventKey(dup.tripsyRaw)}`;
  } else if (change.type === 'create_trip') {
    if (trips.some(t => t.key === change.tripKey)) return 'trip already exists';
  }
  return '';
}
// Entries the app's form could never produce and that would damage the file.
// Worker-only: nobody is watching an unattended write.
function editsInvalidReason(change) {
  if (change.type === 'create_event') {
    if (!Object.prototype.hasOwnProperty.call(TRIPSY_EDIT_FIELDS, change.tripsyResource)) return 'tripsyResource must be activity, hosting or transportation';
    if (change.fields != null && !editsIsPlainObject(change.fields)) return 'fields must be an object';
  }
  if (change.type === 'edit_event') {
    if (!editsIsPlainObject(change.changes)) return 'changes must be an object';
    if ('resource' in change.changes || 'id' in change.changes) return 'changes may not set resource or id';
  }
  if (change.type === 'edit_trip') {
    if (!editsIsPlainObject(change.changes)) return 'changes must be an object';
    if ('key' in change.changes || 'events' in change.changes) return 'changes may not set key or events';
  }
  if (change.type === 'create_trip' && !change.tripKey) return 'tripKey is required';
  return '';
}
function editsEntryLabel(change) {
  const f = (change && (change.fields || change.changes)) || {};
  return String((change && (change.eventSummary || change.tripName || change.name)) || f.name
    || [f.departureDescription, f.arrivalDescription].filter(Boolean).join(' → ') || '').slice(0, 120);
}
// -> { trips, entries, followUps, applied, skipped, failed }. `trips` is a new
// array when anything applied, the SAME array when nothing did.
function editsApplyRelay(trips, edits) {
  let cur = trips;
  const entries = [], followUps = [];
  let applied = 0, skipped = 0, failed = 0;
  (Array.isArray(edits) ? edits : []).forEach((change, index) => {
    const entry = { index, type: (change && change.type) || null };
    const label = editsEntryLabel(change);
    if (label) entry.label = label;
    if (change && change.eventKey) entry.eventKey = String(change.eventKey);
    if (change && change.tripKey) entry.tripKey = String(change.tripKey);
    try {
      const skip = editsSkipReason(cur, change);
      if (skip) { entry.status = 'skipped'; entry.reason = skip; skipped++; entries.push(entry); return; }
      const bad = editsInvalidReason(change);
      if (bad) throw new Error(bad);
      const sourceTrip = change.eventKey ? editsFindEventTrip(cur, change.eventKey) : null;
      const before = change.type === 'create_event'
        ? new Set(((cur.find(t => t.key === change.tripKey) || {}).events || []).map(ev => tripsyEventKey(ev.tripsyRaw))) : null;
      tripsyDecryptedTrips = cur;
      applyTripsyChangeToTrips(change);
      cur = tripsyDecryptedTrips;
      if (before) {
        const made = ((cur.find(t => t.key === change.tripKey) || {}).events || []).find(ev => !before.has(tripsyEventKey(ev.tripsyRaw)));
        if (made) entry.eventKey = tripsyEventKey(made.tripsyRaw);
      }
      if (sourceTrip) entry.tripKey = sourceTrip.key;
      if (change.type === 'move_event') entry.targetTripKey = String(change.targetTripKey);
      if (['edit_event', 'delete_event', 'move_event', 'delete_trip'].includes(change.type)) {
        followUps.push({ type: change.type, eventKey: change.eventKey || null,
          tripKey: sourceTrip ? sourceTrip.key : (change.tripKey || null), targetTripKey: change.targetTripKey || null });
      }
      entry.status = 'applied'; applied++;
    } catch (e) {
      entry.status = 'failed'; entry.reason = String((e && e.message) || e).slice(0, 200); failed++;
    } finally {
      tripsyDecryptedTrips = null;
    }
    entries.push(entry);
  });
  return { trips: cur, entries, followUps, applied, skipped, failed };
}

// ---- Drive ----

async function driveFetch(env, url, init = {}) {
  const go = async () => {
    const token = await feedAccessToken(env);
    return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await go();
  if (res.status === 401) { await env.AUTH_KV.delete(FEED_ACCESS_KEY); res = await go(); }
  return res;
}
async function editsDriveOk(res, what) {
  if (res.ok) return res;
  throw new Error(`${what} failed (${res.status})`);
}
async function editsListByName(env, name, fields) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const res = await editsDriveOk(await driveFetch(env, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(${fields})&spaces=drive`), `Drive search for ${name}`);
  return (await res.json()).files || [];
}
async function editsHeadRevision(env, fileId) {
  const res = await editsDriveOk(await driveFetch(env, `https://www.googleapis.com/drive/v3/files/${fileId}?fields=headRevisionId`), 'Drive revision check');
  return (await res.json()).headRevisionId || null;
}
// trips-data.json exactly as the app finds it (fetchTripsDataFromDrive): real
// files only, the most recently modified wins.
async function editsLoadTripsDoc(env) {
  const files = (await editsListByName(env, EDITS_TRIPS_FILENAME, 'id,mimeType,modifiedTime,headRevisionId,parents'))
    .filter(f => !String(f.mimeType || '').startsWith('application/vnd.google-apps'))
    .sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')));
  if (!files.length) throw new Error('trips-data.json not found');
  const res = await editsDriveOk(await driveFetch(env, `https://www.googleapis.com/drive/v3/files/${files[0].id}?alt=media`), 'trips-data.json download');
  const doc = await res.json();
  const trips = Array.isArray(doc) ? doc : (doc && doc.trips);
  if (!Array.isArray(trips)) throw new Error('trips-data.json has an unexpected shape');
  return { fileId: files[0].id, revision: files[0].headRevisionId || null, parents: files[0].parents || [], trips };
}
// Replaces a file's content (updateDriveDataFile in index.html: simple upload up
// to 4 MB, resumable past it). Returns the new head revision.
async function editsUploadJson(env, fileId, data) {
  const body = JSON.stringify(data);
  const base = `https://www.googleapis.com/upload/drive/v3/files/${fileId}`;
  if (new TextEncoder().encode(body).length <= EDITS_SIMPLE_UPLOAD_MAX_BYTES) {
    const res = await editsDriveOk(await driveFetch(env, `${base}?uploadType=media&fields=headRevisionId`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body }), 'Drive save');
    return (await res.json().catch(() => ({}))).headRevisionId || null;
  }
  const start = await editsDriveOk(await driveFetch(env, `${base}?uploadType=resumable&fields=headRevisionId`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}' }), 'Drive save (start)');
  const uploadUrl = start.headers.get('Location');
  if (!uploadUrl) throw new Error('Drive resumable upload did not return a session URL');
  const put = await editsDriveOk(await driveFetch(env, uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }), 'Drive save (upload)');
  return (await put.json().catch(() => ({}))).headRevisionId || null;
}
async function editsCreateJson(env, name, parents, data) {
  const boundary = `tt${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const meta = { name, mimeType: 'application/json' };
  if (parents && parents.length) meta.parents = parents;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}--`;
  await editsDriveOk(await driveFetch(env, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }), `Drive create ${name}`);
}

function editsStamp(nowMs) { return new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }

// Reads every pending relay. A file that can never be read (not JSON, or a
// Google Doc someone converted it into) is RENAMED out of the way and reported.
async function editsReadRelays(env, files, nowMs) {
  const relays = [], invalid = [];
  for (const f of files) {
    let why = '', edits = null;
    if (String(f.mimeType || '').startsWith('application/vnd.google-apps')) why = 'it is a Google Doc, not a JSON file';
    else {
      const res = await editsDriveOk(await driveFetch(env, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`), 'relay download');
      try {
        const relay = JSON.parse(await res.text());
        if (!relay || !Array.isArray(relay.edits)) why = 'it has no "edits" list';
        else edits = relay.edits;
      } catch (_) { why = 'it is not valid JSON'; }
    }
    if (why) {
      const newName = `tripsy-trip-edits.invalid-${editsStamp(nowMs)}.json`;
      await editsDriveOk(await driveFetch(env, `https://www.googleapis.com/drive/v3/files/${f.id}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }) }), 'relay rename');
      invalid.push({ id: f.id, createdTime: f.createdTime || null, reason: why, renamedTo: newName });
    } else relays.push({ id: f.id, createdTime: f.createdTime || null, edits });
  }
  return { relays, invalid };
}

// Applies every relay, in the order they were written, to one trips array.
function editsApplyAll(trips, relays) {
  let cur = trips;
  const files = [], followUps = [];
  let applied = 0, skipped = 0, failed = 0;
  for (const r of relays) {
    const out = editsApplyRelay(cur, r.edits);
    cur = out.trips;
    files.push({ id: r.id, createdTime: r.createdTime, applied: out.applied, skipped: out.skipped, failed: out.failed, entries: out.entries });
    followUps.push(...out.followUps);
    applied += out.applied; skipped += out.skipped; failed += out.failed;
  }
  return { trips: cur, files, followUps, applied, skipped, failed };
}

async function editsWriteLog(env, parents, run) {
  const existing = (await editsListByName(env, EDITS_LOG_FILENAME, 'id,mimeType,createdTime'))
    .filter(f => !String(f.mimeType || '').startsWith('application/vnd.google-apps'))
    .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  let runs = [];
  if (existing.length) {
    try {
      const res = await driveFetch(env, `https://www.googleapis.com/drive/v3/files/${existing[0].id}?alt=media`);
      const doc = res.ok ? await res.json() : null;
      if (doc && Array.isArray(doc.runs)) runs = doc.runs;
    } catch (_) { /* an unreadable log starts over */ }
  }
  const doc = { updatedAt: run.at, runs: [run, ...runs].slice(0, EDITS_LOG_MAX_RUNS) };
  if (existing.length) await editsUploadJson(env, existing[0].id, doc);
  else await editsCreateJson(env, EDITS_LOG_FILENAME, parents, doc);
}

async function editsStoreTripWindows(env, trips, nowMs) {
  const windows = editsTripWindows(trips, new Date(nowMs).toISOString().slice(0, 10));
  await env.AUTH_KV.put(EDITS_WINDOWS_KEY, JSON.stringify(windows), { expirationTtl: EDITS_WINDOWS_TTL_SECONDS });
  return windows;
}
// True while a trip is in progress. The cached windows answer it with one KV
// read; every six hours (the key's TTL) they are rebuilt from trips-data.json,
// which is how a trip added or re-dated in the app is noticed.
async function editsTripInProgress(env, nowMs) {
  const todayKey = new Date(nowMs).toISOString().slice(0, 10);
  let windows = null;
  try { windows = JSON.parse(await env.AUTH_KV.get(EDITS_WINDOWS_KEY)); } catch (_) { windows = null; }
  if (!Array.isArray(windows)) windows = await editsStoreTripWindows(env, (await editsLoadTripsDoc(env)).trips, nowMs);
  return editsOnTrip(windows, todayKey);
}

// One pass. Returns null when there is nothing to do, else the run it logged.
// `onlyOnTrip` (the timer) does nothing unless a trip is in progress; the
// manual apply-edits endpoint runs regardless.
async function editsDrain(env, nowMs = Date.now(), opts = {}) {
  if (opts.onlyOnTrip && !(await editsTripInProgress(env, nowMs))) return null;
  const pending = (await editsListByName(env, EDITS_FILENAME, 'id,mimeType,createdTime'))
    .sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
  if (!pending.length) return null;
  const { relays, invalid } = await editsReadRelays(env, pending, nowMs);

  let doc = await editsLoadTripsDoc(env);
  let out = editsApplyAll(doc.trips, relays);
  let saved = false;
  for (let attempt = 0; out.applied && !saved; attempt++) {
    // Another writer (the app, on any device) saved since we loaded: take
    // theirs and re-apply ours onto it. The replay checks run again.
    const head = doc.revision ? await editsHeadRevision(env, doc.fileId) : null;
    if (head && head !== doc.revision) {
      if (attempt >= EDITS_SAVE_ATTEMPTS - 1) throw new Error('trips-data.json kept changing -- left for the next run');
      doc = await editsLoadTripsDoc(env);
      out = editsApplyAll(doc.trips, relays);
      continue;
    }
    await editsUploadJson(env, doc.fileId, { schemaVersion: 1, updatedAt: new Date(nowMs).toISOString(), trips: out.trips });
    saved = true;
  }
  if (saved) {
    await env.AUTH_KV.delete(FEED_TRIPS_KEY); // the watch feed re-reads at once
    // The save may have added, moved or removed a trip's days.
    try { await editsStoreTripWindows(env, out.trips, nowMs); } catch (e) { console.error('trip-edits: trip windows update failed:', e); }
  }

  const run = { at: new Date(nowMs).toISOString(), by: 'worker', saved,
    applied: out.applied, skipped: out.skipped, failed: out.failed, files: out.files };
  if (invalid.length) run.invalid = invalid;
  // Bookkeeping must never strand an applied relay, so each step stands alone.
  if (saved) {
    try { await editsCreateJson(env, EDITS_FOLLOWUP_FILENAME, doc.parents, { at: run.at, changes: out.followUps }); }
    catch (e) { console.error('trip-edits: follow-up relay failed:', e); }
  }
  try { await editsWriteLog(env, doc.parents, run); } catch (e) { console.error('trip-edits: log write failed:', e); }
  for (const r of relays) {
    await editsDriveOk(await driveFetch(env, `https://www.googleapis.com/drive/v3/files/${r.id}`, { method: 'DELETE' }), 'relay delete');
  }
  return run;
}

function editsRunText(run) {
  if (!run) return 'No trip edits waiting.';
  const lines = [`Applied ${run.applied}, skipped ${run.skipped}, failed ${run.failed}.`];
  for (const f of run.files) for (const e of f.entries) {
    lines.push(`${e.status.toUpperCase()}  ${e.type || '?'}  ${e.label || e.eventKey || e.tripKey || ''}${e.reason ? `  (${e.reason})` : ''}`);
  }
  for (const i of (run.invalid || [])) lines.push(`UNREADABLE  ${i.reason} -- renamed to ${i.renamedTo}`);
  return lines.join('\n');
}

export default {
  // Cron Trigger (every minute): apply any waiting tripsy-trip-edits.json --
  // only while a trip is in progress; otherwise the app applies it on next open.
  async scheduled(event, env, ctx) {
    if (!env.AUTH_KV || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CLIENT_ID || !env.OWNER_EMAIL) return;
    ctx.waitUntil(editsDrain(env, Date.now(), { onlyOnTrip: true }).then(
      run => { if (run) console.log(`trip-edits: applied ${run.applied}, skipped ${run.skipped}, failed ${run.failed}`); },
      e => console.error('trip-edits drain failed:', (e && e.message) || e),
    ));
  },
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
      if (parts[0] !== 'feed' || !env.AUTH_KV || !env.GOOGLE_CLIENT_SECRET) return textResponse('Not found', 404);
      try { return await handleFeed(request, env, parts, url); }
      catch (e) { return textResponse(`Travel Tracker feed unavailable: ${(e && e.message) || e}`, (e && e.status) || 500); }
    }
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
