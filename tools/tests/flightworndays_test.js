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
assert(ordinary.days.length === 4, 'and correctly spans every casual day on the trip -> ' + ordinary.days.length);

// No departing flight at all -> the flight-worn line resolves to zero wear days
// rather than throwing or silently falling back to the tier-wide behavior.
const noFlightGuide = { days: [{ dayKey: '2026-08-14', events: [{ id: 'ev1', name: 'Casual lunch', category: 'casual', displayCategory: 'casual' }] }], packingList: { him: [] } };
const noFlight = tripsyWardrobeWearDaysFromLines(noFlightGuide, 'him', line, 'Navy Henley');
assert(noFlight.days.length === 0, 'no departing flight in the guide -> zero wear days for the flight-worn line, not a crash');
