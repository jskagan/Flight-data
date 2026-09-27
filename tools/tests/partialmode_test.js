// "After a user has selected the View Partial Itinerary button, ask the user
// if he would like to see a summary or a full itinerary. If ... summary,
// generate just the summary itinerary. If ... full itinerary, generate
// narratives and photos for all of the events in that itinerary and then
// show it. In both cases, save the itinerary with the title Partial
// Itinerary and then the start and end date of that itinerary. And include
// in the itinerary drop down menu an option for show and then the name of
// the itinerary that is generated." (2026-09-27)
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

// ---- the mode question ----
const dlg = extractFn('tripsyPartialModeDialog');
assert(/data-mode="summary"/.test(dlg) && /data-mode="full"/.test(dlg),
  'THE ASK: after View Partial Itinerary, the user chooses Summary or Full Itinerary');
assert(/if \(e\.target === overlay\) done\(null\)/.test(dlg),
  'dismissing decides nothing -- the picker panel stays as it was');
const wire = extractFn('wireTripsyPartialPanel');
assert(/const mode = await tripsyPartialModeDialog\(\);\s*\n\s*if \(!mode\) return;/.test(wire),
  'the question comes BEFORE anything saves or closes, so a dismissed dialog costs nothing');

// ---- the saved record: title + span + mode ----
assert(/const title = `Partial Itinerary \$\{formatTripDateRange\(startDayKey, endDayKey\)\}`/.test(wire),
  'THE ASK: saved with the title "Partial Itinerary <start> – <end>"');
assert(/const evDays = checked\.map\(x => x\.dataset\.partialDay\)\.filter\(Boolean\)\.sort\(\);/.test(wire),
  'the span comes from the days of the INCLUDED events, not the whole trip');
assert(/renderTripsyEventsList\(\)/.test(wire),
  'a successful save re-renders My Trips so the menu\'s Show item appears right away');

// ---- summary vs full rendering, and full-mode generation ----
const show = extractFn('showTripsyPartialItinerary');
assert(/summaryOnly: mode === 'summary'/.test(show),
  'THE ASK: summary mode renders just the summary itinerary (the Part-1-only build), full renders the whole document');
assert(/mode = \(saved && saved\.mode\) \|\| 'full';/.test(show),
  'a record saved before modes existed reads as full -- exactly the pre-feature behavior');
assert(/const ownerFull = mode === 'full' && isOwner;/.test(show)
  && /generation = await tripsyPartialEnsureNarratives\(tripKey, keys, progress\);/.test(show),
  'THE ASK: full mode checks for missing narratives on EVERY owner open (so an unanswered creation-time ask self-heals), then shows the document');
assert(/Generation incomplete', yes: 'OK', no: null/.test(show),
  'a failed hand-off shows a PERSISTENT dialog (a toast fired while the iPad app is backgrounded is never seen) and still renders what exists');
assert(/generation\.status === 'queued' \|\| generation\.status === 'pending'/.test(show)
  && /being created in the background — you can close the app/.test(show),
  'THE 2026-09-27 ASK: missing narratives are written in the BACKGROUND -- the document renders now, with a banner saying the app can be closed');
assert(/content\.prepend\(banner\)/.test(show) && show.indexOf('content.prepend(banner)') < show.indexOf('getOrCreateTripsyPrintRoot().innerHTML = html'),
  'the banner lives in the overlay only -- the print root gets the bare document, so Save as PDF never carries an app status line');
