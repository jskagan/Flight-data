// "When the splash screen displays for more than 3 seconds, automatically switch to the
// travel view displaying the cached view of the current trip or next upcoming trip if
// not on a current trip" (2026-10-12). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};

// ---- scaffold: a fake document with a splash, gate, app-root and a rail ----
function makeWorld({ cache = { trips: [{ key: 't1', start: '2026-10-20' }], updatedAt: 'u', cachedAt: 'c' }, signedIn = false, splashShown = true } = {}) {
  const el = (id, display) => ({ id, style: { display }, dataset: {} });
  const splash = el('splash-screen', splashShown ? 'flex' : 'none');
  const gate = el('signin-gate', splashShown ? 'none' : 'flex');
  const appRoot = el('app-root', 'none');
  const rail = [
    { dataset: { view: 'home' }, style: { display: '' } },
    { dataset: { view: 'travelview' }, style: { display: '' } },
    { dataset: { view: 'tripsytrips' }, style: { display: '' } },
    { dataset: { view: 'upload' }, style: { display: 'none' } }, // already hidden by someone else
  ];
  const toggles = [{ dataset: {}, style: { display: '' } }];
  const document = {
    getElementById: id => ({ 'splash-screen': splash, 'signin-gate': gate, 'app-root': appRoot })[id] || null,
    querySelectorAll: sel => (sel.startsWith('.rail-item[data-view]') ? rail : toggles),
  };
  const navigated = [];
  const ctx = {
    document, console,
    setTimeout: (fn, ms) => { ctx.lastTimer = { fn, ms }; return 1; }, clearTimeout: () => {},
    loadTripsyOfflineTrips: async () => cache,
    navigate: async v => { navigated.push(v); ctx.currentView = v; },
    currentView: '',
    OFFLINE_ALLOWED_VIEWS: new Set(['travelview', 'tripinsurance']),
    driveData: null, tripsyPsReservations: null, tripsyDecryptedTrips: null, tripsyTripsAreOffline: false, tripsyOfflineCacheInfo: null,
    appOfflineMode: false, _tripsyOfflineEntered: false, _tripsySignedInDone: signedIn,
  };
  const api = null; // built by build() below, inside a with(ctx) scope
  return { ctx, api, splash, gate, appRoot, rail, toggles, navigated };
}
// The extracted functions read AND assign the app's globals by bare name; running the
// source inside `with (ctx)` resolves both to the fixture object's properties.
const build = opts => {
  const w = makeWorld(opts);
  const src = [
    "let _tripsySplashPreview = false; let _tripsySplashPreviewTimer = null; let _tripsySplashPreviewHidden = []; const TRIPSY_SPLASH_PREVIEW_MS = 3000;",
    fnSource('tripsyArmSplashPreview'), fnSource('tripsySplashVisible'), fnSource('tripsyMaybeShowSplashPreview'),
    fnSource('enterSplashPreview'), fnSource('tripsyEndSplashPreview'), fnSource('tripsyPreviewBecomeOffline'),
    'return { arm: tripsyArmSplashPreview, maybe: tripsyMaybeShowSplashPreview, end: tripsyEndSplashPreview, offline: tripsyPreviewBecomeOffline, preview: () => _tripsySplashPreview, hidden: () => _tripsySplashPreviewHidden, timer: () => _tripsySplashPreviewTimer };',
  ].join('\n');
  const obj = w.ctx;
  const fn = new Function('__ctx', `with (__ctx) { ${src} }`);
  w.api = fn(obj);
  return w;
};

