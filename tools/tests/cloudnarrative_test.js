// "I do not want to keep the app open in the foreground in order to generate
// a partial itinerary" (2026-09-27). The partial itinerary's full-mode
// narrative generation is minutes of Claude calls, and backgrounding the iPad
// app kills them -- so the work moved to the CLOUD ROUTINE via the app's
// established relay pattern: tripsyPartialEnsureNarratives queues a request
// in driveData.tripsyNarrativeRequests carrying the EXACT prompts the in-app
// generators send (partialmode_test covers that side), the routine answers by
// writing a tripsy-narrative-results.json relay, and the app drains it into
// the one shared narrative cache exactly as tripsyGenerateNarrativeSections
// would have filed it. This suite covers the drain/filing side.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
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

// ---- the relay file and its drain ----
assert(/const TRIPSY_NARRATIVE_RESULTS_FILENAME = 'tripsy-narrative-results\.json';/.test(html),
  'the routine answers through its own relay file, tripsy-narrative-results.json');
const drain = extractFn('drainTripsyNarrativeResults');
assert(/drainTripsyRelayFiles\(TRIPSY_NARRATIVE_RESULTS_FILENAME, relay => applyTripsyNarrativeResults\(relay\.results \|\| \[\]\)\)/.test(drain),
  'drained through the ONE shared relay machinery (list -> parse -> apply -> delete) every other relay uses');
assert(/if \(!isOwner\) return;/.test(drain), 'owner-only, like every other drain');

// ---- wired into the one sync pass, AFTER trips load ----
const sync = extractFn('syncTripsyRelays');
const drainAt = sync.indexOf('drainTripsyNarrativeResults()');
assert(drainAt > -1 && sync.indexOf('ensureTripsyDecrypted()') < drainAt,
  'the narrative drain runs AFTER trips load -- filing an answer ends in tripsyRecordItineraryBaseline, which needs the real trip');
assert(drainAt < sync.indexOf('updateTripsyStatusBadge()'),
  'and before the badge refresh, so a drained answer clears its yellow row in the same pass');

