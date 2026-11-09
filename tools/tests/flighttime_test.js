// "For all flights, in the same line you list the seat, say 'Flight time:' and the
// length of the flight in hours and minutes." (2026-11-09) Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  let depth = 0;
  for (let j = html.indexOf('{', html.indexOf(')', m.index)); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
function extractConst(name) {
  const i = html.indexOf(`const ${name} = {`);
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(i, j + 2); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const zonesLoop = html.match(/const TRIPSY_AIRPORT_ZONES = \{\};\nfor [^\n]+\n/)[0];
const parseTripLocalParts = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] } : null; };
const m = new Function('parseTripLocalParts', [
  extractConst('TRIPSY_AIRPORT_ZONE_GROUPS'), zonesLoop, extractConst('TRIPSY_AIRPORT_CITIES'),
  extractFn('tripsyAirportCodeOf'), extractFn('tripsyZonedWallClockToUtcMs'), extractFn('tripsyFlightDurationLabel'),
  extractFn('tripsySeatLabel'), extractFn('tripsySeatAndFlightTimeLabel'),
  'return { TRIPSY_AIRPORT_ZONES, TRIPSY_AIRPORT_CITIES, tripsyFlightDurationLabel, tripsySeatAndFlightTimeLabel };'].join('\n'))(parseTripLocalParts);

const ewrLhr = { category: 'airplane', departureDescription: 'Newark, NJ/New York, NY, US (EWR)', arrivalDescription: 'London, GB (LHR)',
  departureAt: '2030-11-11T21:05:00', arrivalAt: '2030-11-12T09:10:00', seatClass: 'Business (C)', seatNumber: '10D' };
assert(m.tripsyFlightDurationLabel(ewrLhr) === '7h 5m', 'with no zones on the leg, the airport codes give the real duration (EWR→LHR 7h 5m)');
assert(m.tripsySeatAndFlightTimeLabel(ewrLhr) === 'Seat: Business (C) (10D) • Flight time: 7h 5m', 'the flight time rides the seat line');
assert(m.tripsySeatAndFlightTimeLabel({ ...ewrLhr, seatClass: null, seatNumber: null }) === 'Flight time: 7h 5m', 'no seat: the flight time stands alone');
assert(m.tripsySeatAndFlightTimeLabel({ category: 'train', seatNumber: '4A', departureAt: ewrLhr.departureAt, arrivalAt: ewrLhr.arrivalAt }) === 'Seat: 4A', 'a train gets no flight time');
assert(m.tripsyFlightDurationLabel({ departureAt: '2030-07-01T10:00:00', arrivalAt: '2030-07-01T11:00:00', departureDescription: 'XYZ', arrivalDescription: 'LHR' }) === null, 'an unknown airport gives no duration rather than a wrong one');
assert(m.tripsyFlightDurationLabel({ departureAt: '2030-07-01T10:00:00', arrivalAt: '2030-07-01T12:00:00', departureTimezone: 'Asia/Tokyo', arrivalTimezone: 'Asia/Tokyo', departureDescription: 'NRT', arrivalDescription: 'LAX' }) === '2h', 'the leg\'s own zones still win over the airport table');
const missing = Object.keys(m.TRIPSY_AIRPORT_CITIES).filter(c => !m.TRIPSY_AIRPORT_ZONES[c]);
assert(!missing.length, `every airport with a city has a zone${missing.length ? ' — missing ' + missing.join(' ') : ''}`);
const bad = Object.values(m.TRIPSY_AIRPORT_ZONES).filter(z => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return false; } catch (e) { return true; } });
assert(!bad.length, `every zone name is valid${bad.length ? ' — ' + bad.join(' ') : ''}`);
assert(/const seatEquipment = \[tripsySeatAndFlightTimeLabel\(raw\), raw\.vehicleDescription\]/.test(html), 'My Trips puts it on the seat line');
assert(!/lines\.push\(`Flight Time:/.test(html), 'the separate Flight Time line is gone');
assert((html.match(/tripsySeatAndFlightTimeLabel\(raw\)/g) || []).length >= 4, 'the itinerary cards use the same seat line');