(async () => {
  // ---- arming: a 3-second timer ----
  {
    const w = build();
    w.api.arm();
    assert(w.ctx.lastTimer && w.ctx.lastTimer.ms === 3000, 'THE ASK: the preview clock is 3 seconds');
    assert(/const TRIPSY_SPLASH_PREVIEW_MS = 3000;/.test(html), 'the constant is 3000ms');
  }
  // ---- fires: splash up, sign-in unfinished, a cache exists → cached Travel View ----
  {
    const w = build();
    await w.api.maybe();
    assert(w.api.preview() === true, 'THE ASK: with the splash still up past the clock, the preview is entered');
    assert(w.navigated.join(',') === 'travelview', 'it navigates to Travel View (which itself picks the current or next upcoming trip)');
    assert(w.splash.style.display === 'none' && w.appRoot.style.display === '', 'the splash hides and the app root shows');
    assert(w.ctx.tripsyDecryptedTrips && w.ctx.tripsyDecryptedTrips[0].key === 't1' && w.ctx.tripsyTripsAreOffline === true, 'the cached trips are what Travel View renders from');
    assert(w.ctx.appOfflineMode === true, 'navigate() is locked to the cache-safe views while sign-in runs');
    const hiddenViews = w.rail.filter(r => r.style.display === 'none').map(r => r.dataset.view).sort().join(',');
    assert(hiddenViews === 'home,tripsytrips,upload', 'rail items needing live data are hidden; Travel View stays');
    assert(w.api.hidden().length === 3 && !w.api.hidden().some(r => r.dataset && r.dataset.view === 'upload'), 'only the items the PREVIEW hid are remembered (an already-hidden item is not)');
    assert(w.ctx.driveData && Array.isArray(w.ctx.driveData.invoices), 'a minimal driveData is in place so Store readers do not throw');
    // ---- sign-in lands: the preview is dismantled, nothing blanked ----
    const was = w.api.end();
    assert(was === true, 'tripsyEndSplashPreview reports that a preview was showing');
    assert(w.api.preview() === false && w.ctx.appOfflineMode === false, 'the navigate() lock lifts');
    assert(w.ctx.tripsyDecryptedTrips === null && w.ctx.tripsyTripsAreOffline === false && w.ctx.tripsyOfflineCacheInfo === null, 'the cached trips are dropped so the LIVE file is fetched next');
    assert(w.rail.filter(r => r.style.display === '').length === 3 && w.rail.find(r => r.dataset.view === 'upload').style.display === 'none', 'the rail items the preview hid come back; the one hidden by someone else stays hidden');
    assert(w.navigated.length === 1, 'ending the preview paints nothing itself -- the landing navigate does');
    assert(w.api.end() === false, 'ending twice is a no-op');
  }
  // ---- does not fire: gate showing (a tap is needed) ----
  {
    const w = build({ splashShown: false });
    await w.api.maybe();
    assert(w.api.preview() === false && w.navigated.length === 0, 'no preview when the sign-in gate is what is showing');
  }
  // ---- does not fire: already signed in ----
  {
    const w = build({ signedIn: true });
    await w.api.maybe();
    assert(w.api.preview() === false, 'no preview once sign-in has finished');
  }
  // ---- does not fire: nothing cached ----
  {
    const w = build({ cache: null });
    await w.api.maybe();
    assert(w.api.preview() === false && w.splash.style.display === 'flex', 'with no cached trips the splash simply stays');
  }
  // ---- a connectivity failure converts the preview to offline mode in place ----
  {
    const w = build();
    await w.api.maybe();
    await w.api.offline();
    assert(w.ctx._tripsyOfflineEntered === true && w.api.preview() === false, 'the stand-in becomes the real offline view');
    assert(w.navigated.join(',') === 'travelview,travelview', 'Travel View re-renders so its strip re-words to Offline');
    assert(w.ctx.tripsyTripsAreOffline === true && w.ctx.tripsyDecryptedTrips !== null, 'the cached trips stay in place');
    assert(w.api.end() === false, 'ending a preview that already became offline changes nothing');
  }

  // ---- wiring: where the clock starts, and where the preview is torn down ----
  assert(/tripsyArmSplashPreview\(\);\n\(function waitForGoogleIdentity/.test(html), 'the clock starts at page load, right as the GIS poll begins');
  assert((html.match(/tripsyArmSplashPreview\(\); \/\/ a splash shown again gets the same 3s clock/g) || []).length === 2,
    'BOTH sign-in callbacks that swap back to the splash re-arm the clock');
  const csi = fnSource('completeSignIn');
  const endAt = csi.indexOf('const wasSplashPreview = tripsyEndSplashPreview();');
  assert(endAt > 0 && endAt > csi.indexOf('driveData = await loadDriveDataFile(driveFileId);'), 'the preview ends right after the real data file loads');
  assert(endAt < csi.indexOf("stage = 'setting up the menu'") && endAt < csi.indexOf('runBackgroundSyncs();') && endAt < csi.indexOf('renderHome()'),
    'and BEFORE the menu setup, Home, and the background syncs that could read or write the cached trips as live');
  assert(/else if \(wasSplashPreview\) \{ if \(!loadTravelViewPref\(\)\) await navigate\('home'\); \}\n\s*else await renderHome\(\);/.test(csi),
    'a Travel-View landing from the preview skips the Home build (no flash through); a Home landing after a preview goes through navigate() so currentView is home, not the preview\'s travelview');
  // ---- a preview render still loading when sign-in lands on Home must not paint over it ----
  const tv = fnSource('renderTravelView');
  assert(/const startedAsPreview = !!_tripsySplashPreview;/.test(tv) && (tv.match(/if \(tripsyPreviewPaintSuperseded\(startedAsPreview\)\) return;/g) || []).length === 2,
    'THE IPAD REPORT (2026-10-18): a Travel View render that began as the preview checks, after its loads and again before its final paint, that the preview has not since ended');
  const sup = new Function('_tripsySplashPreview', '_tripsyOfflineEntered', 'loadTravelViewPref', fnSource('tripsyPreviewPaintSuperseded') + '\nreturn tripsyPreviewPaintSuperseded;');
  assert(sup(false, false, () => false)(true) === true, 'preview ended, device lands on Home -> the late paint is abandoned');
  assert(sup(true, false, () => false)(true) === false, 'preview still showing -> paint');
  assert(sup(false, false, () => true)(true) === false, 'device lands on Travel View anyway -> paint');
  assert(sup(false, true, () => false)(true) === false, 'the preview became offline mode -> paint (it IS the view now)');
  assert(sup(false, false, () => false)(false) === false, 'a render that did not start as the preview is never abandoned');
  assert(/if \(_tripsySplashPreview\) \{ console\.log\(`completeSignIn watchdog: still \$\{stage\} after 12s -- the splash preview is already showing`\); return; \}/.test(csi),
    'the 12s watchdog paints nothing over a showing preview');
  assert(/if \(_tripsySplashPreview && !e\.reachedServer\) \{ tripsyPreviewBecomeOffline\(\); return; \}/.test(csi), 'a connectivity failure converts the preview to offline; a server-reached failure still shows the gate');
  assert(/\} else if \(_tripsySplashPreview\) \{[\s\S]*?tripsyPreviewBecomeOffline\(\);/.test(html), 'the GIS-never-loaded branch converts a showing preview instead of painting the gate');
  assert(/Showing your saved schedule while the app signs in…/.test(html) && /_tripsySplashPreview && !_tripsyOfflineEntered/.test(html), 'Travel View says it is a stand-in, not that the device is offline');
})();
