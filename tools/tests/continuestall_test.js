// "When I am reviewing new events added to the itinerary page and I press
// the continue button, nothing happens" (2026-09-28). The run had actually
// WORKED -- the live data showed the checked days' narratives saved at
// 05:23 -- but the handler then awaited a photo-prefetch build that hung
// (an IndexedDB open BLOCKED by another connection fires neither success
// nor error, so tripsyPlacePhotoDisplayUrl's disk-first read never
// settled), so the baseline was never recorded, the dialog never closed,
// and the Continue button sat disabled forever: every later press did
// literally nothing. Two layers of fix, both pinned here: the IDB open can
// no longer hang (blocked/stalled opens REJECT -- every consumer is
// fail-soft by design), and the Continue flow records its baseline BEFORE
// the photo prefetch, which is now failure-tolerant and time-boxed (photos
// self-heal on any open via tripsyBackgroundPhotoMaintenance).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- executed: openTripsyOfflineDb can no longer hang ----
(async () => {
  const src = extractFn('openTripsyOfflineDb');
  if (!src) { assert(false, 'could not extract openTripsyOfflineDb'); return; }
  const mk = () => {
    const state = { req: null };
    const fn = new Function('state', `
      var TRIPSY_OFFLINE_DB_NAME = 'db', TRIPSY_OFFLINE_STORE = 's1',
          TRIPSY_OFFLINE_APP_STORE = 's2', TRIPSY_OFFLINE_PHOTO_STORE = 's3';
      var window = { indexedDB: {} };
      var indexedDB = { open: () => (state.req = {}) };
      ${src}
      return openTripsyOfflineDb;
    `)(state);
    return { fn, state };
  };

  // BLOCKED rejects instead of hanging (the live failure mode: a pre-v3
  // connection in another tab/suspended WebView blocks the upgrade and
  // neither success nor error ever fires).
  {
    const { fn, state } = mk();
    const p = fn();
    let rejected = false;
    p.catch(() => { rejected = true; });
    state.req.onblocked();
    await new Promise(r => setImmediate(r));
    assert(rejected, 'a BLOCKED open rejects immediately -- the photo path falls back to the Drive download instead of hanging forever');
  }

  // Success resolves, and the connection closes itself when another context
  // needs a version upgrade -- so an old open tab can never be the blocker.
  {
    const { fn, state } = mk();
    const p = fn();
    let closed = false;
    state.req.result = { close: () => { closed = true; }, objectStoreNames: { contains: () => true } };
    state.req.onsuccess();
    const db = await p;
    assert(db === state.req.result, 'a normal open still resolves with the db');
    db.onversionchange();
    assert(closed, 'versionchange closes this connection so it cannot block another tab’s upgrade');
  }

  // Settled-once: a late error after success must not throw on a cleared state.
  {
    const { fn, state } = mk();
    const p = fn();
    state.req.result = { close: () => {}, objectStoreNames: { contains: () => true } };
    state.req.onsuccess();
    state.req.error = new Error('late');
    state.req.onerror();
    assert((await p) === state.req.result, 'a late error after success is ignored (settle-once guard)');
  }
})();

// A stalled open (no callback ever fires) rejects on a timeout rather than
// waiting forever -- asserted as a source pattern so the suite doesn't
// spend the real 4 seconds.
{
  const src = extractFn('openTripsyOfflineDb');
  assert(/setTimeout\([^)]*IndexedDB open timed out[^)]*\)|setTimeout\(\(\) => settle\(reject, new Error\('IndexedDB open timed out'\)\), 4000\)/.test(src),
    'a stalled open rejects after a bounded timeout');
}

// ---- source order: the Continue handler's critical path ----
{
  const src = extractFn('showTripsyItineraryChangesDialog');
  if (!src) { assert(false, 'could not extract showTripsyItineraryChangesDialog'); }
  else {
    const iBaseline = src.indexOf('tripsyRecordItineraryBaseline(trip)');
    const iPhotos = src.indexOf('Fetching photos for the new places');
    const iGenerate = src.indexOf('tripsyGenerateNarrativeSections');
    assert(iGenerate !== -1 && iBaseline !== -1 && iPhotos !== -1 && iGenerate < iBaseline && iBaseline < iPhotos,
      'THE ORDER FIX: generate -> record baseline -> THEN photo prefetch, so a photo-phase failure can never strand a completed (and paid-for) generation unacknowledged');
    assert(/Promise\.race\(\[\s*buildTripsyPrintHtml\(trip\.key\),\s*new Promise\(resolve => setTimeout\(resolve, 45000\)\),?\s*\]\)/.test(src),
      'the photo prefetch is time-boxed -- past the cap the flow moves on and the build finishes behind it');
    const prefetch = src.slice(iPhotos);
    assert(/catch \(e\) \{\s*console\.error\('Photo prefetch failed/.test(prefetch),
      'a photo-prefetch failure is logged and the flow continues (photos self-heal on open)');
  }
}

// Follow-up, same day: "I got an error message when I was trying to update
// the itinerary" -- the catch said only "see console for details", which is
// useless on the iPad (no console). The status line now carries the real
// error text, and says a retry is one press away.
{
  const src = extractFn('showTripsyItineraryChangesDialog');
  assert(/const detail = String\(\(e && \(e\.message \|\| e\)\) \|\| 'unknown error'\)\.slice\(0, 300\);/.test(src)
    && /Could not generate' : 'Could not save'\}: \$\{detail\}/.test(src)
    && !/see console for details/.test(src),
    'a generation failure names its REAL reason in the dialog (bounded), not a console the iPad does not have');
}
