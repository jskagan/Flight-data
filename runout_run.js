
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
let wardrobe = [], selection = [], generics = [], washes = [], notDirty = [], wearByGarment = {}, wearByLine = {};
function tripsyShipHomeQtyBefore() { return 0; } // Ship Home stub: nothing shipped
const Store = {
  listWardrobe: async () => wardrobe,
  getTripWardrobe: async () => selection,
  getTripGenericGarments: async () => generics,
  listTripsyLaundry: () => washes,
  listTripsyShipHome: () => [],
  listLaundryNotDirty: () => notDirty,
};
const tripsyNormalizeTripSelection = sel => sel;
const tripsyWardrobeWearDays = async (t, id) => ({ days: (wearByGarment[id] || []).map(d => ({ dayKey: d })) });
const tripsyWardrobeWearDaysFromLines = (g, p, lines) => ({ days: (wearByLine[lines[0].line] || []).map(d => ({ dayKey: d })) });
// Real wear limits by name, defaulting to 1 (a plain shirt) so every EXISTING
// assertion below -- all written against one-wear garments -- is unaffected.
let limitByName = {};
const tripsyWearsBeforeWash = (name) => (limitByName[name] !== undefined ? limitByName[name] : 1);
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
function tripsyLaundryCreditOn(credits, key, dayKey) {
  const base = key.endsWith('::nn') ? key.slice(0, -4) : key;
  return (credits || []).filter(c => c.key === base && c.dayKey === dayKey).reduce((n, c) => n + c.qty, 0);
}
function tripsyLaundryWearDebtStep(wearDebt, { washedQty, credited, wornToday, qty, limit }) {
  let leftoverCredit = 0;
  if (washedQty > 0 || credited > 0) {
    const totalCredit = washedQty * limit + credited;
    const used = Math.min(wearDebt, totalCredit);
    wearDebt -= used;
    leftoverCredit = totalCredit - used;
  }
  if (!wornToday) return { wearDebt, short: false };
  const dirtyNow = Math.min(qty, Math.floor(wearDebt / limit));
  if (qty - dirtyNow > 0) {
    if (leftoverCredit >= limit) return { wearDebt, short: false }; // same-day wash covers this wear too
    return { wearDebt: wearDebt + 1, short: false };
  }
  return { wearDebt, short: true };
}
async function tripsyLaundryRunOutByDay(tripKey, person, guide) {
  const runOut = new Map();
  const washes = Store.listTripsyLaundry(tripKey)
    .filter(r => r.washedAt && (r.person || 'him') === person && r.dayKey);
  // A "Not Dirty" press is real inventory information too -- it should switch on the
  // consequence view exactly like a real wash does, or an owner who only ever presses
  // Not Dirty (never Wash Now) would be stuck seeing the orange advisory forever.
  const notDirty = Store.listLaundryNotDirty(tripKey)
    .filter(r => (r.person || 'him') === person && r.dayKey);
  if (!washes.length && !notDirty.length) return { runOut, lastWorn: new Map(), hasWash: false };
  const [garments, selectedRaw, genericRaw] = await Promise.all([
    Store.listWardrobe(), Store.getTripWardrobe(tripKey), Store.getTripGenericGarments(tripKey),
  ]);
  const dayKeys = ((guide && guide.days) || []).map(d => d.dayKey).filter(Boolean);
  // Clean stock returns on the day the copies come BACK, not the wash day -- until a
  // garment is confirmed received it stays dirty-and-away in this walk, which is exactly
  // what keeps it off the day's available list (tripsyLaundryReturnCredits merges the
  // '::nn' half into its base key, so both halves of a garment come back together).
  const returnCredits = tripsyLaundryReturnCredits(washes, person);
  const washedOn = (key, dayKey) => tripsyLaundryCreditOn(returnCredits, key, dayKey);
  // THE BUG JUST REPORTED: "Not Dirty" forgives wearings on the day-by-day wash list
  // (tripsyLaundryItemsForDay's creditFor), but this SEPARATE forward projection never
  // consulted the credit at all -- so a garment marked Not Dirty today still projected
  // as unavailable in the future. Credits are already sized in WEARING units (see the
  // Not Dirty handler's own comment), so they pay down wearDebt directly, unlike a wash
  // (in copies) which must first be scaled by the limit.
  const creditedOn = (key, dayKey) => notDirty
    .filter(r => r.dayKey === dayKey && (r.key === key || r.key === key + '::nn'))
    .reduce((n, r) => n + (r.count || 0), 0);
  // `lastWorn` rides beside `runOut` (dayKey -> Map(name -> the last day it was worn
  // BEFORE the short day, or null)) so the bar can say when the garment went dirty
  // ("show the last day I wore the item," 2026-10-18); runOut itself stays a plain list of
  // names, which is what every other reader expects.
  const lastWorn = new Map();
  const note = (dayKey, name, lastWornDayKey = null) => {
    if (!runOut.has(dayKey)) runOut.set(dayKey, []);
    if (!runOut.get(dayKey).includes(name)) runOut.get(dayKey).push(name);
    if (!lastWorn.has(dayKey)) lastWorn.set(dayKey, new Map());
    lastWorn.get(dayKey).set(name, lastWornDayKey);
  };
  // WEAR-LIMIT AWARE: a garment isn't dirty after one wearing unless its own limit is 1
  // (tripsyWearsBeforeWash). A tie/tailoring (Infinity -- restyled, never laundered) or a
  // ten-wear pair of trousers must not be projected as "used up" on the first wear, or
  // this flags a run-out day for something that can never actually run out. Per-day
  // arithmetic lives in tripsyLaundryWearDebtStep, shared with tripsyLaundryFindAdjustments.
  // Copies SHIPPED HOME (a box dated before the day) leave the clean stock: qty shrinks
  // from the day after the box goes, so a garment worn after it was posted home is a
  // genuine shortage -- and the ship-home screen itself is what stops that happening.
  const shipRecords = Store.listTripsyShipHome(tripKey);
  const walk = (key, name, qtyPacked, wornDays, limit) => {
    const worn = new Set(wornDays);
    const lastWornBefore = dayKey => wornDays.filter(d => d && d < dayKey).sort().pop() || null;
    let wearDebt = 0;
    for (const dayKey of dayKeys) {
      const qty = qtyPacked - tripsyShipHomeQtyBefore(shipRecords, person, key, dayKey);
      if (qty <= 0) { if (worn.has(dayKey)) { note(dayKey, name, lastWornBefore(dayKey)); return; } continue; }
      if (!(limit > 0) || !isFinite(limit)) continue; // can never go dirty -- can never run out
      const step = tripsyLaundryWearDebtStep(wearDebt, {
        washedQty: washedOn(key, dayKey), credited: creditedOn(key, dayKey),
        wornToday: worn.has(dayKey), qty, limit,
      });
      wearDebt = step.wearDebt;
      if (step.short) { note(dayKey, name, lastWornBefore(dayKey)); return; } // the FIRST day it runs short is the one worth flagging
    }
  };
  const byId = new Map((garments || []).map(g => [g.id, g]));
  const qtyById = new Map();
  for (const e of tripsyNormalizeTripSelection(selectedRaw)) qtyById.set(e.id, (qtyById.get(e.id) || 0) + e.qty);
  for (const [id, qty] of qtyById) {
    const g = byId.get(id);
    if (!g || (g.person || 'him') !== person) continue;
    const { days } = await tripsyWardrobeWearDays(tripKey, id, person);
    walk('g:' + id, g.name || 'Garment', qty, (days || []).map(d => d.dayKey).filter(Boolean),
      tripsyWearsBeforeWash(g.name, null, g.group));
  }
  for (const x of (genericRaw || [])) {
    if ((x.person || 'him') !== person) continue;
    const { days } = tripsyWardrobeWearDaysFromLines(guide, person, [{ category: x.category, line: x.name }], x.name || '');
    walk('x:' + (x.name || ''), x.name || 'Item', Math.max(1, x.qty || 1), (days || []).map(d => d.dayKey).filter(Boolean),
      tripsyWearsBeforeWash(x.name, x.typeKey, ''));
  }
  return { runOut, lastWorn, hasWash: true };
}

