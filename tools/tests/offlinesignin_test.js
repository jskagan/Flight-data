// "When there is no WiFi connection, the app is supposed to display the stale travel
// view - but it is not doing that. It is stuck on a white screen." Root cause: a device
// that has signed in before (i.e. has a remembered token) takes the cached-token FAST
// PATH straight into completeSignIn() -- never through the initGoogleAuth() branch that
// calls maybeOfferOfflineTravelView() below the sign-in gate. With no signal, every
// network call inside completeSignIn (fetchSignedInUserEmail, findDriveDataFile, ...)
// fails, landing in its catch block -- which showed the error and the sign-in gate, but
// never offered the offline fallback, stranding a returning (i.e. almost every real)
// user with no way back into their already-cached schedule.
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

// ---- the fast path: a cached token skips straight to completeSignIn(), bypassing
// the branch that normally offers the offline fallback ----
const initAuth = extractFn('initGoogleAuth');
assert(/const cached = loadCachedToken\(\);\s*\n\s*if \(cached\) \{\s*\n\s*driveAccessToken = cached;\s*\n\s*completeSignIn\(\);\s*\n\s*return;/.test(initAuth),
  'sanity: the cached-token fast path really does return before reaching the offline offer below it');
assert(/maybeOfferOfflineTravelView\(\);\s*\n\}/.test(initAuth),
  'sanity: initGoogleAuth\'s OWN (non-fast-path) branch offers it, confirming the fast path is the one that skips it');

// ---- the fix: completeSignIn's catch block ALSO offers the offline fallback ----
const signIn = extractFn('completeSignIn');
const catchBlock = signIn.slice(signIn.lastIndexOf('} catch (e) {'));
assert(/document\.getElementById\('signin-gate'\)\.style\.display = 'flex';/.test(catchBlock),
  'the sign-in gate is revealed on failure (pre-existing behavior, unaffected)');
assert(/maybeOfferOfflineTravelView\(\);/.test(catchBlock),
  'THE FIX: the offline fallback is now offered from this catch too, covering the fast-path failure');

// ---- maybeOfferOfflineTravelView itself is idempotent, so calling it from two
// different places can never double-render the offline button ----
const offlineOffer = extractFn('maybeOfferOfflineTravelView');
assert(/if \(!gate \|\| document\.getElementById\('signin-offline-btn'\)\) return;/.test(offlineOffer),
  'a second call (e.g. this fix stacking on the existing one in some code path) is a safe no-op if the button already exists');
assert(/if \(navigator\.onLine\) return;/.test(offlineOffer), 'and it only ever shows when the browser reports being offline');
