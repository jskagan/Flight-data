// "When there is a day spent entirely in the air flying, on the itinerary
// page display that day as 'In-flight' and show the origin, destination,
// and flight number" (2026-09-28). The real case: SQ23 departs JFK 22:15
// Oct 6 and lands SIN 05:30 Oct 8 -- all of Oct 7 is airborne, and it used
// to render as a bare "No events scheduled" block. tripsyInFlightInfoForDay
// judges it from the trip's RAW transportation stamps (the expanded
// timeline rows land only on the endpoint days, which is exactly why the
// middle day is event-less), and ONE shared segmentation feeds both Part
// 1's day blocks and Part 2's dividers so the two can never disagree.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
  if (!m) return null;
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

// ---- executed: the detector ----
const env = new Function(`
  ${extractFn('tripsyInFlightInfoForDay')}
  ${extractFn('tripsyInFlightDetailText')}
  return { tripsyInFlightInfoForDay, tripsyInFlightDetailText };
`)();

const flight = (over = {}) => ({
  summary: 'Flight from JFK to SIN • Singapore Airlines SQ23',
  hidden: false,
  tripsyRaw: {
    resource: 'transportation', category: 'airplane',
    company: 'Singapore Airlines', transportNumber: 'SQ23',
    departureDescription: 'JFK', arrivalDescription: 'SIN',
    departureAt: '2026-10-06T22:15:00', arrivalAt: '2026-10-08T05:30:00',
    ...over.raw,
  },
  ...over.ev,
});
const trip = evs => ({ key: 't', events: evs });

{
  const info = env.tripsyInFlightInfoForDay('2026-10-07', trip([flight()]));
  assert(!!info && info.origin === 'JFK' && info.destination === 'SIN' && info.flightLabel === 'Singapore Airlines SQ23',
    'THE ASK: the day between departure and arrival reads as in-flight with origin, destination and flight number');
  assert(env.tripsyInFlightDetailText(info) === 'JFK → SIN • Singapore Airlines SQ23',
    'the one-line detail reads "JFK → SIN • Singapore Airlines SQ23"');
}
assert(env.tripsyInFlightInfoForDay('2026-10-06', trip([flight()])) === null
  && env.tripsyInFlightInfoForDay('2026-10-08', trip([flight()])) === null,
  'the departure and arrival days themselves are NOT in-flight days -- they have real rows and are not spent entirely in the air');
assert(env.tripsyInFlightInfoForDay('2026-10-07', trip([flight({ ev: { hidden: true } })])) === null,
  'a hidden flight marks nothing');
assert(env.tripsyInFlightInfoForDay('2026-10-07', trip([flight({ ev: { summary: 'Car from A to B' }, raw: { category: 'car' } })])) === null,
  'a multi-day non-flight transportation leg is not "in the air"');
{
  // Endpoints fall back to the summary halves when the raw descriptions are absent.
  const info = env.tripsyInFlightInfoForDay('2026-10-07', trip([flight({ raw: { departureDescription: null, arrivalDescription: null } })]));
  assert(!!info && info.origin === 'JFK' && info.destination === 'SIN',
    'missing raw endpoints fall back to the summary’s "Flight from X to Y" halves');
}
{
  const info = env.tripsyInFlightInfoForDay('2026-10-07', trip([flight({ raw: { company: null, transportNumber: null } })]));
  assert(!!info && env.tripsyInFlightDetailText(info) === 'JFK → SIN',
    'no flight number degrades to just the route, never a dangling separator');
}
assert(env.tripsyInFlightInfoForDay('2026-10-07', trip([flight({ raw: { departureAt: null } })])) === null
  && env.tripsyInFlightInfoForDay('2026-10-07', { key: 't' }) === null,
  'malformed stamps or a trip with no events fail closed');

// ---- wiring: one segmentation, both parts ----
const build = extractFn('buildTripsyPrintHtml');
assert(/type: 'inflight', dayKey, inFlight: inFlightFor\(dayKey\)/.test(build)
  && /!eventDayKeySet\.has\(tripsyFullDayKeys\[j\]\) && !inFlightFor\(tripsyFullDayKeys\[j\]\)/.test(build),
  'the day walk breaks an empty RUN at an in-flight day, which gets its own segment');
assert(/const tripsyDetailedDaySegments = \[\.\.\.tripsyDaySegments\];/.test(build),
  'Part 2 reuses the SAME segments Part 1 was built from -- the two parts cannot disagree');
assert(/✈️ In-flight/.test(build)
  && /tripsySummaryInFlightBlockHtml\(seg\.dayKey, seg\.inFlight\)/.test(build),
  'Part 1 renders the in-flight day as its own labeled block');
assert((build.match(/tripsyDetailedInFlightBlockHtml\(seg\.dayKey, seg\.inFlight\)/g) || []).length === 2,
  'BOTH Part 2 branches (narrative and flat fallback) render the in-flight divider');
assert(/tripsyDetailedInFlightBlockHtml = \(dayKey, info\) => \{[\s\S]*?id="tp-detail-day-\$\{esc\(dayKey\)\}"/.test(build),
  'the Part 2 divider keeps the tp-detail-day anchor, so Part 1’s day-block link still jumps to it');

// Same-day follow-up: "When there is a flight layover, do not put a star
// next to the layover on the summary itinerary" -- a layover row is
// connective tissue between two starred flights, not an event of its own.
// The star cell stays (empty) so the time/text columns keep alignment.
assert(/\$\{item\.isLayover \? '' : '★'\}/.test(build)
  && (build.match(/tp-row-star">★</g) || []).length === 0,
  'a layover row renders an EMPTY star cell on the Part 1 summary; every other row keeps its ★');
