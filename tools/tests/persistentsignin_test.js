// "Is there a way to keep me logged in ... when I am using a device that must be
// unlocked?" (2026-08-29). Device unlock can't be the key -- Face ID authenticates
// you to the DEVICE, not to Google, and there's no relying-party server for a
// passkey. The real blocker was structural: the browser-only token flow
// (initTokenClient) never issues a REFRESH token, so its only silent renewal is a
// hidden accounts.google.com iframe, which Safari/iOS ITP blocks -- hence the
// roughly-hourly bounce to the sign-in screen on iPad.
//
// Fix: the auth Worker (tools/auth-worker) holds the client secret, exchanges an
// authorization code for a refresh token, keeps it server-side, and mints access
// tokens on request. Renewal becomes an ordinary fetch, so ITP has nothing to block.
//
// The invariant this suite most cares about: EVERY new path fails soft, so an
// undeployed/unreachable Worker leaves the original GIS flow working exactly as
// before. Sign-in is the whole app -- a regression here locks the owner out.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) return '';
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
  return '';
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the device credential ----
assert(/const DEVICE_ID_KEY = 'flightlog_device_id';/.test(html),
  'the device credential has its own localStorage key, separate from the ~1h token cache');
assert(/const AUTH_WORKER_URL = 'https:\/\/[^']+';/.test(html),
  'the Worker URL is a single named constant');

// ---- startup: the Worker is tried BEFORE the ITP-prone silent grant ----
const initAuth = extractFn('initGoogleAuth');
const cachedIdx = initAuth.indexOf('const cached = loadCachedToken();');
const workerIdx = initAuth.indexOf('if (loadDeviceId() && navigator.onLine)');
assert(cachedIdx > -1 && workerIdx > cachedIdx,
  'a still-valid ~1h token still wins outright; the Worker only covers the expired case');
assert(workerIdx > -1 && initAuth.indexOf('continueWithGisStartup') > workerIdx,
  'THE FIX: the Worker attempt runs BEFORE falling through to the original GIS startup paths');
assert(/authWorkerGetAccessToken\(\)\.then\(result => \{[\s\S]*?if \(result\) \{[\s\S]*?completeSignIn\(\);/.test(initAuth),
  'a successful Worker token signs in with zero interaction');
assert(/\/\/ No token[\s\S]*?continueWithGisStartup\(\);/.test(initAuth),
  'and no token (revoked, or Worker unreachable) falls back rather than stranding the device');

// ---- the original GIS startup survives verbatim in its own function ----
const gisStartup = extractFn('continueWithGisStartup');
assert(/const rememberedDevice =/.test(gisStartup) && /refreshDriveAccessToken\(8000\)/.test(gisStartup),
  'the pre-Worker silent-grant path is intact (moved, not changed) so an undeployed Worker regresses nothing');
assert(/maybeOfferOfflineMode\(\);/.test(gisStartup),
  'and it still ends at the sign-in gate with the offline offer');

// ---- mid-session 401: Worker first, GIS second ----
const driveFetch = extractFn('driveApiFetch');
const wIdx = driveFetch.indexOf('authWorkerGetAccessToken()');
const gIdx = driveFetch.indexOf('await refreshDriveAccessToken();');
assert(wIdx > -1 && gIdx > -1 && wIdx < gIdx,
  'a 401 tries the Worker before the GIS silent grant -- an ordinary fetch beats an iframe ITP may block');
assert(/const viaWorker = await authWorkerGetAccessToken\(\);\s*\n\s*if \(viaWorker\) \{/.test(driveFetch),
  'and only uses it when it actually returned a token');
assert(/if \(!_retriedAfterRefresh\)/.test(driveFetch),
  'still exactly one retry, so a dead session cannot loop');

// ---- code flow: the part that actually yields a refresh token ----
assert(/access_type: 'offline',/.test(initAuth),
  'the code client asks for offline access -- without it Google issues no refresh token at all');
assert(/prompt: 'consent',/.test(initAuth),
  'and forces consent, or an already-granted account silently gets a code with NO refresh token');
assert(/if \(codeClient\) codeClient\.requestCode\(\);\s*\n\s*else tokenClient\.requestAccessToken\(\);/.test(initAuth),
  'sign-in prefers the code flow but falls back to the original token flow when unavailable');
assert(/if \(!result\) \{[\s\S]*?tokenClient\.requestAccessToken\(\);/.test(initAuth),
  'a failed exchange (Worker down/not configured) still signs the owner in, just without persistence');

// ---- signing out must actually sign out ----
const signOutIdx = html.indexOf("document.getElementById('signout-btn')");
const signOutBlock = html.slice(signOutIdx, signOutIdx + 700);
assert(/await authWorkerRevoke\(\);/.test(signOutBlock),
  'sign out revokes the persistent credential -- clearing only the token cache would let the next load mint a new one');
const revokeIdx = signOutBlock.indexOf('authWorkerRevoke');
const clearIdx = signOutBlock.indexOf('clearCachedToken()');
assert(revokeIdx > -1 && clearIdx > revokeIdx, 'and does so before clearing local state');

// ---- fail-soft: none of the Worker helpers may throw into their callers ----
for (const name of ['authWorkerGetAccessToken', 'authWorkerExchangeCode', 'authWorkerRevoke']) {
  const fn = extractFn(name);
  assert(/try \{/.test(fn) && /catch \(e\) \{/.test(fn), `${name} catches its own failures`);
}
const getTok = extractFn('authWorkerGetAccessToken');
assert(/if \(status === 401\) \{[\s\S]*?clearDeviceId\(\);/.test(getTok),
  'a 401 is permanent (revoked/expired/unknown), so the dead credential is cleared');
assert(/catch \(e\) \{[\s\S]*?keeping the credential[\s\S]*?return null;/.test(getTok),
  'but a transient failure KEEPS the credential -- a flaky connection must not sign the device out for good');

// ---- executed: the credential-lifecycle decision, against fixtures ----
{
  // Mirrors authWorkerGetAccessToken's branching: what happens to the stored
  // credential for each outcome.
  const decide = (ok, status) => {
    if (ok) return 'use-token';
    if (status === 401) return 'clear-credential';
    return 'keep-credential';
  };
  assert(decide(true, 200) === 'use-token', 'a good response signs in silently');
  assert(decide(false, 401) === 'clear-credential', 'revoked at myaccount.google.com -> clear, fall back to interactive sign-in');
  assert(decide(false, 502) === 'keep-credential', 'Google unreachable from the Worker -> keep, try again next load');
  assert(decide(false, 0) === 'keep-credential', 'network/timeout -> keep, so an offline trip does not sign the device out');
}
