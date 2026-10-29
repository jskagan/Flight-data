
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// ---- stubs ----
let wardrobe = [], selection = [], generics = [], wearByGarment = {}, wearByLine = {};
function tripsyShipHomeQtyBefore() { return 0; } // Ship Home stub: nothing shipped
const Store = {
  listWardrobe: async () => wardrobe,
  getTripWardrobe: async () => selection,
  getTripGenericGarments: async () => generics,
  getTripsyAttireGuide: async () => ({ tripKey: 'T1', days: [] }),
};
const tripsyNormalizeTripSelection = sel => sel;
let washes = [], notDirty = [];
Store.listTripsyLaundry = () => washes;
Store.listTripsyShipHome = () => [];
Store.listLaundryNotDirty = () => notDirty;
const tripsyWardrobeWearDays = async (tripKey, id) => ({ days: (wearByGarment[id] || []).map(d => ({ dayKey: d })) });
const tripsyWardrobeWearDaysFromLines = (guide, person, lines) => ({ days: (wearByLine[lines[0].line] || []).map(d => ({ dayKey: d })) });
const tripsyGarmentTypeKey = n => /shirt/i.test(n) ? 'shirt'
  : (/trouser|jean|chino/i.test(n) ? 'trousers' : (/jacket|blazer/i.test(n) ? 'jacket' : ''));