const D = n => '2026-08-' + String(n).padStart(2, '0');
const guide = { days: Array.from({ length: 10 }, (_, i) => ({ dayKey: D(i + 1) })) };
wardrobe = [{ id: 'a', name: 'Blue shirt', person: 'him' }];
selection = [{ id: 'a', qty: 2 }];

// ---- before any wash, this says nothing at all ----
washes = [];
wearByGarment = { a: [D(1), D(2), D(3), D(4)] };
let r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.hasWash === false && r.runOut.size === 0,
  'with no wash recorded it reports nothing -- the guide\'s own advice still stands');

// ---- after a wash, it projects the clean stock forward ----
// 2 shirts. Worn days 1,2 (both dirty), washed on day 3, worn 3,4,5.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 2 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.hasWash === true, 'a recorded wash switches the projection on');
assert(r.runOut.get(D(5)) && r.runOut.get(D(5)).includes('Blue shirt'),
  'the wash covers days 3 and 4, so it runs out on day 5 -> ' + JSON.stringify([...r.runOut]));
assert(r.runOut.size === 1, 'and only the FIRST short day is flagged, not every one after it');
assert(r.lastWorn && r.lastWorn.get(D(5)) && r.lastWorn.get(D(5)).get('Blue shirt') === D(4),
  'THE ASK (2026-10-18): the short day records the LAST day the garment was worn before it (day 4) -> ' + JSON.stringify([...(r.lastWorn.get(D(5)) || new Map())]));

