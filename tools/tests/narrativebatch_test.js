// "Why am I getting this error" (2026-09-27, dialog: "JSON Parse error:
// Unexpected EOF"): generateTripsyItineraryNarrative's response is capped at
// max_tokens 4096 -- a handful of days' narratives -- and the partial
// itinerary's 11-day generation blew past it, truncating the json_schema
// output mid-stream so JSON.parse died with a bare EOF and NOTHING saved.
// A many-day first-time Create had the same latent bug. Two fixes, both in
// the SHARED procedure so partial and full itineraries stay identical:
// tripsyGenerateNarrativeSections now generates days in BATCHES of 4 per
// call (intro rides the first; each batch's just-written place blurbs join
// the don't-repeat context for later batches, exactly like cached days'
// blurbs), and every generator's response check now names a max_tokens
// truncation instead of surfacing a parse error.
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

// ---- the truncation guard, on EVERY generator that parses json_schema text ----
assert((html.match(/if \(data\.stop_reason === 'max_tokens'\) throw new Error\('The response hit its length limit/g) || []).length === 4,
  'all four non-streamed generators now name a max_tokens truncation instead of dying with a bare JSON parse EOF');

// ---- the batching lives in the SHARED procedure ----
const gen = extractFn('tripsyGenerateNarrativeSections');
assert(/const TRIPSY_NARRATIVE_DAY_BATCH = 4;/.test(gen),
  'THE FIX: days generate in batches of 4 per call -- what max_tokens 4096 actually holds');
assert(/includeIntro: includeIntro && b === 0,/.test(gen),
  'the trip intro rides the FIRST batch only');
assert(/existingPlaceBlurbs = existingPlaceBlurbs\.concat\(/.test(gen),
  'each batch\'s just-written place blurbs join the don\'t-repeat context for later batches, same as cached days\' blurbs');
assert(/if \(!dayBatches\.length\) dayBatches\.push\(\[\]\); \/\/ intro-only call/.test(gen),
  'an intro-only generation (no days) still makes exactly one call');

// ---- executed: the batching against a stubbed generator ----
(async () => {
  const src = gen.replace(/^async function /, 'var tripsyGenerateNarrativeSections = async function ');
  const run = async (dayKeysToGenerate, includeIntro) => {
    const calls = [];
    const saved = {};
    const f = new Function('tripKey', 'effectiveTrip', 'dayKeys', 'byDay', 'summaryByDay', 'opts',
      'Store', 'generateTripsyItineraryNarrative', 'generateTripsySummaryBlurbs',
      'tripsyNarrativeDayPromptData', 'tripsyContentFingerprint', 'formatTripDateRange',
      'tripsySummaryRowKey', 'tripsySummaryRowWantsBlurb', 'tripsySummaryRowPromptData',
      src + '\nreturn tripsyGenerateNarrativeSections(tripKey, effectiveTrip, dayKeys, byDay, summaryByDay, opts);');
    await f('t1', { name: 'T', location: '', start: 'd01', end: 'd11' },
      dayKeysToGenerate.slice(), new Map(), new Map(),
      { includeIntro, includeSummary: false, dayKeysToGenerate },
      {
        getTripsyNarrativeCache: async () => ({}),
        saveTripsyNarrativeSections: async sections => { Object.assign(saved, sections); return true; },
      },
      async (trip, allDays, opts) => {
        calls.push({ days: opts.dayKeysToGenerate.slice(), includeIntro: opts.includeIntro, priorBlurbs: opts.existingPlaceBlurbs.slice() });
        return {
          trip_intro: opts.includeIntro ? 'INTRO' : '',
          days: opts.dayKeysToGenerate.map(k => ({ day_key: k, title: `T-${k}`, narrative: `N-${k}`, place_blurbs: [{ place_name: `P-${k}`, blurb: `B-${k}` }] })),
        };
      },
      async () => ({ rows: [] }),
      (k, evs) => ({ day_key: k }),
      () => 'fp', () => 'range',
      () => null, () => false, () => ({}));
    return { calls, saved };
  };

  const days11 = Array.from({ length: 11 }, (_, i) => `d${String(i + 1).padStart(2, '0')}`);
  let { calls, saved } = await run(days11, true);
  assert(calls.length === 3 && calls.map(c => c.days.length).join(',') === '4,4,3',
    'THE FIX: 11 days -> three calls of 4/4/3, none of which can blow the token cap (the exact live-failure shape)');
  assert(calls[0].includeIntro === true && calls[1].includeIntro === false && calls[2].includeIntro === false,
    'the intro is written once, in the first batch');
  assert(days11.every(k => saved[`t1::day::${k}`] && saved[`t1::day::${k}`].content.narrative === `N-${k}`)
    && saved['t1::intro'].content.trip_intro === 'INTRO',
    'every day\'s narrative AND the intro land in the one save, same as the unbatched procedure');
  assert(calls[1].priorBlurbs.some(pb => pb.place_name === 'P-d01')
    && calls[2].priorBlurbs.some(pb => pb.place_name === 'P-d05')
    && !calls[0].priorBlurbs.length,
    'batch 2 sees batch 1\'s blurbs, batch 3 sees both -- a place visited in two batches still gets two different write-ups');

  ({ calls } = await run(['d1', 'd2', 'd3'], false));
  assert(calls.length === 1 && calls[0].includeIntro === false,
    'a small generation (the changes dialog\'s ordinary case) is still exactly one call -- nothing changed for it');

  ({ calls, saved } = await run([], true));
  assert(calls.length === 1 && calls[0].days.length === 0 && saved['t1::intro'].content.trip_intro === 'INTRO',
    'an intro-only generation still works as one call');
})();