const tripsyAttirePackingGroupOf = () => 'accessories';
const TRIPSY_WEARS_BEFORE_WASH = {
  'dress-shirt': 1, shirt: 1, tee: 1, polo: 1, undershirt: 1,
  underwear: 1, socks: 1, 'dress-socks': 1,
  trousers: 10, jeans: 10, shorts: 10, skirt: 10,
  swim: 3, dress: 6, sweater: 6,
  tie: Infinity,
  suit: Infinity, tuxedo: Infinity, blazer: Infinity, jacket: Infinity,
  shoes: Infinity, belt: Infinity, cufflinks: Infinity, sunglasses: Infinity,
};
const TRIPSY_WEARS_BEFORE_WASH_BY_GROUP = {
  tops: 1, essentials: 1, pants: 10, dress_wear: 6,
  outerwear: Infinity, footwear: Infinity, accessories: Infinity,
};
function tripsyWearsBeforeWash(name, typeKey, group) {
  const t = typeKey || tripsyGarmentTypeKey(name || '');
  if (TRIPSY_WEARS_BEFORE_WASH[t] !== undefined) return TRIPSY_WEARS_BEFORE_WASH[t];
  const g = group || tripsyAttirePackingGroupOf({ name });
  if (TRIPSY_WEARS_BEFORE_WASH_BY_GROUP[g] !== undefined) return TRIPSY_WEARS_BEFORE_WASH_BY_GROUP[g];
  return 1;
}
function tripsyDirtyCopies(worn, limit, qty) {
  if (!(worn > 0) || !(limit > 0) || !isFinite(limit)) return 0;
  return Math.min(Math.floor(worn / limit), qty);
}
function tripsyLaundryBagBaseCounts(bag) {
  const m = new Map();
  for (const [key, n] of Object.entries(bag || {})) {
    const base = key.endsWith('::nn') ? key.slice(0, -4) : key;
    m.set(base, (m.get(base) || 0) + (Number(n) || 0));
  }
  return m;
}
function tripsyLaundryReturnCredits(records, person) {
  const out = [];
  for (const r of (records || [])) {
    if (!r || !r.washedAt || !r.dayKey || (r.person || 'him') !== person) continue;
    const sent = tripsyLaundryBagBaseCounts(r.bag);
    if (!r.awaitingReturn) {
      for (const [key, qty] of sent) if (qty > 0) out.push({ washDayKey: r.dayKey, dayKey: r.dayKey, key, qty });
      continue;
    }
    for (const [key, ret] of Object.entries(r.returned || {})) {
      const qty = Math.min(sent.get(key) || 0, Number(ret && ret.qty) || 0);
      if (qty > 0) out.push({ washDayKey: r.dayKey, dayKey: (ret && ret.dayKey) || r.dayKey, key, qty });
    }
  }
  return out;
}
function tripsyLaundryLastReturnDay(credits, key, uptoDayKey) {
  const base = key.endsWith('::nn') ? key.slice(0, -4) : key;
  return (credits || []).filter(c => c.key === base && (!uptoDayKey || c.dayKey <= uptoDayKey))
    .reduce((best, c) => (!best || c.dayKey > best ? c.dayKey : best), null);
}
function tripsyLaundryOutOn(records, person, key, dayKey) {
  const base = key.endsWith('::nn') ? key.slice(0, -4) : key;
  let n = 0;
  for (const r of (records || [])) {
    if (!r || !r.washedAt || !r.awaitingReturn || !r.dayKey || r.dayKey > dayKey || (r.person || 'him') !== person) continue;
    const sent = tripsyLaundryBagBaseCounts(r.bag).get(base) || 0;
    const ret = (r.returned || {})[base];
    const back = (ret && ret.dayKey && ret.dayKey <= dayKey) ? Math.min(sent, Number(ret.qty) || 0) : 0;
    n += Math.max(0, sent - back);
  }
  return n;
}
async function tripsyLaundryItemsForDay(tripKey, dayKey, person) {
  const [garments, selectedRaw, genericRaw, guide] = await Promise.all([
    Store.listWardrobe(),
    Store.getTripWardrobe(tripKey),
    Store.getTripGenericGarments(tripKey),
    Store.getTripsyAttireGuide(tripKey),
  ]);
  const isPerson = g => (g.person || 'him') === person;
  const byId = new Map((garments || []).map(g => [g.id, g]));
  const qtyById = new Map();
  for (const e of tripsyNormalizeTripSelection(selectedRaw)) {
    qtyById.set(e.id, (qtyById.get(e.id) || 0) + e.qty);
  }
  // A garment is only dirty for the wears SINCE the last wash that included it -- washing
  // resets its clock, and per garment rather than globally, since a wash is a specific
  // bagful and not everything you own.
  // The clock resets when the copies come BACK from the wash, not when they went in
  // (tripsyLaundryReturnCredits -- a pre-returns wash counts as back on its wash day).
  const laundryRecords = Store.listTripsyLaundry(tripKey);
  const returnCredits = tripsyLaundryReturnCredits(laundryRecords, person);
  const lastWashFor = key => tripsyLaundryLastReturnDay(returnCredits, key, dayKey);
  // One garment can genuinely straddle the two sections: with 3 shirts dirty and only
  // 2 more shirt-days on the schedule, washing 2 matters and the third is optional.
  // Dirty copies are fungible, so the split is COMPUTED: future wearings need
  // ceil(futureWears/limit) copies, still-clean copies cover that first, and only the
  // shortfall of dirty copies goes in the top section. The bottom card gets its own
  // '::nn'-suffixed key so the bag can hold each card's copies separately; creditKey
  // stays the BASE key on both, since washes and Not Dirty credits are per GARMENT
  // (the wear-count model is aggregate, not per copy). totalDirty rides along so the
  // Not Dirty credit math can target the garment's whole pile, whichever card is
  // pressed.
  const pushSplit = (list, base, { dirty, qty, limit, worn, futureWears }) => {
    const cleanCopies = Math.max(0, qty - dirty);
    const neededCopies = (limit > 0 && isFinite(limit)) ? Math.ceil(futureWears / limit) : 0;
    const dirtyNeeded = Math.max(0, Math.min(dirty, neededCopies - cleanCopies));
    const shared = { ...base, creditKey: base.key, worn, limit, totalDirty: dirty };
    if (dirtyNeeded > 0) list.push({ ...shared, count: dirtyNeeded, neededAgain: true });
    if (dirty - dirtyNeeded > 0) list.push({ ...shared, key: base.key + '::nn', count: dirty - dirtyNeeded, neededAgain: false });
  };
  // Wearings the owner has forgiven ("Not Dirty"), counted only for the stretch that
  // matters: after the last wash of that garment, and up to the day being viewed.
  const credits = Store.listLaundryNotDirty(tripKey)
    .filter(r => (r.person || 'him') === person && r.dayKey && r.dayKey <= dayKey);
  const creditFor = (key, since) => credits
    .filter(r => r.key === key && (!since || r.dayKey > since))
    .reduce((n, r) => n + (r.count || 0), 0);
  // Copies already shipped home (a box dated before this day) are not here to wash.
  const shipRecords = Store.listTripsyShipHome(tripKey);
  const out = [];
  for (const [id, qtyPacked] of qtyById) {
    const g = byId.get(id);
    if (!g || !isPerson(g)) continue;
    // Copies away at the laundry on this day are neither clean nor here to re-bag.
    const qty = qtyPacked - tripsyShipHomeQtyBefore(shipRecords, person, 'g:' + id, dayKey) - tripsyLaundryOutOn(laundryRecords, person, 'g:' + id, dayKey);
    if (qty <= 0) continue;
    const { days } = await tripsyWardrobeWearDays(tripKey, id, person);
    const since = lastWashFor('g:' + id);
    const worn = Math.max(0, (days || []).filter(d => d.dayKey && d.dayKey <= dayKey && (!since || d.dayKey > since)).length
      - creditFor('g:' + id, since));
    // Only genuinely DIRTY copies -- one that has not had its full run of wearings yet is
    // still wearable, and putting it in the bag would be washing a clean garment.
    const limit = tripsyWearsBeforeWash(g.name, null, g.group);
    const dirty = tripsyDirtyCopies(worn, limit, qty);
    if (!dirty) continue;
    const futureWears = (days || []).filter(d => d.dayKey && d.dayKey > dayKey).length;
    pushSplit(out, { key: 'g:' + id, name: g.name || 'Garment', driveFileId: g.driveFileId || '',
      typeKey: tripsyGarmentTypeKey(g.name || ''), group: g.group || '' },
      { dirty, qty, limit, worn, futureWears });
  }
  // "No Picture" generic lines count too -- they are real clothes in the bag, they just
  // have no wardrobe record, so they show their type glyph.
  for (const x of (genericRaw || [])) {
    if ((x.person || 'him') !== person) continue;
    const lines = [{ category: x.category, line: x.name }];
    const { days } = tripsyWardrobeWearDaysFromLines(guide, person, lines, x.name || '');
    const sinceX = lastWashFor('x:' + (x.name || ''));
    const worn = Math.max(0, (days || []).filter(d => d.dayKey && d.dayKey <= dayKey && (!sinceX || d.dayKey > sinceX)).length
      - creditFor('x:' + (x.name || ''), sinceX));
    const limitX = tripsyWearsBeforeWash(x.name, x.typeKey, '');
    const qtyX = Math.max(1, x.qty || 1) - tripsyShipHomeQtyBefore(shipRecords, person, 'x:' + (x.name || ''), dayKey) - tripsyLaundryOutOn(laundryRecords, person, 'x:' + (x.name || ''), dayKey);
    if (qtyX <= 0) continue;
    const dirtyX = tripsyDirtyCopies(worn, limitX, qtyX);
    if (!dirtyX) continue;
    const futureWearsX = (days || []).filter(d => d.dayKey && d.dayKey > dayKey).length;
    pushSplit(out, { key: 'x:' + (x.name || ''), name: x.name || 'Item', driveFileId: '',
      typeKey: x.typeKey || tripsyGarmentTypeKey(x.name || ''), group: '' },
      { dirty: dirtyX, qty: qtyX, limit: limitX, worn, futureWears: futureWearsX });
  }
  // Most-dirty first: the pile that actually decides whether you make it.
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return out;
}