// ---- washing enough means never running out ----
washes = [
  { tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 2 } },
  { tripKey: 'T1', person: 'him', dayKey: D(5), washedAt: 'x', bag: { 'g:a': 2 } },
];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'washing again in time means it never runs short');

// ---- a wash only returns what was actually DIRTY ----
// One shirt washed on day 3 while two are dirty: only one comes back.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 1 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(4)), 'washing one of two runs out a day earlier -> ' + JSON.stringify([...r.runOut]));

// ---- washing more than is dirty cannot conjure extra copies ----
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(2), washedAt: 'x', bag: { 'g:a': 9 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5), D(6)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 1, 'an over-large wash is capped at what was dirty, so it still runs out');

// ---- the other person's clothes and washes are not yours ----
wardrobe = [{ id: 'a', name: 'Blue shirt', person: 'her' }];
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 2 } }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, "her garments are not projected on his page");
wardrobe = []; washes = [];

// ---- THE BUG JUST REPORTED: "Not Dirty" forgives wearings on the day-by-day wash
// list, but this SEPARATE forward projection never consulted it -- so a garment
// marked Not Dirty still projected as running out in the future. A real trip hit
// this on Undershirts: 5 packed, worn 5 times by day 5 with no wash ever touching
// them, but 3 were marked Not Dirty on day 5 -- which should push the run-out day
// out, not leave it exactly where it was.
wardrobe = [{ id: 'a', name: 'Blue shirt', person: 'him' }];
selection = [{ id: 'a', qty: 5 }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5)] };
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D(5), key: 'g:a', count: 3 }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'a Not Dirty credit averts a run-out day exactly like a wash would');
// A credit dated AFTER the run-out day cannot retroactively fix a day already past.
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D(6), key: 'g:a', count: 3 }];
selection = [{ id: 'a', qty: 4 }]; // one fewer copy so it runs dry on day 5 without help
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(5)), 'a credit recorded on a LATER day does not reach back and fix an earlier one -> ' + JSON.stringify([...r.runOut]));
// A Not-Dirty-only session (no real wash at all) still switches on the projection --
// the credit is real inventory information, just like a wash is.
washes = [];
notDirty = [{ tripKey: 'T1', person: 'him', dayKey: D(1), key: 'g:a', count: 1 }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.hasWash === true, 'a Not Dirty credit alone switches on the run-out projection, same as a real wash');
selection = [{ id: 'a', qty: 5 }]; notDirty = [];

// ---- several garments running short on the SAME day are separate entries ----
wardrobe = [
  { id: 'a', name: 'Blue shirt', person: 'him' },
  { id: 'b', name: 'Grey trousers', person: 'him' },
];
selection = [{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }];
wearByGarment = { a: [D(1), D(2)], b: [D(1), D(2)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(1), washedAt: 'x', bag: {} }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(2)) && r.runOut.get(D(2)).length === 2,
  'both garments are recorded against that day, as separate names -> ' + JSON.stringify(r.runOut.get(D(2))));
// Each still appears only ONCE, on its own first short day.
const allNames = [...r.runOut.values()].flat();
assert(new Set(allNames).size === allNames.length, 'and no garment is flagged twice across the trip');

