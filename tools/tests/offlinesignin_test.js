// "When there is no WiFi connection, the app is supposed to display the stale travel
// view - but it is not doing that. It is stuck on a white screen." THREE separate
// places can land on the sign-in gate with no network, and each needed its own
// maybeOfferOfflineMode() call -- fixed one at a time as the same report kept
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
// 3. THE FOLLOW-UP REPORT ("no WiFi or a weak signal"): both fixes above still gated
//    on navigator.onLine, which only reports whether a network INTERFACE is active, not
//    whether it actually works -- a weak/flaky signal reports onLine:true right up
//    until every real request on it fails. Both failure-path callers now pass
//    force:true, skipping that check entirely: the failure that got them there IS
//    stronger evidence than what navigator.onLine claims. Only the ONE caller with no
//    prior failure (initGoogleAuth's fresh sign-in gate) still checks it.
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
assert(/maybeOfferOfflineMode\(\);\s*\n\}/.test(initAuth),
  'sanity: initGoogleAuth\'s OWN (non-fast-path) branch offers it, confirming the fast path is the one that skips it');

// ---- the fix: completeSignIn's catch block ALSO offers the offline fallback ----
const signIn = extractFn('completeSignIn');
const catchBlock = signIn.slice(signIn.lastIndexOf('} catch (e) {'));
assert(/document\.getElementById\('signin-gate'\)\.style\.display = 'flex';/.test(catchBlock),
  'the sign-in gate is revealed on failure (pre-existing behavior, unaffected)');
assert(/maybeOfferOfflineMode\(true\);/.test(catchBlock),
  'THE FIX: the offline fallback is now offered from this catch too, covering the fast-path failure -- ' +
  'force:true, since this catch running is itself the failure evidence');

// ---- the THIRD, most important gap: Google Identity Services (an external script,
// accounts.google.com/gsi/client) never loads at all with no network -- this is the
// FIRST thing that fails offline, firing BEFORE initGoogleAuth() or completeSignIn()
// ever run, so neither of their own maybeOfferOfflineMode() calls is reached ----
const waitStart = html.indexOf('function waitForGoogleIdentity');
const waitBlock = html.slice(waitStart, html.indexOf('})();', waitStart) + 5);
assert(waitBlock.includes('waitForGoogleIdentity'), 'sanity: found the GIS polling IIFE');
assert(/Could not load Google Sign-In\. Check your connection and reload the page\./.test(waitBlock),
  'sanity: this is the "ran out of tries" branch (GIS never became available)');
assert(/showSignInStatus\('Could not load Google Sign-In[^;]*;[\s\S]{0,900}maybeOfferOfflineMode\(true\);/.test(waitBlock),
  'THE FIX: the offline fallback is now offered here too -- the gap that actually matters most, since ' +
  'this fires before the other two call sites ever get a chance to run, and with force:true');

// ---- maybeOfferOfflineMode itself is idempotent, so calling it from three
// different places can never double-render the offline button ----
const offlineOffer = extractFn('maybeOfferOfflineMode');
assert(/async function maybeOfferOfflineMode\(force = false\)/.test(offlineOffer),
  'takes a force param, defaulting to false so the one non-failure caller is unaffected');
assert(/if \(!gate \|\| document\.getElementById\('signin-offline-btn'\)\) return;/.test(offlineOffer),
  'a second/third call (this fix stacking on the earlier ones) is a safe no-op if the button already exists');
assert(/if \(!force && navigator\.onLine\) return;/.test(offlineOffer),
  'THE WEAK-SIGNAL FIX: navigator.onLine is only checked when NOT forced -- a forced call (real failure ' +
  'already happened) shows the offer regardless of what onLine claims');

// ---- initGoogleAuth's own proactive call (no failure yet) is unaffected: still no
// force arg, so it still respects navigator.onLine as before ----
assert(/document\.getElementById\('signin-gate'\)\.style\.display = 'flex';\s*\n\s*maybeOfferOfflineMode\(\);\s*\n\}/.test(initAuth),
  'the one caller with nothing to go on yet still passes no force, unlike the two failure-path callers');

// ---- the wording no longer overclaims "you're offline" when we don't actually know
// that -- a forced call could be a weak signal, not truly offline ----
assert(/const headline = force \? "Couldn't reach the sign-in servers" : "You're offline";/.test(offlineOffer),
  'a forced (failure-driven) call uses honest wording instead of asserting offline status navigator.onLine may contradict');
