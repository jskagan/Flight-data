// "When new events are added to the itinerary that may affect attire, rather
// than regenerate the entire attire guide automatically, ask the user what
// the dress code is for the new events. And if those dress codes are
// identical or similar to dress codes for the events that are immediately
// before or after..., regenerate the attire guide by using the selected
// outfits for the new events." (2026-09-27)
//
// Opening a Clothing Summary whose guide is stale because the itinerary
// GAINED events now asks their dress codes in a dialog (suggested from each
// event's neighbors, athletic name rule first), merges them into the saved
// guide mechanically -- no Claude call, packing guidance untouched -- and
// adopts each new event into the outfit already composed for its time block
// (block folding IS the "identical or similar to neighbors" rule). Only a
// new event whose tier forms a genuinely NEW block gets the usual
// Regenerate-outfits offer.
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

// ---- the trigger: on opening a stale summary, added events prompt, never regenerate ----
{
  const show = extractFn('showTripsyAttireOverlay');
  assert(/if \(isOwner && stale && currentDays && !tripsyAttireGeneratingKeys\.has\(tripKey\)\)/.test(show),
    'the ask fires only for the owner, only when the guide is stale, never while a generation is already running');
  assert(/const promptKey = `\$\{tripKey\}::\$\{currentFingerprint \? currentFingerprint\.hash : ''\}`;/.test(show)
    && /tripsyAttireNewEventsPrompted\.has\(promptKey\)/.test(show),
    'declining stays declined for THIS itinerary state only -- genuinely newer additions prompt again');
  const flowSlice = show.slice(show.indexOf('tripsyAttireFindNewGuideEvents'), show.indexOf('} else if (isOwner)'));
  assert(flowSlice.length > 0 && !/tripsyRunAttireGenerationSafely|generateTripsyAttireGuide/.test(flowSlice),
    'THE ASK: no automatic regeneration -- the new-events flow never fires the generate path');
  assert(/if \(picks && tripsyAttireOverlayTripKey === tripKey\)/.test(show),
    'a dialog answered after the owner already switched trips must not write into the wrong overlay');
  assert(/tripsyAttireAdoptNewEventsIntoOutfits\(tripKey, saved\)/.test(show)
    && /they share the outfits already planned for their time blocks/.test(show),
    'THE ASK: matching-tier events are handed the SELECTED (already-composed) outfits, with no recompose');
  assert(/New time block has no outfit', yes: 'Regenerate', no: 'Ignore'/.test(show),
    'only a new event at a genuinely different dress level gets the Regenerate offer -- and it is an offer, never silent');
}
assert(/\[data-tripsy-attire-event-badge\], \[data-tripsy-attire-review-block\], \[data-tripsy-attire-review-event\], \[data-tripsy-attire-newevent-pick\]/.test(html),
  'the category menu\'s click-away excludes the new dialog\'s badges, same as the review dialog\'s (the tap that opens must not also close)');

// ---- executed: which events are "new", and what tier is suggested ----
{
  const reStart = html.indexOf('const TRIPSY_ATTIRE_ATHLETIC_EVENT_RE');
  eval(html.slice(reStart, html.indexOf(");", html.indexOf("'i'", reStart)) + 2).replace(/^const /, 'var '));
  eval(extractFn('tripsyAttireFindNewGuideEvents').replace(/^function /, 'var tripsyAttireFindNewGuideEvents = function '));

  const guide = { days: [
    { dayKey: '2026-11-01', events: [
      { id: 'a1', category: 'casual' },
      { id: 'a2', category: 'cocktail' },
    ] },
  ] };
  const currentDays = [
    { dayKey: '2026-11-01', events: [
      { id: 'new-first', name: 'Breakfast at Norma’s' },
      { id: 'a1', name: 'Old walk' },
      { id: 'new-mid', name: 'Pre-dinner drinks' },
      { id: 'a2', name: 'Old dinner' },
    ] },
    { dayKey: '2026-11-02', events: [
      { id: 'new-hike', name: 'Sunrise Hike to the Falls' },
      { id: 'freeday-2026-11-02', name: 'No events planned', freeDay: true },
    ] },
  ];
  const found = tripsyAttireFindNewGuideEvents(guide, currentDays);
  const byId = new Map(found.map(f => [f.ev.id, f]));
  assert(found.length === 3 && !byId.has('a1') && !byId.has('a2'),
    'only events the guide has never seen are listed -- existing ones are not re-asked');
  assert(!byId.has('freeday-2026-11-02'),
    'free-day placeholders are never asked -- Casual is already their rule');
  assert(byId.get('new-mid').suggested === 'casual',
    'THE ASK: the suggestion comes from the event immediately BEFORE it in the guide (you are already dressed for what came before)');
  assert(byId.get('new-first').suggested === 'casual',
    'an event with nothing known before it suggests from the one after');
  assert(byId.get('new-hike').suggested === 'athletic',
    'the athletic name rule outranks the neighbors -- a hike is Athletic wherever it lands');
}

