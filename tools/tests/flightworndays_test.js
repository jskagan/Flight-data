// "Why is there a message saying the navy Henley is dirty on 8/19" -- the Henley was
// selected for the flight-worn companion line ("Top — wearing on the flight"), which
// still carries a real dress-code category (whatever tier the departing flight is).
// tripsyWardrobeWearDaysFromLines didn't special-case that: it fell through to the
// TIER rule ("worn whenever you're dressed at that level"), which returned EVERY
// casual-tier event across the WHOLE TRIP as a wear day for this one physical shirt --
// even though it's really worn exactly once, on the flight. With a top's 1-wearing
// limit, that bogus multi-day wear count tripped "dirty"/"run out" almost immediately,
// on whatever day the second bogus casual occasion fell -- not a real laundry problem
// at all. Fixed: a flight-worn line now resolves to exactly the departure flight event.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
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
function extractConst(name) {
  const start = html.indexOf(`const ${name} = `);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const asVar = (fnName, src) => src.replace(new RegExp(`^function ${fnName}`), `var ${fnName} = function`);
const asVarConst = src => src.replace(/^const /, 'var ');
eval(asVarConst(extractConst('TRIPSY_FLIGHT_WORN_SUFFIX')));
eval(asVarConst(extractConst('TRIPSY_WARDROBE_GENERAL_TIER')));
eval(asVarConst(extractConst('TRIPSY_WARDROBE_GYM_TIER')));
eval(asVarConst(extractConst('TRIPSY_ATTIRE_ITEMIZED_CATEGORIES')));
eval(asVar('tripsyWardrobeLineIsFlightWorn', extractFn('tripsyWardrobeLineIsFlightWorn')));
eval(asVar('tripsyWardrobeFlightDepartureEvent', extractFn('tripsyWardrobeFlightDepartureEvent')));
eval(asVar('tripsyGarmentTypeKey', extractFn('tripsyGarmentTypeKey')));
eval(asVar('tripsyWearDaysGroupByDay', extractFn('tripsyWearDaysGroupByDay')));
eval(asVar('tripsyWardrobeWearDaysFromLines', extractFn('tripsyWardrobeWearDaysFromLines')));

// A trip that starts with a casual flight, then has several MORE casual events on
// later days -- exactly the shape that tripped the bug (a top worn "at every casual
// event" once it fell through to the tier rule).
const guide = {
  days: [
    { dayKey: '2026-08-14', events: [{ id: 'flight1', resource: 'transportation', name: 'Flight from LAX to LHR', category: 'casual', displayCategory: 'casual' }] },
    { dayKey: '2026-08-16', events: [{ id: 'ev2', name: 'Casual lunch', category: 'casual', displayCategory: 'casual' }] },
    { dayKey: '2026-08-19', events: [{ id: 'ev3', name: 'Casual walk', category: 'casual', displayCategory: 'casual' }] },
    { dayKey: '2026-08-21', events: [{ id: 'ev4', name: 'Casual dinner', category: 'casual', displayCategory: 'casual' }] },
  ],
  packingList: { him: [] },
};

const line = [{ category: 'casual', line: 'Top — wearing on the flight' }];
const result = tripsyWardrobeWearDaysFromLines(guide, 'him', line, 'Navy Scotch & Soda Henley Shirt');

assert(result.basis === 'flight', 'basis is reported as "flight", not the tier fallback -> ' + result.basis);
assert(result.days.length === 1, `THE FIX: exactly ONE wear day, not every casual event trip-wide -> got ${result.days.length}`);
assert(result.days[0] && result.days[0].dayKey === '2026-08-14', 'and it is the DEPARTURE day, not 8/19 or any later casual day -> ' + (result.days[0] && result.days[0].dayKey));
assert(!result.days.some(d => d.dayKey === '2026-08-19'), '8/19 is NOT a wear day for this shirt -- it was never actually worn that day');

// Sanity: an ORDINARY casual line (not flight-worn) still gets the old tier-wide
// behavior on purpose -- a real casual top genuinely is worn at every casual event.
const ordinaryLine = [{ category: 'casual', line: 'Casual tops' }];
const ordinary = tripsyWardrobeWearDaysFromLines(guide, 'him', ordinaryLine, 'Blue Polo');
assert(ordinary.basis === 'tier', 'an ordinary line still uses the tier rule -> ' + ordinary.basis);
assert(ordinary.days.length === 3 && !ordinary.days.some(d => d.dayKey === '2026-08-14'), 'and spans every casual day EXCEPT the departing flight, which the flight-worn garments wear (2026-11-10) -> ' + ordinary.days.length);
// Garments sharing a line take the tier's days in turn ("multiple sets of dirty clothes when
// there should have been one set at most for the flight," 2026-11-10), and a dressier spare
// covers a day the line cannot ("Allow a dressier item to substitute for a less dressy item").
const turnsFn = new Function('TRIPSY_ATTIRE_CATEGORY_ORDER', 'TRIPSY_WARDROBE_GENERAL_TIER', 'TRIPSY_WARDROBE_GYM_TIER',
  'tripsyWardrobeFlightDepartureEvent', 'tripsyWardrobeLineIsFlightWorn', 'tripsyWearsBeforeWash', 'tripsyOutfitGarmentRoles',
  extractFn('tripsyGarmentWearableAtTier') + '\n' + extractFn('tripsyWardrobeTierTurns') + '\nreturn { tripsyWardrobeTierTurns, tripsyGarmentWearableAtTier };')(
  ['athletic', 'casual', 'smart_casual', 'semi_formal', 'cocktail', 'formal', 'black_tie'], 'general', 'gym',
  () => null, l => /wearing on the flight/.test(l), () => 1, () => ['tops']);
const tg = { days: ['01', '02', '03', '04'].map(d => ({ dayKey: '2030-06-' + d, events: [{ id: 'e' + d, category: d === '04' ? 'smart_casual' : 'casual' }] })) };
const tById = new Map([['a', { id: 'a', name: 'Polo A' }], ['b', { id: 'b', name: 'Polo B' }], ['c', { id: 'c', name: 'Shirt C' }], ['d', { id: 'd', name: 'Shirt D' }]]);
const tSel = [{ id: 'a', category: 'casual', line: 'tops', qty: 1 }, { id: 'b', category: 'casual', line: 'tops', qty: 1 },
  { id: 'c', category: 'smart_casual', line: 'shirts', qty: 1 }, { id: 'd', category: 'smart_casual', line: 'shirts', qty: 1 }];
const tt = turnsFn.tripsyWardrobeTierTurns(tg, 'him', tSel, tById);
const daysFor = k => (tt.get(k) || []).map(t => t.dayKey.slice(-2) + ':' + t.category).join(',');
assert(daysFor('a::casual::tops') === '01:casual' && daysFor('b::casual::tops') === '02:casual', 'two casual tops take the first two casual days, one each');
assert(daysFor('c::smart_casual::shirts') === '04:smart_casual' && daysFor('d::smart_casual::shirts') === '03:casual',
  'THE ASK: the third casual day goes to the spare smart casual shirt, not to a re-worn casual top -> ' + daysFor('c::smart_casual::shirts') + ' / ' + daysFor('d::smart_casual::shirts'));
const tt2 = turnsFn.tripsyWardrobeTierTurns(tg, 'him', tSel.slice(0, 3), tById);
assert((tt2.get('a::casual::tops') || []).length === 2, 'with nothing dressier spare, the line re-wears its own piece');
const W = turnsFn.tripsyGarmentWearableAtTier;
assert(W({ tiers: ['smart_casual'] }, 'casual') && W({ tiers: ['casual'] }, 'casual') && !W({ tiers: ['casual'] }, 'smart_casual') && !W({ tiers: ['formal'] }, 'athletic') && !W({ tiers: [] }, 'casual'),
  'a garment is wearable at its own dress code or a less dressy one, never a dressier one, and nothing dressier stands in for athletic');
const viaTurns = tripsyWardrobeWearDaysFromLines(guide, 'him', ordinaryLine, 'Blue Polo', { turns: () => [{ dayKey: ordinary.days[0].dayKey, category: 'casual' }] });
assert(viaTurns.days.length === 1 && viaTurns.days[0].dayKey === ordinary.days[0].dayKey, 'a garment given its turns is worn on exactly those days');
assert(/const allTurns = tripsyWardrobeTierTurns\(guide, person, resolved, byId\);/.test(html), 'a real garment is given its turns among everything picked');
for (const fn of ['tripsyOutfitSwapCandidates', 'tripsyOutfitAddCandidates', 'tripsyAttireBlockShortfall'])
  assert(/tripsyGarmentWearableAtTier\(g, (liveTier|tier)\)/.test(extractFn(fn)), fn + ' accepts a dressier garment');

// No departing flight at all -> the flight-worn line resolves to zero wear days
// rather than throwing or silently falling back to the tier-wide behavior.
const noFlightGuide = { days: [{ dayKey: '2026-08-14', events: [{ id: 'ev1', name: 'Casual lunch', category: 'casual', displayCategory: 'casual' }] }], packingList: { him: [] } };
const noFlight = tripsyWardrobeWearDaysFromLines(noFlightGuide, 'him', line, 'Navy Henley');
assert(noFlight.days.length === 0, 'no departing flight in the guide -> zero wear days for the flight-worn line, not a crash');

assert(/use one listed for a DRESSIER dress code instead — e\.g\. a smart casual top for a casual block/.test(html) && /Never the reverse/.test(html), 'the outfit composer may use a dressier garment only when the block\'s own are unavailable (2026-11-10)');