assert(/if \(ownerFull\) _tripsyAllowPhotoFetch = true;/.test(show)
  && /finally \{\s*\n\s*if \(ownerFull\) _tripsyAllowPhotoFetch = false;/.test(show),
  'THE ASK: the owner\'s full render may fetch photos itself, so missing photos self-heal on open (cached ones are free)');
const ensure = extractFn('tripsyPartialEnsureNarratives');
assert(/keys\.has\('overview'\) && !cache\[`\$\{tripKey\}::intro`\]/.test(ensure)
  && /keys\.has\(`day:\$\{k\}`\) && !cache\[`\$\{tripKey\}::day::\$\{k\}`\]/.test(ensure),
  'only MISSING included sections generate -- an already-written full itinerary is simply reused (never rewritten)');
assert(!/tripsyGenerateNarrativeSections\(/.test(ensure)
  && /Store\.queueTripsyNarrativeRequest\(request\)/.test(ensure),
  'THE 2026-09-27 ASK: nothing generates in the foreground anymore -- missing sections are QUEUED as a cloud request instead');
assert(/narrativePrompt: \(includeIntro \|\| dayKeysToGenerate\.length\)\s*\n\s*\? tripsyNarrativePromptText\(effectiveTrip, dayPromptDataAll, \{ includeIntro, dayKeysToGenerate, existingPlaceBlurbs \}\)/.test(ensure)
  && /summaryPrompt: targetItems\.length \? tripsySummaryBlurbsPromptText\(effectiveTrip, targetItems\.map\(tripsySummaryRowPromptData\)\) : ''/.test(ensure),
  '"exact same rules and procedures": the request carries the EXACT prompts the in-app generators send, built by the very same prompt builders they call');
assert(/runTripsyRefreshViaWorker\(null\)/.test(ensure),
  'queueing also fires the cloud routine on demand, so the wait is minutes, not the next scheduled run');
// The prompt builders really are the generators' own -- each generator's
// message content IS a call to its builder, so the two paths cannot drift.
assert(/content: tripsyNarrativePromptText\(effectiveTrip, dayPromptDataList, \{ includeIntro, dayKeysToGenerate, existingPlaceBlurbs \}\),/.test(html)
  && /content: tripsySummaryBlurbsPromptText\(effectiveTrip, rowPromptDataList\),/.test(html),
  'the in-app generators send those same builders\' output as their message content -- one source of truth for the prompt text');
// The Save as PDF button honors the mode too.
{
  const pdf = extractFn('getOrCreateTripsyPartialOverlay');
  assert(/summaryOnly: overlay\._partialMode === 'summary'/.test(pdf),
    'Save as PDF prints the same mode the screen shows');
}

// ---- the menu's Show item ----
assert(/data-tripsy-show-partial data-key="\$\{esc\(trip\.key\)\}"`, '👁️', `Show \$\{savedPartial\.title\}`/.test(html),
  'THE ASK: the 🧭 menu offers "Show <the saved partial\'s name>"');
assert(/savedPartial && savedPartial\.title\s*\n\s*\? menuListButtonHtml/.test(html),
  'the item renders only once a titled partial exists (pre-title records just don\'t list until re-created)');
{
  const wireStart = html.indexOf('container.querySelectorAll("[data-tripsy-show-partial]")');
  const wireShow = html.slice(wireStart, wireStart + 600);
  assert(wireStart > -1 && /await showTripsyPartialItinerary\(btn\.dataset\.key\);/.test(wireShow),
    'Show reopens the saved partial from its stored selection + mode, no arguments needed');
}

// ---- executed: what full-mode "generation" actually queues for the cloud ----
(async () => {
  const src = extractFn('tripsyPartialEnsureNarratives').replace(/^async function /, 'var tripsyPartialEnsureNarratives = async function ');
  eval(extractFn('tripsyPartialBaseEventId').replace(/^function /, 'var tripsyPartialBaseEventId = function '));
  eval(extractFn('tripsySummaryRowKey').replace(/^function /, 'var tripsySummaryRowKey = function '));
  eval(extractFn('tripsyFilterPrintDayDataForPartial').replace(/^function /, 'var tripsyFilterPrintDayDataForPartial = function '));

  const run = async (keys, cache, pendingRequests = []) => {
    const calls = { queued: [], fires: 0, stages: [] };
    const dayData = {
      effectiveTrip: { name: 'T', location: 'X', start: 'd1', end: 'd2' },
      dayKeys: ['d1', 'd2'],
      byDay: new Map(),
      summaryByDay: new Map([
        ['d1', [{ dayKey: 'd1', ev: { id: 'a1', tripsyRaw: { resource: 'activity' } } }]],
        ['d2', [{ dayKey: 'd2', ev: { id: 'b1', tripsyRaw: { resource: 'activity' } } }]],
      ]),
    };
    const f = new Function('tripKey', 'keys', 'onStageArg',
      'tripsyDecryptedTrips', 'buildTripsyPrintDayData', 'Store', 'tripsyFilterPrintDayDataForPartial',
      'tripsySummaryRowKey', 'tripsySummaryRowWantsBlurb', 'tripsyNarrativeDayPromptData', 'tripsyContentFingerprint',
      'formatTripDateRange', 'tripsyNarrativePromptText', 'tripsySummaryBlurbsPromptText', 'tripsySummaryRowPromptData',
      'runTripsyRefreshViaWorker', 'console',
      src + '\nreturn tripsyPartialEnsureNarratives(tripKey, keys, onStageArg);');
    const result = await f('t1', keys, s => calls.stages.push(s),
      [{ key: 't1' }], async () => dayData,
      {
        getTripsyNarrativeCache: async () => cache,
        listTripsyNarrativeRequests: () => pendingRequests,
        queueTripsyNarrativeRequest: async r => { calls.queued.push(r); return true; },
      },
      tripsyFilterPrintDayDataForPartial, tripsySummaryRowKey, () => true,
      (k, evs) => ({ day_key: k }), () => 'fp', () => 'range',
      (et, days, opts) => `NARR[intro=${opts.includeIntro}|days=${opts.dayKeysToGenerate.join('+')}]`,
      (et, rows) => `SUMM[${rows.length} rows]`, item => ({ key: tripsySummaryRowKey(item) }),
      () => { calls.fires++; }, console);
    calls.result = result;
    return calls;
  };

  // Nothing generated yet, everything included: ONE queued request carrying
  // the intro + both days + both days' summary rows, and an on-demand fire.
  let calls = await run(new Set(['overview', 'day:d1', 'day:d2', 'event:ev:a1', 'event:ev:b1']), {});
  assert(calls.result.status === 'queued' && calls.queued.length === 1 && calls.fires === 1,
    'THE 2026-09-27 ASK: missing sections queue ONE cloud request and fire the routine -- nothing generates in the foreground');
  const req = calls.queued[0];
  assert(req.tripKey === 't1' && req.includeIntro === true && req.dayKeysToGenerate.join(',') === 'd1,d2'
    && req.narrativePrompt === 'NARR[intro=true|days=d1+d2]' && req.summaryPrompt === 'SUMM[2 rows]',
    'the request carries the exact generator prompts for every missing included section');
  assert(req.summaryRowKeys.join(',') === 'ev:a1,ev:b1' && req.allRowKeys.join(',') === 'ev:a1,ev:b1'
    && req.introFingerprint === 'fp' && req.dayFingerprints.d1 === 'fp' && req.summaryFingerprint === 'fp',
    'plus the queue-time fingerprints and row-key sets the drain files the answer with');

  // Full itinerary already prepared: nothing queues, nothing fires.
  const fullCache = {
    't1::intro': { content: {} },
    't1::day::d1': { content: {} }, 't1::day::d2': { content: {} },
    't1::summary': { content: { rows: [{ row_key: 'ev:a1', blurb: 'x' }, { row_key: 'ev:b1', blurb: 'y' }] } },
  };
  calls = await run(new Set(['overview', 'day:d1', 'day:d2', 'event:ev:a1', 'event:ev:b1']), fullCache);
  assert(calls.result.status === 'none' && calls.queued.length === 0 && calls.fires === 0,
    'an already-generated full itinerary is copied, never re-asked -- no request, no fire (Show stays instant)');

  // Only day 2's event included, overview excluded: the ask is scoped to it.
  calls = await run(new Set(['day:d2', 'event:ev:b1']), { 't1::intro': { content: {} } });
  assert(calls.queued.length === 1
    && calls.queued[0].includeIntro === false && calls.queued[0].dayKeysToGenerate.join(',') === 'd2'
    && calls.queued[0].narrativePrompt === 'NARR[intro=false|days=d2]' && calls.queued[0].summaryRowKeys.join(',') === 'ev:b1',
    'excluded sections (and the excluded day) are never asked for -- the partial only pays for what it shows');

  // A recent request is still pending: don't re-queue over it (that would
  // re-date it), don't re-fire; report pending so the banner shows.
  const recent = { id: 'r1', tripKey: 't1', requestedAt: new Date().toISOString() };
  calls = await run(new Set(['overview', 'day:d1']), {}, [recent]);
  assert(calls.result.status === 'pending' && calls.queued.length === 0 && calls.fires === 0,
    'a still-fresh pending request is left alone -- reopening the partial does not spam the queue or the worker');

  // A stale pending request (the fire evidently never landed): re-fire the
  // worker, but STILL don't replace the request -- the scheduled runs answer it.
  const stale = { id: 'r2', tripKey: 't1', requestedAt: new Date(Date.now() - 30 * 60000).toISOString() };
  calls = await run(new Set(['overview', 'day:d1']), {}, [stale]);
  assert(calls.result.status === 'pending' && calls.queued.length === 0 && calls.fires === 1,
    'a stale pending request re-fires the worker (maybe the first fire failed) without re-queueing');
})();
