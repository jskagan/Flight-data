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
assert(/if \(generateFirst\) \{/.test(show) && /await tripsyPartialEnsureNarratives\(tripKey, keys\);/.test(show),
  'THE ASK: full mode generates the missing narratives/photos FIRST, then shows the document');
assert(/Could not generate some narratives — showing what exists/.test(show),
  'a failed generation still shows the document rather than eating the click');
const ensure = extractFn('tripsyPartialEnsureNarratives');
assert(/keys\.has\('overview'\) && !cache\[`\$\{tripKey\}::intro`\]/.test(ensure)
  && /keys\.has\(`day:\$\{k\}`\) && !cache\[`\$\{tripKey\}::day::\$\{k\}`\]/.test(ensure),
  'only MISSING included sections generate -- an already-written full itinerary is simply reused (never rewritten)');
assert(/tripsyGenerateNarrativeSections\(tripKey, effectiveTrip, dayKeys, byDay, summaryByDay, \{/.test(ensure)
  && /summaryDayKeys,/.test(ensure),
  'generation goes through the ONE shared narrative machinery, summary rows scoped to the partial\'s days -- the full itinerary gains these sections too');
assert(/_tripsyAllowPhotoFetch = true;/.test(ensure) && /buildTripsyPrintHtml\(tripKey, \{ partialKeys: keys \}\)/.test(ensure),
  'THE ASK: photos pre-fetch through the same FILTERED build the view renders, so only included places\' photos are fetched');
assert(!/tripsyRecordItineraryBaseline/.test(ensure),
  'deliberately no baseline record -- a side document must not acknowledge event changes the owner has not reviewed');
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

// ---- executed: what full-mode generation actually asks for ----
(async () => {
  const src = extractFn('tripsyPartialEnsureNarratives').replace(/^async function /, 'var tripsyPartialEnsureNarratives = async function ');
  eval(extractFn('tripsyPartialBaseEventId').replace(/^function /, 'var tripsyPartialBaseEventId = function '));
  eval(extractFn('tripsySummaryRowKey').replace(/^function /, 'var tripsySummaryRowKey = function '));
  eval(extractFn('tripsyFilterPrintDayDataForPartial').replace(/^function /, 'var tripsyFilterPrintDayDataForPartial = function '));

  const run = async (keys, cache) => {
    const calls = { gen: null, photo: 0 };
    const dayData = {
      effectiveTrip: { name: 'T' },
      dayKeys: ['d1', 'd2'],
      byDay: new Map(),
      summaryByDay: new Map([
        ['d1', [{ dayKey: 'd1', ev: { id: 'a1', tripsyRaw: { resource: 'activity' } } }]],
        ['d2', [{ dayKey: 'd2', ev: { id: 'b1', tripsyRaw: { resource: 'activity' } } }]],
      ]),
    };
    const f = new Function('tripKey', 'keys',
      'tripsyDecryptedTrips', 'buildTripsyPrintDayData', 'Store', 'tripsyFilterPrintDayDataForPartial',
      'tripsySummaryRowKey', 'tripsySummaryRowWantsBlurb', 'tripsyGenerateNarrativeSections', 'buildTripsyPrintHtml', 'console',
      src + '\nreturn tripsyPartialEnsureNarratives(tripKey, keys);');
    await f('t1', keys,
      [{ key: 't1' }], async () => dayData,
      { getTripsyNarrativeCache: async () => cache },
      tripsyFilterPrintDayDataForPartial, tripsySummaryRowKey, () => true,
      async (tk, et, dk, bd, sbd, opts) => { calls.gen = opts; },
      async () => { calls.photo++; return ''; },
      console);
    return calls;
  };

  // Nothing generated yet, everything included: intro + both days + both days' summary rows.
  let calls = await run(new Set(['overview', 'day:d1', 'day:d2', 'event:ev:a1', 'event:ev:b1']), {});
  assert(calls.gen && calls.gen.includeIntro === true
    && calls.gen.dayKeysToGenerate.join(',') === 'd1,d2'
    && calls.gen.summaryDayKeys.join(',') === 'd1,d2' && calls.gen.includeSummary === true,
    'THE ASK: full mode generates narratives for every included section that lacks one');
  assert(calls.photo === 1, 'and pre-fetches photos through the filtered build');

  // Full itinerary already prepared: nothing regenerates, photos still warm the cache.
  const fullCache = {
    't1::intro': { content: {} },
    't1::day::d1': { content: {} }, 't1::day::d2': { content: {} },
    't1::summary': { content: { rows: [{ row_key: 'ev:a1', blurb: 'x' }, { row_key: 'ev:b1', blurb: 'y' }] } },
  };
  calls = await run(new Set(['overview', 'day:d1', 'day:d2', 'event:ev:a1', 'event:ev:b1']), fullCache);
  assert(calls.gen === null,
    'an already-generated full itinerary is copied, never re-generated -- zero Claude calls');

  // Only day 2's event included, overview excluded: generation is scoped to it.
  calls = await run(new Set(['day:d2', 'event:ev:b1']), { 't1::intro': { content: {} } });
  assert(calls.gen && calls.gen.includeIntro === false
    && calls.gen.dayKeysToGenerate.join(',') === 'd2'
    && calls.gen.summaryDayKeys.join(',') === 'd2',
    'excluded sections (and the excluded day) are never generated -- the partial only pays for what it shows');
})();
