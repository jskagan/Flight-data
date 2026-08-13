// "When there is no WiFi connection, the app is supposed to display the stale travel
// view - but it is not doing that. It is stuck on a white screen." THREE separate
// places can land on the sign-in gate with no network, and each needed its own
// maybeOfferOfflineTravelView() call -- fixed one at a time as the same report kept
// recurring after each partial fix:
// 1. A device that has signed in before takes the cached-token FAST PATH straight into
//    completeSignIn(), bypassing the initGoogleAuth() branch that offers it below the
//    sign-in gate. Every network call inside completeSignIn then fails and lands in
//    ITS OWN catch block, which showed the error but never offered the fallback.
// 2. THE ACTUAL CULPRIT in practice: Google Identity Services is an external script
//    (accounts.google.com/gsi/client) that never loads at all with no network -- this
//    fires BEFORE initGoogleAuth() or completeSignIn() ever run, so neither of THEIR
//    fixes (above) is ever reached. This is the FIRST thing that fails offline, so
//    it's the one that actually matters most -- the earlier two fixes alone still left
//    the report reproducing.
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

// ---- the THIRD, most important gap: Google Identity Services (an external script,
// accounts.google.com/gsi/client) never loads at all with no network -- this is the
// FIRST thing that fails offline, firing BEFORE initGoogleAuth() or completeSignIn()
// ever run, so neither of their own maybeOfferOfflineTravelView() calls is reached ----
const waitStart = html.indexOf('function waitForGoogleIdentity');
const waitBlock = html.slice(waitStart, html.indexOf('})();', waitStart) + 5);
assert(waitBlock.includes('waitForGoogleIdentity'), 'sanity: found the GIS polling IIFE');
assert(/Could not load Google Sign-In\. Check your connection and reload the page\./.test(waitBlock),
  'sanity: this is the "ran out of tries" branch (GIS never became available)');
assert(/showSignInStatus\('Could not load Google Sign-In[^;]*;[\s\S]{0,700}maybeOfferOfflineTravelView\(\);/.test(waitBlock),
  'THE FIX: the offline fallback is now offered here too -- the gap that actually matters most, since ' +
  'this fires before the other two call sites ever get a chance to run');

// ---- maybeOfferOfflineTravelView itself is idempotent, so calling it from three
// different places can never double-render the offline button ----
const offlineOffer = extractFn('maybeOfferOfflineTravelView');
assert(/if \(!gate \|\| document\.getElementById\('signin-offline-btn'\)\) return;/.test(offlineOffer),
  'a second/third call (this fix stacking on the earlier ones) is a safe no-op if the button already exists');
assert(/if \(navigator\.onLine\) return;/.test(offlineOffer), 'and it only ever shows when the browser reports being offline');
