
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// ---- stubs: the pieces the summary branch leans on ----
let askedRows = null, calls = 0;
const generateTripsySummaryBlurbs = async (trip, rows) => {
  calls++; askedRows = rows;
  return { rows: rows.map(r => ({ row_key: r.key, blurb: 'NEW ' + r.key })) };
};
const tripsySummaryRowKey = it => it.key;
const tripsySummaryRowWantsBlurb = it => it.wants !== false;
const tripsySummaryRowPromptData = it => ({ key: it.key });
const tripsyContentFingerprint = list => 'fp:' + list.map(r => r.key).join(',');
let cache = {};
const Store = {
  getTripsyNarrativeCache: async () => cache,
  saveTripsyNarrativeSections: async secs => { Object.assign(cache, secs); return true; },
};
// the day branch is out of scope here
const tripsyNarrativeDayPromptData = () => ({});
const generateTripsyItineraryNarrative = async () => ({ days: [] });

async function tripsyGenerateNarrativeSections(tripKey, effectiveTrip, dayKeys, byDay, summaryByDay, { includeIntro, includeSummary, dayKeysToGenerate, summaryDayKeys = null }) {
  const sectionsToSave = {};

  if (includeSummary) {
    const rowItemsFor = keys => keys.flatMap(dayKey => summaryByDay.get(dayKey) || [])
      .filter(item => tripsySummaryRowKey(item) && tripsySummaryRowWantsBlurb(item));
    const allRowItems = rowItemsFor(dayKeys);
    // `summaryDayKeys` scopes the rewrite to the days actually being regenerated. Without
    // it every regeneration rewrote EVERY summary row on the trip -- 62 of them on a
    // 17-day trip -- which was the dominant cost of the changes dialog and cost exactly
    // the same whether one event changed or twenty. null keeps the whole-trip behaviour,
    // which is what a full generate wants.
    const scoped = Array.isArray(summaryDayKeys);
    const targetItems = scoped ? rowItemsFor(summaryDayKeys) : allRowItems;
    // Scoped with nothing to rewrite: skip the call rather than spend one on an empty set.
    if (targetItems.length || !scoped) {
      const summaryResult = await generateTripsySummaryBlurbs(effectiveTrip, targetItems.map(tripsySummaryRowPromptData));
      let rows = summaryResult.rows || [];
      if (scoped) {
        // Merge onto what's cached: keep every row NOT rewritten here, drop the ones that
        // were, then append the new text. Rows whose event no longer exists anywhere on
        // the trip are dropped as well -- a whole-trip rewrite used to clear those as a
        // side effect, and without this they would linger forever once scoping is on.
        const liveKeys = new Set(allRowItems.map(tripsySummaryRowKey));
        const replaced = new Set(targetItems.map(tripsySummaryRowKey));
        const existingCache = await Store.getTripsyNarrativeCache();
        const priorEntry = existingCache[`${tripKey}::summary`];
        const prior = (priorEntry && priorEntry.content && priorEntry.content.rows) || [];
        rows = prior.filter(r => liveKeys.has(r.row_key) && !replaced.has(r.row_key)).concat(rows);
      }
      sectionsToSave[`${tripKey}::summary`] = {
        content: { rows },
        // Over the FULL current row set, so the stored fingerprint describes what is
        // stored rather than just the slice this run happened to rewrite.
        fingerprint: tripsyContentFingerprint(allRowItems.map(tripsySummaryRowPromptData)),
        generatedAt: new Date().toISOString(),
      };
    }
  }

  if (includeIntro || dayKeysToGenerate.length) {
    const dayPromptDataAll = dayKeys.map(dayKey => tripsyNarrativeDayPromptData(dayKey, byDay.get(dayKey) || []));
    // Days NOT being (re)generated in this call may already have cached
    // place_blurbs from an earlier, separate generation -- the model has
    // no memory of that text (each API call is stateless), so without this
    // it could easily write the same description for a recurring place
    // (e.g. a venue visited on both Day 2 and Day 5) without knowing Day
    // 2's version already exists. Passing that already-written text in
    // lets the prompt explicitly tell it to differentiate instead.
    const existingCache = await Store.getTripsyNarrativeCache();
    let existingPlaceBlurbs = dayKeys
      .filter(dayKey => !dayKeysToGenerate.includes(dayKey))
      .map(dayKey => existingCache[`${tripKey}::day::${dayKey}`])
      .filter(Boolean)
      .flatMap(entry => (entry.content.place_blurbs || []).map(pb => ({ place_name: pb.place_name, blurb: pb.blurb })));
    // Days generate in BATCHES, not one call for everything. The response is
    // capped at max_tokens 4096 -- roughly a handful of days' titles +
    // narratives + place blurbs -- and asking for more truncates the JSON
    // mid-stream, failing the WHOLE run with nothing saved (seen live
    // 2026-09-27: an 11-day partial-itinerary generation died with "JSON
    // Parse error: Unexpected EOF"; a many-day first-time Create had the
    // same latent bug). Each batch's just-written place blurbs join the
    // don't-repeat context for the batches after it, exactly as cached days'
    // blurbs already do -- so a place visited in batch 1 and batch 3 still
    // gets two different write-ups. The intro rides the first batch only.
    const TRIPSY_NARRATIVE_DAY_BATCH = 4;
    const dayBatches = [];
    for (let i = 0; i < dayKeysToGenerate.length; i += TRIPSY_NARRATIVE_DAY_BATCH) {
      dayBatches.push(dayKeysToGenerate.slice(i, i + TRIPSY_NARRATIVE_DAY_BATCH));
    }
    if (!dayBatches.length) dayBatches.push([]); // intro-only call
    let tripIntro = '';
    const resultDaysByKey = new Map();
    for (let b = 0; b < dayBatches.length; b++) {
      const result = await generateTripsyItineraryNarrative(effectiveTrip, dayPromptDataAll, {
        includeIntro: includeIntro && b === 0,
        dayKeysToGenerate: dayBatches[b],
        existingPlaceBlurbs,
      });
      if (includeIntro && b === 0) tripIntro = result.trip_intro || '';
      for (const rd of (result.days || [])) resultDaysByKey.set(rd.day_key, rd);
      existingPlaceBlurbs = existingPlaceBlurbs.concat(
        (result.days || []).flatMap(rd => (rd.place_blurbs || []).map(pb => ({ place_name: pb.place_name, blurb: pb.blurb }))));
    }
    if (includeIntro) {
      const introFingerprintData = { name: effectiveTrip.name, location: effectiveTrip.location, dateRange: formatTripDateRange(effectiveTrip.start, effectiveTrip.end) };
      sectionsToSave[`${tripKey}::intro`] = { content: { trip_intro: tripIntro }, fingerprint: tripsyContentFingerprint(introFingerprintData), generatedAt: new Date().toISOString() };
    }
    for (const dayKey of dayKeysToGenerate) {
      const rd = resultDaysByKey.get(dayKey);
      if (!rd) continue;
      const promptData = tripsyNarrativeDayPromptData(dayKey, byDay.get(dayKey) || []);
      sectionsToSave[`${tripKey}::day::${dayKey}`] = {
        content: { title: rd.title, narrative: rd.narrative, place_blurbs: rd.place_blurbs || [] },
        fingerprint: tripsyContentFingerprint(promptData),
        generatedAt: new Date().toISOString(),
      };
    }
  }

  const ok = await Store.saveTripsyNarrativeSections(sectionsToSave);
  if (!ok) throw new Error('Failed to save narrative to storage');
}