const G = (id, name, person, driveFileId) => ({ id, name, person, driveFileId });
const D2 = n => '2026-08-' + String(n).padStart(2, '0');
wardrobe = [
  G('a', 'Blue shirt', 'him', 'photoA'),        // a top: ONE wearing each
  G('b', 'Grey trousers', 'him', ''),           // bottoms: ten wearings before a wash
  G('c', 'Finished-with jacket', 'him', 'photoC'),
  G('d', 'Her dress', 'her', 'photoD'),
  G('e', 'Old shirt', 'him', ''),
];
selection = [
  { id: 'a', qty: 2 }, { id: 'b', qty: 1 }, { id: 'c', qty: 1 }, { id: 'd', qty: 1 }, { id: 'e', qty: 1 },
];
wearByGarment = {
  a: ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-09'], // worn 3x by the 5th, needed again
  b: ['2026-08-04', '2026-08-10'],                             // worn once, needed again
  c: ['2026-08-02', '2026-08-03'],                             // done with -- never again
  d: ['2026-08-03', '2026-08-09'],                             // hers, not his
  e: ['2026-08-02', '2026-08-03'],                             // one-wear top, done with -- dirty but finished
};
generics = [{ person: 'him', category: 'general', name: 'T-shirts', qty: 3, typeKey: 'tee' }];
wearByLine = { 'T-shirts': ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-12'] };

const rows = await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him');
// One garment can now be TWO cards (needed / not-needed sections), so name-keyed
// lookups need to say which -- and totals sum both.
const top = (rs, n) => rs.find(r => r.name === n && r.neededAgain === true);
const nn = (rs, n) => rs.find(r => r.name === n && r.neededAgain === false);
const tot = (rs, n) => rs.filter(r => r.name === n).reduce((s, r) => s + r.count, 0);
const byName = Object.fromEntries(rows.map(r => [r.name, r]));
assert(!!top(rows, 'Blue shirt'), 'a worn-and-needed-again garment is listed on top');
assert(tot(rows, 'Blue shirt') === 2,
  'its total is capped at the copies PACKED, not the days worn -> ' + tot(rows, 'Blue shirt'));
// 2 dirty shirts but only ONE more shirt-day on the schedule: the garment SPLITS --
// one copy genuinely needs washing, the other is optional.
assert(top(rows, 'Blue shirt').count === 1 && nn(rows, 'Blue shirt').count === 1,
  'a straddling garment makes two cards, split by what the schedule still needs');
assert(!byName['Grey trousers'],
  'trousers worn once are NOT dirty -- bottoms take ten wearings, so nothing to wash yet');
assert(!byName['Finished-with jacket'],
  'a jacket is never dirty at all (outerwear is Infinity wears), needed again or not');
// Dirty-but-finished garments are RETURNED now, flagged, for the "Not Needed for
// Trip" section -- no longer silently dropped.
assert(!!nn(rows, 'Old shirt') && !top(rows, 'Old shirt'),
  'a dirty garment not worn again renders ONLY in the not-needed section');
assert(!!top(rows, 'Blue shirt'), 'and a needed-again one has a top card');
assert(!byName['Her dress'], "the other person's clothes are not in this list");
assert(tot(rows, 'T-shirts') === 3,
  'a "No Picture" generic line counts too, capped at its quantity -> ' + tot(rows, 'T-shirts'));
// 3 dirty tees, 2 more tee-days -> wash 2, the third is optional.
assert(top(rows, 'T-shirts').count === 2 && nn(rows, 'T-shirts').count === 1,
  'generics split the same way');
assert(nn(rows, 'T-shirts').key === top(rows, 'T-shirts').key + '::nn',
  "the bottom card's key is the base key suffixed ::nn, so the bag holds them apart");
assert(nn(rows, 'T-shirts').creditKey === top(rows, 'T-shirts').key,
  'but both cards share one creditKey -- washes and credits are per GARMENT');
assert(top(rows, 'Blue shirt').driveFileId === 'photoA', 'a photographed garment carries its file');
assert(top(rows, 'T-shirts').driveFileId === '',
  'and an unphotographed one carries none, so the card falls back to a glyph');
// Most-dirty first.
assert(rows[0].count >= rows[rows.length - 1].count, 'the biggest pile is listed first');

// Nothing worn yet -> nothing to wash.
const early = await tripsyLaundryItemsForDay('T1', '2026-08-01', 'him');
assert(early.length === 0, 'before anything is worn, there is nothing to wash');
// Last day: everything is finished with, so nothing needs washing.
const late = await tripsyLaundryItemsForDay('T1', '2026-08-30', 'him');
assert(late.length > 0 && late.every(r => r.neededAgain === false),
  'at the end of the trip everything dirty is still shown, all in the optional section');
// A selection entry whose garment record is gone must not crash or appear.
// ---- a wash resets the dirty clock, per garment ----
selection = [{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }];
generics = [];
washes = [{ tripKey: 'T1', person: 'him', dayKey: '2026-08-04', washedAt: '2026-08-04T20:00:00Z', bag: { 'g:a': 2 } }];
const afterWash = await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him');
const aw = Object.fromEntries(afterWash.map(r => [r.name, r]));
assert(aw['Blue shirt'] && aw['Blue shirt'].count === 1,
  'only the wears SINCE the wash count -> ' + (aw['Blue shirt'] || {}).count);
assert(!aw['Grey trousers'], 'trousers still are not dirty -- one wearing of ten');
// A wash on the same day as the last wear leaves nothing dirty from before it.
washes = [{ tripKey: 'T1', person: 'him', dayKey: '2026-08-05', washedAt: 'x', bag: { 'g:a': 2 } }];
const sameDay = await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him');
assert(!sameDay.find(r => r.name === 'Blue shirt'), 'washing on the day itself clears it from that day');
// A wash LATER in the trip must not clean the past.
washes = [{ tripKey: 'T1', person: 'him', dayKey: '2026-08-20', washedAt: 'x', bag: { 'g:a': 2 } }];
const future = await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him');
assert(future.find(r => r.name === 'Blue shirt'), 'a future wash does not make today clean');
// An UNWASHED bag (still being gathered) is not a wash.
washes = [{ tripKey: 'T1', person: 'him', dayKey: '2026-08-04', washedAt: null, bag: { 'g:a': 2 } }];
const gathering = await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him');
assert(tot(gathering, 'Blue shirt') === 2,
  'a bag that has not been washed yet changes nothing');
// The other person's wash is not yours.
washes = [{ tripKey: 'T1', person: 'her', dayKey: '2026-08-04', washedAt: 'x', bag: { 'g:a': 2 } }];
assert(tot(await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him'), 'Blue shirt') === 2,
  "the other person's wash does not clean yours");
washes = [];

// ---- "Not Dirty" forgives wearings ----
wardrobe = [G('a', 'Blue shirt', 'him', 'photoA'), G('b', 'Grey trousers', 'him', '')];
selection = [{ id: 'a', qty: 3 }, { id: 'b', qty: 1 }];
generics = []; washes = [];
// Ten wearings cannot happen by day 5 -- one per day -- so the bottoms are checked on
// day 10, where they have just come due, and the top on day 5.
wearByGarment = { a: [D2(1), D2(2), D2(3), D2(9)], b: Array.from({ length: 10 }, (_, i) => D2(i + 1)).concat([D2(12)]) };
let base = await tripsyLaundryItemsForDay('T1', D2(5), 'him');
let bn = Object.fromEntries(base.map(r => [r.name, r]));
assert(tot(base, 'Blue shirt') === 3, 'three wearings of a one-wear top = three dirty in total');
assert(!bn['Grey trousers'], 'five wearings of a ten-wear bottom is not dirty yet');
let tn = Object.fromEntries((await tripsyLaundryItemsForDay('T1', D2(10), 'him')).map(r => [r.name, r]));
assert(tn['Grey trousers'] && tn['Grey trousers'].count === 1, 'ten wearings of a ten-wear bottom = one dirty');

// One shirt forgiven -> two dirty.
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D2(5), key: 'g:a', count: 1 }];
assert(tot(await tripsyLaundryItemsForDay('T1', D2(5), 'him'), 'Blue shirt') === 2,
  'forgiving one wearing clears one dirty top');
