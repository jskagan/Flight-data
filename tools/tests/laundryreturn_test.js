// "After I select wash now, add a button to later days for when I get the washed items
// back. When I select that button, open up the list of items I sent to wash so I can check
// them off individually to confirm I got them back. After an item is confirmed received
// back, then update the dress guides to make those items available" (2026-10-18).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const api = new Function([fnSource('tripsyLaundryBagBaseCounts'), fnSource('tripsyLaundryReturnCredits'), fnSource('tripsyLaundryCreditOn'),
  fnSource('tripsyLaundryLastReturnDay'), fnSource('tripsyLaundryOutstandingByWash'), fnSource('tripsyLaundryOutOn'), fnSource('tripsyLaundryWearDebtStep'),
  'return { credits: tripsyLaundryReturnCredits, on: tripsyLaundryCreditOn, last: tripsyLaundryLastReturnDay, outstanding: tripsyLaundryOutstandingByWash, outOn: tripsyLaundryOutOn, step: tripsyLaundryWearDebtStep };'].join('\n'))();

const D = n => `2026-10-${String(n).padStart(2, '0')}`;
// A wash on day 18 of 3 shirts (2 from the main card + 1 from "not needed"), awaiting return.
const washed = { tripKey: 'T', person: 'him', dayKey: D(18), washedAt: 'x', awaitingReturn: true, returned: {}, bag: { 'g:s': 2, 'g:s::nn': 1, 'g:p': 1 } };
// ---- before anything comes back ----
{
  const recs = [washed];
  assert(api.credits(recs, 'him').length === 0, 'THE ASK: a washed-but-not-returned garment earns NO clean credit yet');
  assert(api.outOn(recs, 'him', 'g:s', D(19)) === 3 && api.outOn(recs, 'him', 'g:s::nn', D(19)) === 3, 'all three shirts are away at the laundry on day 19 (either half of the key)');
  assert(api.outOn(recs, 'him', 'g:s', D(17)) === 0, 'nothing is away before the wash');
  const o = api.outstanding(recs, 'him');
  assert(o.get(D(18)) && o.get(D(18)).total === 4 && o.get(D(18)).byKey.get('g:s') === 3, 'the wash shows 4 pieces outstanding -> the "Laundry back" button on later days');
  assert(api.last(api.credits(recs, 'him'), 'g:s', D(25)) === null, 'the clock has not reset: no return yet');
}
// ---- two shirts confirmed back on day 20 ----
{
  const recs = [{ ...washed, returned: { 'g:s': { qty: 2, dayKey: D(20) } } }];
  const c = api.credits(recs, 'him');
  assert(api.on(c, 'g:s', D(20)) === 2 && api.on(c, 'g:s', D(18)) === 0, 'THE ASK: the credit lands on the RETURN day (20), not the wash day (18)');
  assert(api.outOn(recs, 'him', 'g:s', D(19)) === 3 && api.outOn(recs, 'him', 'g:s', D(20)) === 1 && api.outOn(recs, 'him', 'g:p', D(20)) === 1, 'one shirt and the polo are still away after the partial return');
  assert(api.last(c, 'g:s', D(21)) === D(20) && api.last(c, 'g:s', D(19)) === null, 'the clock resets on the return day, and not for a day before it');
  const o = api.outstanding(recs, 'him');
  assert(o.get(D(18)).total === 2, 'the button count drops to what is still out');
  // The run-out walk: 3 shirts, 1-wear limit, worn 15/16/17 (all dirty), washed 18, back 20, worn 19 and 21.
  let debt = 3, short19, short21;
  ({ wearDebt: debt, short: short19 } = api.step(debt, { washedQty: api.on(c, 'g:s', D(19)), credited: 0, wornToday: true, qty: 3, limit: 1 }));
  ({ wearDebt: debt } = api.step(debt, { washedQty: api.on(c, 'g:s', D(20)), credited: 0, wornToday: false, qty: 3, limit: 1 }));
  ({ wearDebt: debt, short: short21 } = api.step(debt, { washedQty: api.on(c, 'g:s', D(21)), credited: 0, wornToday: true, qty: 3, limit: 1 }));
  assert(short19 === true && short21 === false, 'THE ASK: worn on day 19 (still at the laundry) is short; worn on day 21 (two came back on 20) is fine');
}
// ---- everything back: the button retires ----
{
  const recs = [{ ...washed, returned: { 'g:s': { qty: 3, dayKey: D(20) }, 'g:p': { qty: 1, dayKey: D(21) } } }];
  assert(api.outstanding(recs, 'him').size === 0, 'a fully returned wash drops off the later days');
  assert(api.outOn(recs, 'him', 'g:p', D(21)) === 0 && api.outOn(recs, 'him', 'g:p', D(20)) === 1, 'the polo is away through day 20 and back on 21');
  const over = [{ ...washed, returned: { 'g:s': { qty: 9, dayKey: D(20) } } }];
  assert(api.on(api.credits(over, 'him'), 'g:s', D(20)) === 3, 'a return is capped at what went in');
}
// ---- a wash from before returns existed is unchanged: back on its wash day ----
{
  const legacy = [{ tripKey: 'T', person: 'him', dayKey: D(10), washedAt: 'x', bag: { 'g:s': 2, 'g:s::nn': 1 } }];
  const c = api.credits(legacy, 'him');
  assert(api.on(c, 'g:s', D(10)) === 3 && api.on(c, 'g:s::nn', D(10)) === 3, 'legacy wash: full credit on the wash day, both halves merged');
  assert(api.outstanding(legacy, 'him').size === 0 && api.outOn(legacy, 'him', 'g:s', D(11)) === 0, 'legacy wash: nothing outstanding, nothing away');
  assert(api.credits(legacy, 'her').length === 0, "the other person's wash is not yours");
}
// ---- the writers and the screens ----
const store = html.slice(html.indexOf('async washTripsyLaundryBag('), html.indexOf('listTripsyShipHome(tripKey)'));
assert(/rec\.awaitingReturn = true;\n\s*rec\.returned = \{\};/.test(store), 'Wash Now marks the bag awaiting return');
assert(/async markTripsyLaundryReturned\(tripKey, person, washDayKey, key, qty, returnDayKey\)/.test(store) && /Math\.min\(sent, \(prev\.qty \|\| 0\) \+ \(Number\(qty\) \|\| 0\)\)/.test(store),
  'a return is recorded per base key, accumulating and capped at what went in');