const dayKeys = ['d1', 'd2', 'd3'];
const mk = () => new Map([
  ['d1', [{ key: 'a' }, { key: 'b' }]],
  ['d2', [{ key: 'c' }]],
  ['d3', [{ key: 'd' }, { key: 'e', wants: false }]],  // e never wants a blurb
]);
const trip = { name: 'T', location: 'L', start: '', end: '' };
const rowsNow = () => (cache['K::summary'].content.rows || []).map(r => r.row_key + '=' + r.blurb).sort();

// ---------- scoped: only the named day's rows are sent ----------
cache = { 'K::summary': { content: { rows: [
  { row_key: 'a', blurb: 'OLD a' }, { row_key: 'b', blurb: 'OLD b' },
  { row_key: 'c', blurb: 'OLD c' }, { row_key: 'd', blurb: 'OLD d' },
] } } };
calls = 0;
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d2'], summaryDayKeys: ['d2'] });
assert(calls === 1, 'one summary call');
assert(JSON.stringify(askedRows) === '[{"key":"c"}]', 'ONLY the changed day\'s row is sent -> ' + JSON.stringify(askedRows));
assert(JSON.stringify(rowsNow()) === '["a=OLD a","b=OLD b","c=NEW c","d=OLD d"]',
  'the rest are kept from cache, the changed one replaced -> ' + rowsNow());

// ---------- unscoped (a full generate) still rewrites everything ----------
calls = 0;
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: [] });
assert(JSON.stringify(askedRows) === '[{"key":"a"},{"key":"b"},{"key":"c"},{"key":"d"}]',
  'every row is sent when unscoped -> ' + JSON.stringify(askedRows));
assert(JSON.stringify(rowsNow()) === '["a=NEW a","b=NEW b","c=NEW c","d=NEW d"]', 'and all are replaced');

// ---------- a row whose event no longer exists is dropped on merge ----------
cache = { 'K::summary': { content: { rows: [
  { row_key: 'a', blurb: 'OLD a' }, { row_key: 'gone', blurb: 'stale row' },
] } } };
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d2'], summaryDayKeys: ['d2'] });
assert(!rowsNow().some(r => r.startsWith('gone')), 'a row for a deleted event does not linger -> ' + rowsNow());
assert(rowsNow().includes('a=OLD a'), 'while a live untouched row survives');

// ---------- a row that wants no blurb is never asked for ----------
cache = { 'K::summary': { content: { rows: [] } } };
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d3'], summaryDayKeys: ['d3'] });
assert(JSON.stringify(askedRows) === '[{"key":"d"}]', 'the wants-no-blurb row is filtered out -> ' + JSON.stringify(askedRows));

// ---------- scoped to a day with no blurb-worthy rows: no call at all ----------
calls = 0;
const emptyDay = new Map([['d1', []], ['d2', [{ key: 'c' }]], ['d3', []]]);
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), emptyDay,
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d1'], summaryDayKeys: ['d1'] });
assert(calls === 0, 'an empty scope spends no API call');

// ---------- the stored fingerprint covers the FULL row set, not just the slice ----------
cache = { 'K::summary': { content: { rows: [] } } };
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d2'], summaryDayKeys: ['d2'] });
assert(cache['K::summary'].fingerprint === 'fp:a,b,c,d',
  'fingerprint describes what is stored -> ' + cache['K::summary'].fingerprint);
