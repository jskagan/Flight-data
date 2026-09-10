// "Why is there a P/S reservation for 1:05 PM on 11/24?" A P/S ARRIVAL
// reservation (a synthetic LHR→LAX leg, flight 935) was also matched to the
// same day's Düsseldorf→London positioning leg -- which lands at Heathrow, not
// LAX -- planting a spurious second P/S card at that flight's own arrival time.
// Root cause: matchPsReservationToTripsyFlight's tier 3 (flight number ignored
// entirely, for airlines re-issuing a flight under a new number) checked the
// date and which side of the RESERVATION is LAX, but never the EVENT's own
// airports. Tier 3 now requires the event's matching side to actually be Los
// Angeles (raw departure/arrivalDescription, falling back to the summary's
// "Flight from X to Y" halves); an event naming neither side keeps the old
// behavior, since tier 3 exists precisely for drifted records. Tiers 1-2 are
// untouched -- an exact flight-number match already pins the right leg.
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

// ---- extract and run the matcher with its real helpers ----
eval(extractFn('tripsyFlightNumberDigits').replace(/^function /, 'var tripsyFlightNumberDigits = function '));
eval(extractFn('parseTripLocalParts').replace(/^function /, 'var parseTripLocalParts = function '));
eval(extractFn('inferReservationYear').replace(/^function /, 'var inferReservationYear = function '));
eval(extractFn('matchPsReservationToTripsyFlight').replace(/^function /, 'var matchPsReservationToTripsyFlight = function '));

// Synthetic shape of the real incident: an ARRIVAL reservation into LAX, and
// two same-day flights -- a foreign positioning leg and the real LAX leg.
const res = {
  reservationNumber: '999001', flightNumber: '935',
  date: 'November 24', emailInternalDate: String(Date.UTC(2026, 8, 8)),
  origin: 'LHR', destination: 'LAX',
  departureAirport: 'LHR', arrivalAirport: 'LAX',
  arrivalTime: '6:45 pm',
};
const positioningLeg = {
  type: 'flight',
  summary: 'Flight from Düsseldorf (DUS) to London (LHR) • Eurowings UA9621',
  start: '2026-11-24T12:40:00', end: '2026-11-24T13:05:00',
  tripsyRaw: { departureDescription: 'Düsseldorf (DUS)', arrivalDescription: 'London (LHR)' },
};
const laxLeg = {
  type: 'flight',
  summary: 'Flight from London (LHR) to Los Angeles (LAX) • United Airlines UA935',
  start: '2026-11-24T15:20:00', end: '2026-11-24T18:45:00',
  tripsyRaw: { departureDescription: 'London (LHR)', arrivalDescription: 'Los Angeles (LAX)' },
};

// Tier 1 (exact number, exact date): only the real leg matches, as always.
assert(matchPsReservationToTripsyFlight(res, laxLeg, 0, false) === 'after',
  'the real LHR→LAX leg still matches exactly on its flight number');
assert(matchPsReservationToTripsyFlight(res, positioningLeg, 0, false) === null,
  'the positioning leg never matched on flight number (935 vs 9621)');

// Tier 3 (number ignored): THE BUG -- the positioning leg used to match here.
assert(matchPsReservationToTripsyFlight(res, positioningLeg, 0, true) === null,
  'THE FIX: with the flight number ignored, a leg that lands at Heathrow cannot claim an arrival-at-LAX reservation');
assert(matchPsReservationToTripsyFlight(res, laxLeg, 0, true) === 'after',
  'the real leg still matches with the number ignored (the re-issued-flight-number case tier 3 exists for)');

// A re-issued number on the SAME route (the case tier 3 was built for: AA137
// re-issued against a reservation reading "135") keeps working.
const reissued = {
  type: 'flight',
  summary: 'Flight from London (LHR) to Los Angeles (LAX) • American Airlines AA137',
  start: '2026-11-24T15:20:00', end: '2026-11-24T18:45:00',
  tripsyRaw: { departureDescription: 'London (LHR)', arrivalDescription: 'Los Angeles (LAX)' },
};
assert(matchPsReservationToTripsyFlight(res, reissued, 0, true) === 'after',
  'a same-route flight re-issued under a new number still matches via tier 3');

// Departure-side symmetry: an out-of-LAX reservation cannot claim a leg that
// departs somewhere else.
const depRes = { ...res, origin: 'LAX', destination: 'JFK', departureAirport: 'LAX', arrivalAirport: 'JFK' };
const jfkFromEwr = {
  type: 'flight',
  summary: 'Flight from Newark (EWR) to New York (JFK) • Delta DL1',
  start: '2026-11-24T09:00:00', end: '2026-11-24T10:00:00',
  tripsyRaw: { departureDescription: 'Newark (EWR)', arrivalDescription: 'New York (JFK)' },
};
assert(matchPsReservationToTripsyFlight(depRes, jfkFromEwr, 0, true) === null,
  'a departure-side reservation likewise requires the event to actually depart LAX');

// An event naming NO airports at all (badly drifted record) keeps the old
// lenient behavior -- tier 3 exists precisely for those.
const bareEvent = { type: 'flight', summary: 'Charter flight', start: '2026-11-24T15:20:00', end: '2026-11-24T18:45:00', tripsyRaw: {} };
assert(matchPsReservationToTripsyFlight(res, bareEvent, 0, true) === 'after',
  'an event with no airport text anywhere still matches, rather than becoming unmatchable');

// The summary fallback works when the raw descriptions are missing.
const summaryOnly = { type: 'flight', summary: 'Flight from Düsseldorf (DUS) to London (LHR) • Eurowings UA9621', start: '2026-11-24T12:40:00', end: '2026-11-24T13:05:00', tripsyRaw: {} };
assert(matchPsReservationToTripsyFlight(res, summaryOnly, 0, true) === null,
  'airports parsed from the "Flight from X to Y" summary alone still veto a wrong-airport match');