// ---- executed: the mechanical merge (no Claude, guidance untouched, rollback) ----
(async () => {
  const src = extractFn('tripsyAttireApplyNewEvents').replace(/^async function /, 'var tripsyAttireApplyNewEvents = async function ');
  assert(!/personGuidance|packingList|laundryDays|guidanceFingerprint/.test(src),
    'THE ASK: the merge never touches the packing guidance -- nothing is regenerated');
  eval(extractFn('tripsyAttireFingerprint').replace(/^function /, 'var tripsyAttireFingerprint = function '));
  const run = async (guide, currentDays, picks, saveOk) => {
    const f = new Function('guide', 'currentDays', 'picks', 'tripsyAttireApplyRecomputedBlocks', 'computeTripsyAttireBlocks', 'tripsyAttireFingerprint', 'Store',
      src + '\nreturn tripsyAttireApplyNewEvents(guide, currentDays, picks);');
    return f(guide, currentDays, picks,
      (g, r) => { g.blocks = r.blocks; g.counts = r.counts; },
      () => ({ blocks: { recomputed: true }, counts: { recomputed: true } }),
      tripsyAttireFingerprint,
      { saveTripsyAttireGuide: async () => saveOk });
  };

  const mkGuide = () => ({
    days: [{ dayKey: 'd1', events: [{ id: 'a1', category: 'formal', categoryOverridden: true, alternateCategory: '' }] }],
    blocks: { old: true }, counts: { old: true },
    eventFingerprint: { hash: 'old', count: 1 },
    personGuidance: { him: 'KEEP' }, packingList: ['KEEP'],
  });
  const currentDays = [{ dayKey: 'd1', events: [
    { id: 'a1', name: 'Concert', date: 'd1', startTime: '7:00 PM', category: 'concert' },
    { id: 'n1', name: 'Afterparty', date: 'd1', startTime: '10:00 PM', category: null },
    { id: 'freeday-d2', name: 'No events planned', date: 'd2', freeDay: true },
  ] }];

  let g = mkGuide();
  let ok = await run(g, currentDays, new Map([['n1', 'cocktail']]), true);
  const evs = g.days[0].events;
  assert(ok === true && evs.length === 3, 'the merge takes the CURRENT itinerary structure');
  assert(evs[0].category === 'formal' && evs[0].categoryOverridden === true,
    'an existing event keeps its saved tier and override verbatim -- the raw itinerary category never overwrites it');
  assert(evs[1].category === 'cocktail' && evs[1].categoryOverridden === true,
    'THE ASK: the new event wears the tier the owner picked, marked as their own selection so no refresh re-judges it');
  assert(evs[2].category === 'casual' && evs[2].categoryOverridden === false,
    'a new free-day placeholder defaults Casual without being asked');
  assert(g.blocks.recomputed && g.counts.recomputed, 'blocks/counts re-derive mechanically');
  const expectFp = tripsyAttireFingerprint(g.days.flatMap(d => d.events));
  assert(g.eventFingerprint.hash === expectFp.hash && g.eventFingerprint.count === expectFp.count,
    'the fingerprint moves to the merged list, so the "may be out of date" note clears');
  assert(g.personGuidance.him === 'KEEP' && g.packingList[0] === 'KEEP',
    'packing guidance carried verbatim -- exactly what "do not regenerate the entire guide" means');

  g = mkGuide();
  ok = await run(g, currentDays, new Map([['n1', 'cocktail']]), false);
  assert(ok === false && g.days[0].events.length === 1 && g.eventFingerprint.hash === 'old',
    'a failed save rolls the guide back in memory -- days, blocks and fingerprint all restored');
})();

