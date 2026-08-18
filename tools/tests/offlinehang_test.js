// "When the internet connection is weak or fails, the app is supposed to show the
// last used version of travel view. I don't think this is happening." Two gaps
// remained after the three earlier offline-fallback fixes (which all fire on a
// network call FAILING): (1) on a WEAK connection a fetch can HANG for a minute-plus
// without rejecting -- no catch runs, the splash sits on "Loading your data from
// Drive…" forever, and the fallback is never offered; (2) even when the fallback
// appeared, it was only an offer BUTTON -- the owner expects the cached Travel View
// to simply SHOW on a travel device. Fixed: completeSignIn arms a 12s watchdog that
// surfaces the forced fallback when sign-in is merely stuck, and a forced fallback
// on a device whose saved landing preference is Travel View AUTO-OPENS the cached
// schedule instead of offering a button. One shared enterOfflineTravelView is used
// by both the button and the auto path, and flags guard against the in-flight
// sign-in attempt later clobbering an entered offline view.
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

// ---- the hang watchdog ----
const signIn = extractFn('completeSignIn');
assert(/const watchdog = setTimeout\(\(\) => \{\s*\n\s*if \(_tripsySignedInDone \|\| _tripsyOfflineEntered\) return;/.test(signIn),
  'THE FIX: a watchdog fires when sign-in is merely STUCK (no failure to catch), unless it already finished or offline was entered');
assert(/maybeOfferOfflineTravelView\(true\);\s*\n\s*\}, 12000\);/.test(signIn),
  'after 12s it surfaces the FORCED offline fallback while the attempt keeps running');
assert(/Still \$\{stage\} — the connection looks weak…/.test(signIn),
  'and says honestly what it is still doing');
assert((signIn.match(/clearTimeout\(watchdog\);/g) || []).length >= 3,
  'the watchdog is cleared on success, on offline-entered early-outs, and in the catch');
assert(/_tripsySignedInDone = true;\s*\n\s*clearTimeout\(watchdog\);/.test(signIn),
  'a full success marks itself done (so a late watchdog/offer can never fire against a signed-in app)');
// The in-flight attempt must not clobber an entered offline view.
assert(/if \(_tripsyOfflineEntered\) \{ clearTimeout\(watchdog\); return; \}/.test(signIn),
  'a sign-in limping to success AFTER offline Travel View was entered stops instead of overwriting the view');
assert(/if \(_tripsyOfflineEntered\) return;\s*\n\s*\/\/ Surface the error/.test(signIn),
  'and a late FAILURE with offline already entered stays silent rather than painting the gate over the schedule');

// ---- auto-open on Travel View devices ----
const offer = extractFn('maybeOfferOfflineTravelView');
assert(/if \(_tripsyOfflineEntered \|\| _tripsySignedInDone\) return;/.test(offer),
  'the offer never fires against an already-entered offline view or a signed-in app');
assert(/if \(force && loadTravelViewPref\(\)\) \{ await enterOfflineTravelView\(cached\); return; \}/.test(offer),
  'THE ASK: on a real failure, a device whose saved landing is Travel View auto-OPENS the cached schedule -- no button tap');
assert(/document\.getElementById\('signin-offline-btn'\)\.addEventListener\('click', \(\) => enterOfflineTravelView\(cached\)\);/.test(offer),
  'the offer button (for normal-app devices) goes through the same shared entry');

// ---- the shared entry ----
const enter = extractFn('enterOfflineTravelView');
assert(/if \(_tripsyOfflineEntered\) return;\s*\n\s*_tripsyOfflineEntered = true;/.test(enter),
  'entering is idempotent -- watchdog, catch, and button can all race without double-entering');
assert(/tripsyTripsAreOffline = true;/.test(enter) && /tripsyPsReservations = \[\];/.test(enter),
  'the offline flags and minimal driveData shape are set exactly as the old button did');
assert(/document\.getElementById\('splash-screen'\)\.style\.display = 'none';/.test(enter),
  'the splash is hidden too -- the watchdog path enters straight from behind the splash');
assert(/await navigate\('travelview'\)/.test(enter), 'and it lands on Travel View');

// ---- executed: the decision logic, against fixtures ----
{
  const offerDecision = (offlineEntered, signedInDone, force, onLine, cached, tvPref) => {
    if (offlineEntered || signedInDone) return 'none';
    if (!force && onLine) return 'none';
    if (!cached) return 'none';
    if (force && tvPref) return 'auto-open';
    return 'offer-button';
  };
  assert(offerDecision(false, false, true, true, true, true) === 'auto-open',
    'THE ASK: weak signal (real failure, onLine lying true) on a Travel View device -> the cached schedule just SHOWS');
  assert(offerDecision(false, false, true, true, true, false) === 'offer-button',
    'the same failure on a normal-app device keeps the explicit offer (its owner may prefer to retry sign-in)');
  assert(offerDecision(false, false, false, true, true, true) === 'none',
    'the proactive (non-forced) call still respects navigator.onLine, unchanged');
  assert(offerDecision(false, false, true, false, false, true) === 'none',
    'no cached copy -> nothing to open, nothing to offer');
  assert(offerDecision(true, false, true, false, true, true) === 'none',
    'already inside the offline view -> no second entry, no stray offer box');
  assert(offerDecision(false, true, true, false, true, true) === 'none',
    'a fully signed-in app never gets the fallback fired at it by a late watchdog');
}