// ---- the Store queue ----
assert(/listTripsyNarrativeRequests\(\) \{\s*\n\s*return driveData\.tripsyNarrativeRequests \|\| \[\];/.test(html),
  'requests live in driveData.tripsyNarrativeRequests');
assert(/driveData\.tripsyNarrativeRequests\.filter\(r => r\.tripKey !== request\.tripKey\);/.test(html),
  'one request per trip, replaced outright -- a newer selection supersedes an older pending ask');
// The prune rule (a request embeds the trip data inside its prompts, so a
// dead one is real weight on every whole-file save).
const prune = extractFn('pruneDriveDataInMemory');
assert(/driveData\.tripsyNarrativeRequests = driveData\.tripsyNarrativeRequests\.filter\(r =>\s*\n\s*r && keys\.has\(r\.tripKey\) && \(r\.requestedAt \|\| ''\) >= staleCutoff\);/.test(prune),
  'the prune drops a request whose trip is gone or that six scheduled runs have ignored (48h)');

// ---- the status badge knows about the wait ----
const statusFn = extractFn('computeTripsyStatus');
assert(/Store\.listTripsyNarrativeRequests\(\)\.length/.test(statusFn)
  && /being written in the background/.test(statusFn),
  'a queued request shows as a yellow badge row, so the owner can see the wait (and Run Parse Now sits right below it)');

// ---- executed: the filing itself ----
(async () => {
  const src = extractFn('applyTripsyNarrativeResults').replace(/^async function /, 'var applyTripsyNarrativeResults = async function ');

  const mkRequest = () => ({
    id: 'r1', tripKey: 't1', requestedAt: '2026-09-27T00:00:00Z',
    includeIntro: true,
    dayKeysToGenerate: ['d1', 'd2'],
    summaryRowKeys: ['ev:b1'],
    allRowKeys: ['ev:a1', 'ev:b1'],
    introFingerprint: 'FP-INTRO',
    dayFingerprints: { d1: 'FP-D1', d2: 'FP-D2' },
    summaryFingerprint: 'FP-SUMM',
  });
  const run = async (results, opts = {}) => {
    const calls = { saved: [], removed: [], baselines: [], toasts: 0, reshown: [] };
    const requests = opts.requests || [mkRequest()];
    const f = new Function('results', 'tripsyFixDoubleEscapedUnicodeDeep', 'Store', 'tripsyDecryptedTrips',
      'tripsyRecordItineraryBaseline', 'toast', 'document', 'showTripsyPartialItinerary', 'console',
      src + '\nreturn applyTripsyNarrativeResults(results);');
    await f(results, x => x,
      {
        listTripsyNarrativeRequests: () => requests,
        getTripsyNarrativeCache: async () => (opts.cache || {}),
        saveTripsyNarrativeSections: async sections => { calls.saved.push(sections); return opts.saveOk !== false; },
        removeTripsyNarrativeRequest: async id => { calls.removed.push(id); return true; },
      },
      [{ key: 't1', name: 'Trip' }],
      async trip => { calls.baselines.push(trip.key); },
      () => { calls.toasts++; },
      { getElementById: () => (opts.overlay || null) },
      tripKey => { calls.reshown.push(tripKey); },
      console);
    return calls;
  };

  const goodResult = {
    requestId: 'r1', tripKey: 't1',
    trip_intro: 'INTRO TEXT',
    days: [
      { day_key: 'd1', title: 'T1', narrative: 'N1', place_blurbs: [{ place_name: 'P', blurb: 'B' }] },
      { day_key: 'd2', title: 'T2', narrative: 'N2', place_blurbs: [] },
      { day_key: 'd9', title: 'STRAY', narrative: 'never asked for', place_blurbs: [] },
    ],
    summary_rows: [{ row_key: 'ev:b1', blurb: 'fresh' }, { row_key: 'ev:zz', blurb: 'stray' }],
  };
  const cache = { 't1::summary': { content: { rows: [{ row_key: 'ev:a1', blurb: 'kept' }, { row_key: 'ev:b1', blurb: 'old' }, { row_key: 'ev:dead', blurb: 'gone-event' }] } } };

  let calls = await run([goodResult], { cache });
  assert(calls.saved.length === 1, 'one answer files as ONE narrative-cache save');
  const s = calls.saved[0];
  assert(s['t1::intro'] && s['t1::intro'].content.trip_intro === 'INTRO TEXT' && s['t1::intro'].fingerprint === 'FP-INTRO',
    'the intro lands under the trip\'s ::intro key, stamped with the QUEUE-TIME fingerprint');
  assert(s['t1::day::d1'] && s['t1::day::d1'].content.narrative === 'N1' && s['t1::day::d1'].fingerprint === 'FP-D1'
    && s['t1::day::d2'] && s['t1::day::d2'].fingerprint === 'FP-D2',
    'each requested day files exactly as tripsyGenerateNarrativeSections would have');
  assert(!s['t1::day::d9'], 'a day the request never asked for is ignored, never filed');
  const rows = s['t1::summary'].content.rows;
  assert(rows.length === 2 && rows[0].blurb === 'kept' && rows[1].blurb === 'fresh'
    && !rows.some(r => r.row_key === 'ev:dead') && !rows.some(r => r.row_key === 'ev:zz')
    && s['t1::summary'].fingerprint === 'FP-SUMM',
    'summary rows get the exact scoped merge: cached rows kept, rewritten row replaced, dead-event and never-asked rows dropped');
  assert(calls.baselines.join(',') === 't1' && calls.removed.join(',') === 'r1' && calls.toasts === 1,
    'then the same baseline acknowledge step every generate path ends with, the request is removed, and the owner is told');
  assert(calls.reshown.length === 0, 'no partial overlay open -> no repaint attempted');

  // Overlay open on this very trip: the fresh text repaints it in place.
  calls = await run([goodResult], { cache, overlay: { style: { display: 'flex' }, dataset: { tripKey: 't1' } } });
  assert(calls.reshown.join(',') === 't1',
    'a partial overlay open on this trip repaints itself when the answer lands -- the banner resolves without reopening');
  calls = await run([goodResult], { cache, overlay: { style: { display: 'flex' }, dataset: { tripKey: 'OTHER' } } });
  assert(calls.reshown.length === 0, 'an overlay showing a different trip is left alone');

  // An answer to a request that no longer exists (superseded/already drained)
  // writes nothing -- there is nothing to file it under.
  calls = await run([{ ...goodResult, requestId: 'ghost' }]);
  assert(calls.saved.length === 0 && calls.removed.length === 0 && calls.baselines.length === 0,
    'an unmatched answer is skipped outright (the relay file is still deleted by the shared drain)');

  // A failed cache save must THROW so drainTripsyRelayFiles keeps the relay
  // file for the next pass -- and must not remove the request either.
  let threw = false;
  try { await run([goodResult], { cache, saveOk: false }); } catch (e) { threw = true; }
  assert(threw, 'a failed save throws, keeping the relay file (and the request) for the next drain');
})();