// ---- generic "No Picture" lines are projected too ----
wardrobe = []; selection = [];
generics = [{ person: 'him', category: 'general', name: 'T-shirts', qty: 1 }];
wearByLine = { 'T-shirts': [D(1), D(2), D(3)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(2), washedAt: 'x', bag: { 'x:T-shirts': 1 } }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(3)) && r.runOut.get(D(3)).includes('T-shirts'),
  'a generic line runs out too -> ' + JSON.stringify([...r.runOut]));

// ---- THE BUG JUST REPORTED: a garment with a real wear limit above 1 must not be
// projected as "used up" after a single wearing. Before this fix, walk() ignored the
// limit entirely and treated every wearing as making a copy dirty -- so a tie
// (Infinity, restyled rather than laundered) was wrongly flagged as running out.
limitByName = { 'Silk tie': Infinity };
wardrobe = [{ id: 'a', name: 'Silk tie', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
generics = []; // clear the previous test's leftover "T-shirts" line -- it would
                // otherwise still be walked (at the default 1-wear limit) and pollute runOut
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5), D(6), D(7)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(4), washedAt: 'x', bag: {} }]; // some OTHER wash, just to turn projection on
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'a tie worn every day never runs out -- it is restyled, not laundered');

// A ten-wear pair of trousers similarly must not be flagged after wear #2.
limitByName = { 'Grey trousers': 10 };
wardrobe = [{ id: 'a', name: 'Grey trousers', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
wearByGarment = { a: [D(1), D(2)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'two wearings of a ten-wear garment is nowhere near dirty');

// But it DOES still run out once genuinely worn past its limit, unwashed: a limit-3
// garment worn 4 STRAIGHT days (with a wash recorded elsewhere just to arm the
// projection) comes up short on the 4th wearing -- 3 is fine, a 4th needs a clean copy
// that does not exist yet.
limitByName = { 'Grey trousers': 3 };
wardrobe = [{ id: 'a', name: 'Grey trousers', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
generics = [];
wearByGarment = { a: [D(1), D(2), D(3), D(4)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(9), washedAt: 'x', bag: {} }]; // arms the projection without touching this key
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(4)), 'a 3-wear-limit garment worn 4 straight days runs out on the 4th -> ' + JSON.stringify([...r.runOut]));

// A wash genuinely pushes that day back out, by exactly the copies it actually
// returned -- not by resetting the whole counter (which would let washing ONE of
// several dirty copies wrongly launder them all).
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 1 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5), D(6)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(6)) && !r.runOut.get(D(4)) && !r.runOut.get(D(5)),
  'a wash mid-run pushes the run-out day out (day 4 -> day 6), never resetting further than what it actually cleaned -> ' + JSON.stringify([...r.runOut]));

// An over-large wash on the SAME DAY as its own first wearing now forgives THAT ONE
// wearing (see tripsyLaundryWearDebtStep -- "worn, then washed later that day" is as
// plausible as "washed, then worn"), pushing the run-out day out by exactly one
// wearing -- but claiming to wash 99 copies of a garment worn only once so far still
// cannot conjure MORE than that single day's relief; the trip still runs out, just one
// wearing later than it would have with no wash at all.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(1), washedAt: 'x', bag: { 'g:a': 99 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(5)) && !r.runOut.get(D(4)),
  'an over-large same-day wash forgives only its own day\'s wearing, not a full reset -> ' + JSON.stringify([...r.runOut]));

// THE REPORTED BUG, reproduced directly: a garment worn ONCE, washed the SAME day
// (exactly the copy that was just worn -- qty 1, washed 1, nothing dirty before that
// day), then worn again several days later with no wash in between. Before this fix,
// the wash's credit had zero prior debt to pay down and was silently discarded, so the
// later wearing came up short even though the garment was genuinely clean.
limitByName = { 'Cream Linen Shirt': 1 };
wardrobe = [{ id: 'a', name: 'Cream Linen Shirt', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(1), washedAt: 'x', bag: { 'g:a': 1 } }];
wearByGarment = { a: [D(1), D(6)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0,
  'THE BUG: worn once then washed the same day is genuinely clean for its next wearing days later -> ' + JSON.stringify([...r.runOut]));
