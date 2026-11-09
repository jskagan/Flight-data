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

export default {
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