// Forgiving all of them takes it off the list entirely.
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D2(5), key: 'g:a', count: 3 }];
bn = Object.fromEntries((await tripsyLaundryItemsForDay('T1', D2(5), 'him')).map(r => [r.name, r]));
assert(!bn['Blue shirt'], 'forgiving every wearing removes it from the list');
// A ten-wear garment just come due: one credit buys exactly one more wearing.
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D2(10), key: 'g:b', count: 1 }];
tn = Object.fromEntries((await tripsyLaundryItemsForDay('T1', D2(10), 'him')).map(r => [r.name, r]));
assert(!tn['Grey trousers'], 'a multi-wear garment gets one more wearing before it is dirty again');
// Credits can never drive the count below zero.
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D2(5), key: 'g:a', count: 99 }];
bn = Object.fromEntries((await tripsyLaundryItemsForDay('T1', D2(5), 'him')).map(r => [r.name, r]));
assert(!bn['Blue shirt'], 'an over-large credit is harmless');
// A credit given BEFORE a wash must not keep suppressing counts after it.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D2(4), washedAt: 'x', bag: { 'g:a': 3 } }];
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D2(2), key: 'g:a', count: 3 }];
wearByGarment.a = [D2(1), D2(2), D2(5), D2(6), D2(9)];
assert(tot(await tripsyLaundryItemsForDay('T1', D2(6), 'him'), 'Blue shirt') === 2,
  'a pre-wash credit is spent and does not suppress later wearings');
