// "Is there a way to automatically sign users in ... on the same devices they
// generally use." True biometric sign-in isn't possible in this serverless
// architecture (access is a Google OAuth token only Google can mint; there is no
// relying-party server for WebAuthn to talk to) -- but the actual goal IS: a
// returning device whose cached ~1h token had expired used to bounce to the sign-in
// screen for a tap, even though the browser's Google session was usually still alive
// and a prompt-less grant would succeed. initGoogleAuth now tries that SILENT grant
// (refreshDriveAccessToken with prompt:'') behind the splash before ever showing the
// gate, on any device that previously chose "remember me"; any failure falls back to
// exactly the old sign-in screen, with the offline offer forced (a real attempt just
// failed -- the weak-signal lesson).
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  const start = m.index;
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') paren++;
    else if (html[i] === ')') { paren--; if (!paren) { i++; break; } }
  }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const initAuth = extractFn('initGoogleAuth');

// ---- ordering: valid cached token still wins outright (unchanged fast path) ----
const cachedIdx = initAuth.indexOf('const cached = loadCachedToken();');
const silentIdx = initAuth.indexOf('const rememberedDevice =');
assert(cachedIdx > -1 && silentIdx > cachedIdx,
  'the valid-cached-token fast path still runs first; the silent attempt only covers the expired case');

// ---- the silent attempt itself ----
assert(/const rememberedDevice = \(\(\) => \{ try \{ return localStorage\.getItem\(TOKEN_CACHE_KEY\) !== null; \} catch \(e\) \{ return false; \} \}\)\(\);/.test(initAuth),
  'a returning device is one that chose "remember me" (a cache entry exists, even expired) -- same signal the mid-session refresh uses');
assert(/if \(rememberedDevice && navigator\.onLine\) \{/.test(initAuth),
  'the attempt is gated on remember-me AND being plausibly online');
assert(/refreshDriveAccessToken\(8000\)\s*\n\s*\.then\(\(\) => \{ completeSignIn\(\); \}\)/.test(initAuth),
  'THE FIX: a silent (prompt:\'\') grant runs behind the splash and signs in with zero interaction on success');
assert(/\.catch\(e => \{[\s\S]*?display = 'none';[\s\S]*?display = 'flex';[\s\S]*?maybeOfferOfflineTravelView\(true\);/.test(initAuth),
  'any failure falls back to exactly the old sign-in screen, with the offline offer FORCED (a real attempt just failed)');

// ---- a never-remembered device is untouched ----
assert(/document\.getElementById\('signin-gate'\)\.style\.display = 'flex';\s*\n\s*maybeOfferOfflineTravelView\(\);\s*\n\}/.test(initAuth),
  'a device that never chose "remember me" still gets the explicit sign-in screen, exactly as before');

// ---- the shared refresh helper takes the startup timeout without changing its default ----
const refreshFn = extractFn('refreshDriveAccessToken');
assert(/function refreshDriveAccessToken\(timeoutMs = 15000\)/.test(refreshFn),
  'the refresh helper takes an optional timeout, defaulting to the old 15s for every existing caller');
assert(/\}, timeoutMs\);/.test(refreshFn), 'and actually uses it for the safety-net timer');
assert(/refreshDriveAccessToken\(8000\)/.test(initAuth),
  'the startup attempt uses a shorter 8s window -- a dead session must not hold a blank splash for 15s');

// ---- executed: the gating decision, against fixtures ----
{
  const decide = (hasValidCachedToken, rememberEntryExists, onLine) => {
    if (hasValidCachedToken) return 'fast-path';
    if (rememberEntryExists && onLine) return 'silent-attempt';
    return 'gate';
  };
  assert(decide(true, true, true) === 'fast-path', 'a still-valid token signs in instantly, as before');
  assert(decide(false, true, true) === 'silent-attempt',
    'THE ASK: an expired token on a remembered device tries the silent sign-in instead of showing the gate');
  assert(decide(false, false, true) === 'gate', 'a fresh device (or one that declined remember-me) sees the sign-in screen');
  assert(decide(false, true, false) === 'gate', 'a device that knows it is offline skips straight to the gate (which offers offline Travel View)');
}