// ---- executed: adopting new events into the already-composed outfits ----
(async () => {
  const src = extractFn('tripsyAttireAdoptNewEventsIntoOutfits').replace(/^async function /, 'var tripsyAttireAdoptNewEventsIntoOutfits = async function ');
  const run = async (currentBlocks, outfitsByPerson) => {
    const saves = [];
    // The injected uncovered-check applies the REAL function's exact multiset
    // rule (dayKey|category counts) over the same currentBlocks the adoption
    // saw -- the fake replaces only the guide-days re-enumeration.
    const uncoveredFake = (guide, outfits) => {
      const keyOf = b => `${b.dayKey}|${b.category}`;
      const savedCounts = new Map();
      for (const b of (outfits.blocks || [])) savedCounts.set(keyOf(b), (savedCounts.get(keyOf(b)) || 0) + 1);
      const seen = new Map();
      return currentBlocks.filter(b => {
        const k = keyOf(b); const n = (seen.get(k) || 0) + 1; seen.set(k, n);
        return n > (savedCounts.get(k) || 0);
      });
    };
    const f = new Function('tripKey', 'guide', 'tripsyEnumerateAttireBlocks', 'Store', 'tripsyOutfitsUncoveredBlocks',
      src + '\nreturn tripsyAttireAdoptNewEventsIntoOutfits(tripKey, guide);');
    const need = await f('t1', {}, () => currentBlocks,
      {
        getTripsyTripOutfits: async (tk, person) => outfitsByPerson[person] || null,
        saveTripsyTripOutfits: async o => { saves.push(o.person); return true; },
      },
      uncoveredFake);
    return { need, saves };
  };

  // A new event folded into the existing cocktail block: same dayKey|tier, so
  // the saved outfit adopts the newcomer's id and nothing needs recomposing.
  const folded = [{ dayKey: 'd1', category: 'cocktail', eventIds: ['a2', 'n1'], label: 'Dinner → Afterparty' }];
  let out = { him: { person: 'him', tripKey: 't1', blocks: [{ dayKey: 'd1', category: 'cocktail', eventIds: ['a2'], garmentIds: ['g1'] }] } };
  let r = await run(folded, out);
  assert(out.him.blocks[0].eventIds.join(',') === 'a2,n1' && r.saves.includes('him'),
    'THE ASK: a new event at its neighbors\' dress level joins the SELECTED outfit -- the saved block adopts its id (one save)');
  assert(r.need.length === 0, 'nothing left uncovered -> no Regenerate offer');

  // Identical eventIds -> nothing to write.
  out = { him: { person: 'him', tripKey: 't1', blocks: [{ dayKey: 'd1', category: 'cocktail', eventIds: ['a2', 'n1'], garmentIds: ['g1'] }] } };
  r = await run(folded, out);
  assert(r.saves.length === 0, 'an already-matching block writes nothing (no wasted whole-file PATCH)');

  // A new BLOCK (formal, nothing saved covers it) -> that person is flagged.
  const newBlock = [
    { dayKey: 'd1', category: 'cocktail', eventIds: ['a2'] },
    { dayKey: 'd1', category: 'formal', eventIds: ['n2'] },
  ];
  out = { him: { person: 'him', tripKey: 't1', blocks: [{ dayKey: 'd1', category: 'cocktail', eventIds: ['a2'], garmentIds: ['g1'] }] } };
  r = await run(newBlock, out);
  assert(r.need.join(',') === 'him',
    'a new event at a genuinely DIFFERENT level forms an uncovered block -> flagged for the Regenerate offer');

  // No composed outfits at all -> nothing adopted, nothing offered.
  r = await run(folded, {});
  assert(r.need.length === 0 && r.saves.length === 0, 'a person with no composed outfits is skipped entirely');
})();