// The other person's credit is not yours.
washes = []; notDirty = [{ tripKey: 'T1', person: 'her', dayKey: D2(5), key: 'g:a', count: 3 }];
bn = Object.fromEntries((await tripsyLaundryItemsForDay('T1', D2(6), 'him')).map(r => [r.name, r]));
assert(bn['Blue shirt'], "the other person's credit does not clean yours");
notDirty = []; washes = [];

// ---- the wear limits themselves ----
assert(tripsyWearsBeforeWash('Blue dress shirt') === 1, 'a shirt is dirty after one wearing');
assert(tripsyWearsBeforeWash('Grey trousers') === 10, 'bottoms take ten');
assert(tripsyWearsBeforeWash('Navy blazer') === Infinity, 'tailoring never goes in a wash bag');
// A tie is restyled, not laundered -- it never belongs in a wash bag.
assert(tripsyWearsBeforeWash('', 'tie') === Infinity, 'a tie never goes on the wash list');
assert(tripsyDirtyCopies(9, tripsyWearsBeforeWash('', 'tie'), 4) === 0,
  'however many times it has been worn');
assert(tripsyWearsBeforeWash('', 'dress') === 6, 'a dress, six times');
assert(tripsyWearsBeforeWash('Some unknown thing', '', 'tops') === 1, 'an unknown garment falls back on its GROUP');
assert(tripsyWearsBeforeWash('Some unknown thing', '', 'pants') === 10, 'and the group decides the number');
// The copies-dirty arithmetic.
assert(tripsyDirtyCopies(3, 1, 5) === 3, 'three wearings of a one-wear top = three dirty');
assert(tripsyDirtyCopies(3, 1, 2) === 2, 'capped at the copies packed');
assert(tripsyDirtyCopies(9, 10, 3) === 0, 'nine wearings of a ten-wear bottom = nothing dirty');
assert(tripsyDirtyCopies(20, 10, 3) === 2, 'twenty wearings = two dirty');
assert(tripsyDirtyCopies(5, Infinity, 3) === 0, 'a never-wash garment is never dirty');
assert(tripsyDirtyCopies(0, 1, 3) === 0, 'unworn is not dirty');

selection = [{ id: 'ghost', qty: 2 }];
generics = [];  // isolate: the generic line above would otherwise legitimately still list
assert((await tripsyLaundryItemsForDay('T1', '2026-08-05', 'him')).length === 0,
  'a selection entry whose garment record is gone is skipped, not crashed on');
