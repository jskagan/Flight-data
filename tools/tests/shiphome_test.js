// Ship Home (2026-10-06): "put a ship-home indicator at a specific date and have the app
// help select which clothes should be shipped home at that point so I will have enough
// clothes for the rest of the trip." Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  let start = html.indexOf(`\nasync function ${name}(`);
  if (start < 0) start = html.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error('missing ' + name);
  start += 1;
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) { if (html[i] === '(') paren++; else if (html[i] === ')') { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const D = n => '2030-05-' + String(n).padStart(2, '0');

// ---- shared scaffold: a tiny wardrobe, a selection, wear days, ship-home records ----
let wardrobe = [], selection = [], generics = [], shipRecords = [], washes = [], notDirty = [], wearByGarment = {}, wearByLine = {};
const driveData = { get tripsyTripWardrobe() { return { T: selection }; } };
const Store = {
  listWardrobe: async () => wardrobe,
  getTripWardrobe: async () => selection,
  getTripGenericGarments: async () => generics,
  getTripsyAttireGuide: async () => ({ days: Array.from({ length: 10 }, (_, i) => ({ dayKey: D(i + 1) })) }),
  listTripsyShipHome: () => shipRecords,
  listTripsyLaundry: () => washes,
  listLaundryNotDirty: () => notDirty,
  getTripsyTripOutfits: async () => outfitsFixture,
};
let outfitsFixture = { blocks: [] };
const tripsyOutfitBlockLiveTier = (g, b) => b.category || null;
const TRIPSY_ATTIRE_PACKING_GROUP_LABEL = { tops: 'Tops', pants: 'Bottoms', footwear: 'Shoes' };
const TRIPSY_ATTIRE_CATEGORY_LABEL = { casual: 'Casual', formal: 'Formal' };
const tripsyNormalizeTripSelection = sel => sel;
const tripsyWardrobeWearDays = async (t, id) => ({ days: (wearByGarment[id] || []).map(d => ({ dayKey: d })) });
const tripsyWardrobeWearDaysFromLines = (g, p, lines) => ({ days: (wearByLine[lines[0].line] || []).map(d => ({ dayKey: d })) });
const limitByName = { 'Blue shirt': 1, 'Chinos': 10, 'Loafers': Infinity, 'Grey tee': 1 };
const tripsyWearsBeforeWash = name => (limitByName[name] !== undefined ? limitByName[name] : 1);
const tripsyGarmentTypeKey = () => 'shirt';
const tripsyWardrobeGarmentExcludedFromOutfits = () => false;
const tripsyGarmentTypeBucket = g => ({ key: g.bucket || 'tops', label: 'Tops' });
const tripsyAttirePackingGroupOf = g => g.group || 'tops';
const TRIPSY_ATTIRE_ITEMIZED_CATEGORIES = ['black_tie', 'formal', 'cocktail', 'semi_formal'];
eval(['tripsyShipHomeQtyBefore', 'tripsyShipHomeSplit', 'tripsyShipHomeCandidates', 'tripsyShipHomeGoneIds',
  'tripsyLaundryWearDebtStep', 'tripsyLaundryRunOutByDay', 'tripsyOutfitSwapCandidates', 'tripsyShipHomeConsolidationPlan', 'tripsyShipHomeSwapOptions'].map(extractFn).join('\n'));

(async () => {
  // ---- the maths ----
  assert(JSON.stringify(tripsyShipHomeSplit({ qty: 3, futureWears: 0, limit: 1 })) === '{"needed":0,"surplus":3}', 'never worn again -> every copy is surplus');
  assert(JSON.stringify(tripsyShipHomeSplit({ qty: 3, futureWears: 2, limit: 1 })) === '{"needed":2,"surplus":1}', 'three one-wear shirts, two shirt-days left -> ship one');
  assert(JSON.stringify(tripsyShipHomeSplit({ qty: 2, futureWears: 6, limit: 10 })) === '{"needed":1,"surplus":1}', 'two ten-wear chinos, six wearings left -> one pair covers it, ship the other');
  assert(JSON.stringify(tripsyShipHomeSplit({ qty: 1, futureWears: 4, limit: Infinity })) === '{"needed":1,"surplus":0}', 'a never-laundered garment still worn is kept whole');
  assert(JSON.stringify(tripsyShipHomeSplit({ qty: 2, futureWears: 9, limit: 1 })) === '{"needed":2,"surplus":0}', 'more wearings left than copies -> nothing to spare (needed is capped at what you have)');
  const recs = [
    { tripKey: 'T', person: 'him', dayKey: D(3), box: { 'g:a': 1 } },
    { tripKey: 'T', person: 'him', dayKey: D(6), box: { 'g:a': 1, 'g:b': 1 }, shippedAt: 'x' },
    { tripKey: 'T', person: 'her', dayKey: D(2), box: { 'g:a': 5 } },
  ];
  assert(tripsyShipHomeQtyBefore(recs, 'him', 'g:a', D(3)) === 0, 'a box dated the SAME day does not count yet -- the garment is still wearable on ship day');
  assert(tripsyShipHomeQtyBefore(recs, 'him', 'g:a', D(4)) === 1 && tripsyShipHomeQtyBefore(recs, 'him', 'g:a', D(7)) === 2, 'boxes dated before the day add up, planned or shipped alike');
  assert(tripsyShipHomeQtyBefore(recs, 'him', 'g:b', D(9)) === 1 && tripsyShipHomeQtyBefore(recs, 'him', 'g:c', D(9)) === 0, 'per key');
  assert(tripsyShipHomeQtyBefore(recs, 'him', 'g:a', D(9)) === 2, 'the other person\'s box is not yours');

  // ---- the candidates for a day: THE ASK ----
  wardrobe = [
    { id: 'a', name: 'Blue shirt', person: 'him' }, { id: 'b', name: 'Chinos', person: 'him' },
    { id: 'c', name: 'Loafers', person: 'him' }, { id: 'd', name: 'Grey tee', person: 'him' }, { id: 'h', name: 'Blouse', person: 'her' },
  ];
  selection = [{ id: 'a', qty: 3 }, { id: 'b', qty: 2 }, { id: 'c', qty: 1 }, { id: 'd', qty: 1 }, { id: 'h', qty: 2 }];
  wearByGarment = { a: [D(1), D(2), D(6), D(7)], b: [D(1), D(2), D(3), D(7), D(8)], c: [D(1), D(9)], d: [D(1), D(2)] };
  generics = [{ person: 'him', name: 'Socks', qty: 4, category: 'general' }];
  wearByLine = { Socks: [D(1), D(2)] };
  shipRecords = [];
  let items = await tripsyShipHomeCandidates('T', D(4), 'him');
  const byKey = Object.fromEntries(items.map(it => [it.key, it]));
  assert(!byKey['g:h'], 'only this person\'s garments are listed');
  assert(byKey['g:d'].recommend && byKey['g:d'].futureWears === 0 && byKey['g:d'].surplus === 1, 'THE ASK: a tee never worn again after the ship day is recommended');
  assert(byKey['g:a'].recommend && byKey['g:a'].surplus === 1 && byKey['g:a'].needed === 2 && byKey['g:a'].nextWearDay === D(6),
    'three shirts with two shirt-days left: ship one, keep two -> ' + JSON.stringify(byKey['g:a']));
  assert(byKey['g:b'].recommend && byKey['g:b'].surplus === 1, 'two chinos, two wearings left: one pair is enough');
  assert(!byKey['g:c'].recommend && byKey['g:c'].needed === 1, 'the loafers worn on the last day are still needed');
  assert(byKey['x:Socks'] && byKey['x:Socks'].recommend && byKey['x:Socks'].surplus === 4, 'a "No Picture" generic counts too');
  assert(items[0].key === 'x:Socks' && items[items.length - 1].key === 'g:c', 'biggest surplus first, still-needed last');
  // A box already dated earlier reduces what is left to ship.
  shipRecords = [{ tripKey: 'T', person: 'him', dayKey: D(2), box: { 'g:a': 2 } }];
  items = await tripsyShipHomeCandidates('T', D(4), 'him');
  const a2 = items.find(it => it.key === 'g:a');
  assert(a2.qty === 1 && !a2.recommend && a2.needed === 1, 'copies already in an earlier box are gone; what is left is needed');
  shipRecords = [{ tripKey: 'T', person: 'him', dayKey: D(2), box: { 'g:d': 1 } }];
  items = await tripsyShipHomeCandidates('T', D(4), 'him');
  assert(!items.some(it => it.key === 'g:d'), 'a garment entirely shipped earlier is not listed at all');

  // ---- gone ids for the outfit side ----
  shipRecords = [{ tripKey: 'T', person: 'him', dayKey: D(4), box: { 'g:a': 3, 'g:b': 1 } }];
  let gone = tripsyShipHomeGoneIds('T', 'him', D(5));
  assert(gone.has('a') && gone.get('a') === D(4) && !gone.has('b'), 'a garment is GONE only once every packed copy is boxed; one of two chinos is not');
  assert(tripsyShipHomeGoneIds('T', 'him', D(4)).size === 0, 'nothing is gone on the ship day itself');
  assert(tripsyShipHomeGoneIds('T', 'her', D(9)).size === 0, 'the other person has shipped nothing');

  // ---- Swap candidates exclude a shipped garment for a later block ----
  const block = { dayKey: D(6), garmentIds: ['d'] };
  let r = await tripsyOutfitSwapCandidates('T', block, 'd', 'him', null);
  assert(!r.candidates.some(g => g.id === 'a') && r.candidates.some(g => g.id === 'b'), 'THE ASK (outfits): a top shipped home before the block\'s day is never offered; the half-shipped chinos still are');
  r = await tripsyOutfitSwapCandidates('T', { dayKey: D(3), garmentIds: ['d'] }, 'd', 'him', null);
  assert(r.candidates.some(g => g.id === 'a'), 'before the box goes, the same garment is offered as usual');

  // ---- the run-out projection: a shipped garment worn later is a shortage ----
  shipRecords = [{ tripKey: 'T', person: 'him', dayKey: D(4), box: { 'g:a': 3 } }];
  washes = [{ tripKey: 'T', person: 'him', dayKey: D(2), washedAt: 'x', bag: { 'g:a': 1 } }];
  wearByGarment = { a: [D(1), D(3), D(6)], b: [], c: [D(9)], d: [] };
  generics = [];
  const ro = await tripsyLaundryRunOutByDay('T', 'him', { days: Array.from({ length: 10 }, (_, i) => ({ dayKey: D(i + 1) })) });
  assert(ro.runOut.get(D(6)) && ro.runOut.get(D(6)).includes('Blue shirt') && ro.runOut.size === 1,
    'the shirt shipped on day 4 runs out the day it is worn again, and only that day is flagged');
  shipRecords = [{ tripKey: 'T', person: 'him', dayKey: D(4), box: { 'g:c': 1 } }];
  const ro2 = await tripsyLaundryRunOutByDay('T', 'him', { days: Array.from({ length: 10 }, (_, i) => ({ dayKey: D(i + 1) })) });
  assert(ro2.runOut.get(D(9)) && ro2.runOut.get(D(9)).includes('Loafers'), 'even a never-laundered garment (shoes) runs out once shipped, since the shortage is physical');

  // ---- CONSOLIDATION: re-dress later outfits so more can go home ----
  // Three pairs of chinos each worn once after ship day (day 4): one pair can take all
  // three wearings (10-wear limit), so two go home. Three one-wear shirts each worn once
  // cannot be consolidated without a wash. A single pair of loafers is already shared.
  wardrobe = [
    { id: 'p1', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'] }, { id: 'p2', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'] }, { id: 'p3', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'] },
    { id: 's1', name: 'Blue shirt', person: 'him', group: 'tops', tiers: ['casual'] }, { id: 's2', name: 'Blue shirt', person: 'him', group: 'tops', tiers: ['casual'] }, { id: 's3', name: 'Blue shirt', person: 'him', group: 'tops', tiers: ['casual'] },
    { id: 'lf', name: 'Loafers', person: 'him', group: 'footwear', tiers: ['casual'] },
  ];
  selection = ['p1', 'p2', 'p3', 's1', 's2', 's3', 'lf'].map(id => ({ id, qty: 1 }));
  const mk = (day, ids) => ({ dayKey: day, category: 'casual', eventIds: ['e' + day], garmentIds: ids });
  outfitsFixture = { blocks: [mk(D(2), ['p1', 's1', 'lf']), mk(D(5), ['p1', 's1', 'lf']), mk(D(6), ['p2', 's2', 'lf']), mk(D(7), ['p3', 's3', 'lf'])] };
  shipRecords = []; washes = [];
  const cp = await tripsyShipHomeConsolidationPlan('T', D(4), 'him');
  const freedIds = cp.freed.map(f => f.id).sort();
  assert(JSON.stringify(freedIds) === '["p2","p3"]', 'THE ASK: two of three chinos are freed by re-dressing the later outfits onto one pair -> ' + JSON.stringify(freedIds));
  assert(cp.swaps.length === 2 && cp.swaps.every(sw => sw.newId === 'p1') && cp.swaps.map(sw => sw.dayKey).sort().join() === [D(6), D(7)].join(),
    'wear is concentrated onto the pair already worn the most (p1), on exactly the two later blocks');
  assert(!freedIds.includes('s1') && !freedIds.includes('s2') && !freedIds.includes('s3'), 'one-wear shirts are never consolidated (no wash, no capacity)');
  assert(JSON.stringify(outfitsFixture.blocks[2].garmentIds) === JSON.stringify(['p2', 's2', 'lf']), 'the plan is a proposal: the saved outfits are untouched until applied');
  // Capacity is respected: a pair already worn 9 days since its last wash can take ONE more, not two.
  outfitsFixture = { blocks: [...Array.from({ length: 9 }, (_, i) => mk('2030-04-' + String(i + 10).padStart(2, '0'), ['p1', 'lf'])), mk(D(5), ['p1', 'lf']), mk(D(6), ['p2', 'lf']), mk(D(7), ['p3', 'lf'])] };
  const cp2 = await tripsyShipHomeConsolidationPlan('T', D(4), 'him');
  assert(!cp2.swaps.some(sw => sw.newId === 'p1'), 'a pair already at its wear limit never absorbs another wearing');
  assert(cp2.freed.length === 2 && cp2.swaps.every(sw => sw.newId === cp2.swaps[0].newId), 'instead the OTHER pairs consolidate — p1 can even shed its one remaining wearing and go home too -> ' + JSON.stringify(cp2.freed.map(f => f.id)));
  // A garment already in the box is never a substitute.
  outfitsFixture = { blocks: [mk(D(5), ['p1', 'lf']), mk(D(6), ['p2', 'lf'])] };
  const cp3 = await tripsyShipHomeConsolidationPlan('T', D(4), 'him', new Set(['g:p1']));
  assert(!cp3.swaps.some(sw => sw.newId === 'p1'), 'a garment already going home cannot absorb wear');
  const screen2 = extractFn('showTripsyShipHomeDay');
  assert(/tripsyShipHomeConsolidationPlan\(tripKey, dayKey, person, new Set\(inBox\.keys\(\)\)\)/.test(screen2) && /data-ship-consolidate/.test(screen2) && /Consolidate outfits to ship more/.test(screen2),
    'the screen proposes the consolidation with an Apply button');
  assert(/sw\.block\.garmentIds\[i\] = sw\.newId;/.test(screen2) && /Store\.saveTripsyTripOutfits\(plan\.outfits\)/.test(screen2) && /for \(const f of plan\.freed\) inBox\.set/.test(screen2),
    'Apply re-dresses the outfits (one save), then puts the freed garments in the box');

  // ---- RULES-EXPLAINED swap options for a still-needed garment ----
  wardrobe = [
    { id: 'p1', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'], bucket: 'pants' },
    { id: 'p2', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'], bucket: 'pants' },
    { id: 'p3', name: 'Chinos', person: 'him', group: 'pants', tiers: ['formal'], bucket: 'pants' },
    { id: 's1', name: 'Blue shirt', person: 'him', group: 'tops', tiers: ['casual'], bucket: 'tops' },
    { id: 'p4', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'], bucket: 'pants' },
    { id: 'p5', name: 'Chinos', person: 'him', group: 'pants', tiers: ['casual'], bucket: 'pants' },
    { id: 'h1', name: 'Skirt', person: 'her', group: 'pants', tiers: ['casual'], bucket: 'pants' },
  ];
  selection = ['p1', 'p2', 'p3', 's1', 'p4', 'p5', 'h1'].map(id => ({ id, qty: 1 }));
  washes = []; shipRecords = [{ tripKey: 'T', person: 'him', dayKey: D(2), box: { 'g:p5': 1 } }];
  const blk = mk(D(6), ['p1', 's1']);
  outfitsFixture = { blocks: [blk, { dayKey: D(6), category: 'casual', eventIds: ['x'], garmentIds: ['p4'] }] };
  const so = await tripsyShipHomeSwapOptions('T', blk, 'p1', 'him', 'casual', D(4), new Set(['g:p2']));
  const byIdOpt = Object.fromEntries(so.options.map(o => [o.garment.id, o]));
  assert(!byIdOpt.p1 && !byIdOpt.h1, 'never the garment itself, never the other person\'s');
  assert(!byIdOpt.p2, 'THE ASK: a garment designated for this box is not offered');
  assert(!byIdOpt.p5, 'a garment already shipped home in an earlier box is not offered');
  assert(byIdOpt.p3 && !byIdOpt.p3.allowed && /Not tagged for Casual/.test(byIdOpt.p3.reasons.join(' ')), 'THE ASK: a wrong-tier garment is still listed, with the rule it fails spelled out');
  assert(!byIdOpt.s1, 'THE ASK (follow-up): a different KIND of garment (a top, for a pair of trousers) is not shown at all, not even as overridable');
  assert(byIdOpt.p4 && /Worn in another outfit the same day/.test(byIdOpt.p4.reasons.join(' ')), 'a garment in another outfit that day is named as such');
  assert(so.options[0].allowed === false || so.options.every(o => !o.allowed), 'with nothing allowed here, nothing is marked ✓');
  // An allowed one: p4 moved to another day.
  outfitsFixture = { blocks: [blk, { dayKey: D(7), category: 'casual', eventIds: ['x'], garmentIds: ['p4'] }] };
  const so2 = await tripsyShipHomeSwapOptions('T', blk, 'p1', 'him', 'casual', D(4), new Set(['g:p2']));
  const p4 = so2.options.find(o => o.garment.id === 'p4');
  assert(p4 && p4.allowed && so2.options[0].garment.id === 'p4', 'a garment passing every rule is marked allowed and listed first');
  // Agreement with Swap's own filter: allowed == what tripsyOutfitSwapCandidates returns (box key aside).
  const swapIds = (await tripsyOutfitSwapCandidates('T', blk, 'p1', 'him', 'casual')).candidates.map(g => g.id).filter(id => id !== 'p2').sort();
  assert(JSON.stringify(so2.options.filter(o => o.allowed).map(o => o.garment.id).sort()) === JSON.stringify(swapIds), 'the explained rules agree with Swap\'s own candidate filter -> ' + swapIds);
  // Capacity: a one-wear shirt already worn is flagged.
  wardrobe.push({ id: 's2', name: 'Grey tee', person: 'him', group: 'tops', tiers: ['casual'], bucket: 'tops' });
  selection.push({ id: 's2', qty: 1 });
  outfitsFixture = { blocks: [mk(D(5), ['s2', 'p4']), mk(D(6), ['s1', 'p1'])] };
  const so3 = await tripsyShipHomeSwapOptions('T', outfitsFixture.blocks[1], 's1', 'him', 'casual', D(4), new Set());
  const s2 = so3.options.find(o => o.garment.id === 's2');
  assert(s2 && !s2.allowed && /would need washing before this day/.test(s2.reasons.join(' ')), 'the wear-capacity rule is explained too (a worn one-wear tee)');
  const picker = extractFn('tripsyShipHomeSwapPicker');
  assert(/✓ Can be swapped under the rules/.test(picker) && /data-ship-swap-force=/.test(picker) && /Swap anyway/.test(picker) && /o\.reasons\.map\(r => `✕ \$\{esc\(r\)\}`\)/.test(picker),
    'THE ASK (picker): verdict under each card, the failed rules listed, and a Swap anyway button');
  assert(/done\(\{ id: force\.dataset\.shipSwapForce, forced: true \}\)/.test(picker), 'Swap anyway resolves as forced');
  const gdays = extractFn('showTripsyShipHomeGarmentDays');
  assert(/b\.dayKey > dayKey && \(b\.garmentIds \|\| \[\]\)\.includes\(garmentId\)/.test(gdays) && /data-ship-garment-swap=/.test(gdays) && /Worn with:/.test(gdays),
    'THE ASK (view): each later outfit wearing the garment, with a Swap button each');
  assert(/tripsyShipHomeSwapPicker\(tripKey, b, garmentId, person, liveTier, dayKey, excludeKeys\)/.test(gdays) && /Store\.saveTripsyTripOutfits\(outfits\)/.test(gdays), 'a pick swaps in place and saves');
  const screen3 = extractFn('showTripsyShipHomeDay');
  assert(/showTripsyShipHomeGarmentDays\(tripKey, dayKey, person, it, \{/.test(screen3) && /shipAnywayKey: it\.key/.test(screen3), 'tapping a still-needed garment opens that view; Ship it anyway still reaches the box');

  // ---- wiring ----
  assert(/listTripsyShipHome\(tripKey\) \{/.test(html) && /async saveTripsyShipHome\(tripKey, person, dayKey, box\)/.test(html) && /async markTripsyShipHomeShipped\(tripKey, person, dayKey, shipped = true\)/.test(html),
    'Store: list / save (an emptied box removes the marker) / mark shipped');
  assert(/driveData\.tripsyShipHome = driveData\.tripsyShipHome\.filter\(r => keys\.has\(r\.tripKey\)\)/.test(html), 'prune rule: a box for a vanished trip is dropped');
  const guideRender = extractFn('renderTripsyDressGuideInto');
  assert(/data-tripsy-ship-day="\$\{esc\(day\.dayKey\)\}"/.test(guideRender) && /const shipBtn = \(isOwner && \(shipRec \|\| !dayIsPast\)\)/.test(guideRender),
    'THE ASK (indicator): every day not yet over offers 📦 Ship Home to the owner; a day with a box keeps it');
  assert(/📦 Shipped Home · \$\{shipCount\}/.test(guideRender) && /📦 Shipping Home · \$\{shipCount\}/.test(guideRender), 'the button reads what is in the box, and whether it has gone');
  assert(/showTripsyShipHomeDay\(guide\.tripKey, el\.getAttribute\('data-tripsy-ship-day'\), person, \{ onChanged: refreshLaundryInfo \}\)/.test(guideRender),
    'tapping it opens the Ship Home screen, and any change refreshes the run-out bar behind it');
  const screen = extractFn('showTripsyShipHomeDay');
  assert(/tripsyShipHomeCandidates\(tripKey, dayKey, person\)/.test(screen) && /Recommended to ship/.test(screen) && /Still needed for the trip/.test(screen),
    'the screen splits recommended from still-needed');
  assert(/data-ship-add-recommended/.test(screen) && /data-ship-mark/.test(screen) && /data-ship-clear/.test(screen) && /data-ship-unmark/.test(screen),
    'Add all recommended, Mark Shipped, Remove Marker, Not Shipped Yet');
  assert(/if \(!it\.recommend && !\(inBox\.get\(it\.key\) > 0\)\) \{/.test(screen) && /Ship \$\{it\.name\} anyway\?/.test(screen), 'shipping a still-needed garment asks first and says what it means');
  assert(/ov\.style\.zIndex = '2147483090';/.test(screen), 'sits BELOW tripsyConfirmDialog (2147483100) so its own confirms are not hidden behind it');
  assert(/if \(shipped\) return; \/\/ read-only once it has gone/.test(screen), 'a shipped box is read-only');
  // Laundry: shipped copies are not there to wash.
  const laundryItems = extractFn('tripsyLaundryItemsForDay');
  assert(/const qty = qtyPacked - tripsyShipHomeQtyBefore\(shipRecords, person, 'g:' \+ id, dayKey\);\s*\n\s*if \(qty <= 0\) continue;/.test(laundryItems), 'the laundry list drops shipped copies');
  assert(/const qty = qtyPacked - tripsyShipHomeQtyBefore\(shipRecords, person, 'g:' \+ id, dayKey\);/.test(extractFn('tripsyLaundryFindAdjustments')), 'and so does the post-wash adjustment finder');
  // Outfits: shipped = lost, with its own wording, everywhere a lost garment is judged.
  const modal = extractFn('showTripsyOutfitModal');
  assert(/shippedGone\.has\(id\) \? 'Shipped home' : 'Not packed'/.test(modal) && /was shipped home on \$\{esc\(tripsyDayHeaderLabel\(shippedGone\.get\(lostId\)\)\)\}/.test(modal),
    'the outfit modal badges a shipped garment and names the day it went');
  assert(/shippedGone\.has\(id\)/.test(extractFn('tripsyOutfitsNeedRecompose')) && /shipped home on \$\{tripsyDayHeaderLabel\(shippedGone\.get\(shipped\[0\]\)\)\}/.test(extractFn('tripsyOutfitStaleReasons')),
    'the ⚠️ check and the problems dialog treat it as lost, worded as shipped');
  assert(/shippedGone\.has\(g\.id\)/.test(extractFn('tripsyOutfitAddCandidates')) && /shippedGone\.has\(id\)/.test(extractFn('showTripsyOutfitFixPage')), 'Add candidates and the fix page agree');
  const compose = extractFn('composeTripsyOutfits');
  assert(/SHIPPED HOME AFTER \$\{shipDay\}/.test(compose) && /A garment marked SHIPPED HOME AFTER <date> is posted home that day and is NOT available to any block dated after it/.test(html),
    'the compose prompt labels a fully-boxed garment with its ship day and rules it out of later blocks');
})();