const washedDay = fnSource('showTripsyWashedDay');
assert(/data-laundry-received="\$\{esc\(it\.key\)\}"/.test(washedDay) && /✓ Received/.test(washedDay), 'THE ASK: the washed list offers a Received button per garment');
assert(/title: 'How many came back\?'/.test(washedDay), 'several copies ask how many came back');
assert(/Store\.markTripsyLaundryReturned\(tripKey, person, dayKey, it\.key, n, collectDayKey\)/.test(washedDay) && /showTripsyWashedDay\(tripKey, dayKey, person, opts\)/.test(washedDay),
  'a confirmation is written against the wash, dated the day it was confirmed from, and the screen rebuilds');
assert(/const collectDayKey = opts\.collectDayKey \|\| dayKey;/.test(washedDay), 'the return day is the day whose button opened the list (the wash day itself from Washed Today)');
const dg = fnSource('renderTripsyDressGuideInto');
assert(/const collectBtns = \(isOwner && isToday\) \? \[\.\.\.outstandingByWash\.entries\(\)\]\n\s*\.filter\(\(\[washDay\]\) => washDay < day\.dayKey\)/.test(dg) && /🧺 Laundry back · \$\{o\.total\} out/.test(dg),
  'THE ASK (revised same day): the "Laundry back · N out" button shows on TODAY only, for an earlier wash still outstanding -- returns are confirmed the day they happen');
assert(/data-tripsy-laundry-collect="\$\{esc\(washDay\)\}" data-tripsy-collect-day="\$\{esc\(day\.dayKey\)\}"/.test(dg), 'the button carries the wash it belongs to and the day it is pressed from');
assert(/showTripsyWashedDay\(guide\.tripKey, el\.getAttribute\('data-tripsy-laundry-collect'\), person, \{\n\s*collectDayKey: el\.getAttribute\('data-tripsy-collect-day'\), onChanged: refreshLaundryInfo,/.test(dg),
  'pressing it opens that wash\'s list, and a confirmation recomputes the guide (run-out bar, availability)');
assert(/showTripsyWashedDay\(guide\.tripKey, dayKey, person, \{ collectDayKey: dayKey, onChanged: refreshLaundryInfo \}\)/.test(dg), 'Washed Today also lets a same-day return be confirmed');
// ---- every availability reader credits the RETURN day ----
for (const fn of ['tripsyLaundryRunOutByDay', 'tripsyLaundryFindAdjustments']) {
  const src = fnSource(fn);
  assert(/tripsyLaundryReturnCredits\(washes, person\)/.test(src) && /tripsyLaundryCreditOn\(returnCredits, /.test(src), `${fn} credits clean stock on the return day`);
}
const items = fnSource('tripsyLaundryItemsForDay');
assert(/tripsyLaundryLastReturnDay\(returnCredits, key, dayKey\)/.test(items) && (items.match(/tripsyLaundryOutOn\(laundryRecords, person, /g) || []).length === 2,
  'the laundry list resets a garment\'s clock on its return and leaves copies still away out of the day\'s pile');
assert((html.match(/tripsyLaundryLastReturnDay\(returnCredits, 'g:' \+ id, null\)/g) || []).length === 2, 'both ship-home readers key on the return day too');

// ---- the adjustments finder honours the owner's picks (2026-10-18) ----
const finder = fnSource('tripsyLaundryFindAdjustments');
assert(/const decided = \(opts && opts\.decided instanceof Map\) \? opts\.decided : new Map\(\);/.test(finder), 'the finder takes the dialog\'s decisions');
assert(/if \(decided\.has\(id\)\) \{[\s\S]*?usable = chosenId \? \(candidates\.find\(c => c\.id === chosenId\) \|\| null\) : null;/.test(finder),
  'a decided garment takes exactly the chosen replacement (or none), not the least-worn default');
assert(/alternatives: ranked\.filter\(a => a\.id !== usable\.id\), decided: decided\.has\(id\)/.test(finder), 'each proposal carries the other clean candidates, least-worn first, for "Choose another"');
assert(finder.indexOf('claimed.add(usable.id)') < finder.indexOf('proposals.push('), 'a chosen garment is claimed before the next row is judged, so later suggestions never reuse it');
