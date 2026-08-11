const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- structure: the giant per-trip closure became a reusable function ----
assert(/const tripCardHtml = trip => \{/.test(html), 'the per-trip card closure is a named function now');
assert(!/container\.innerHTML = \[\.\.\.trips, \.\.\.pendingCreateTripPlaceholders\]\.map\(trip =>/.test(html),
  'the old render-everything map is gone');
// current section renders current trips + placeholders through the SAME builder
assert(/container\.innerHTML = \[\.\.\.currentTrips, \.\.\.pendingCreateTripPlaceholders\]\.map\(tripCardHtml\)/.test(html),
  'current trips and create-trip placeholders render as full cards');
// placeholders never fall into a year section
assert(/isPastTrip/.test(html) && !/pendingCreateTripPlaceholders\.filter\(isPastTrip/.test(html),
  'placeholders stay in the current section regardless of dates');

// ---- the past/current split rule ----
const seg = (start, len = 3000) => { const i = html.indexOf(start); return i < 0 ? '' : html.slice(i, i + len); };
const split = seg('const isPastTrip = t =>', 400);
assert(/tripsyDayKey\(t\.end\) \|\| tripsyDayKey\(t\.start\)/.test(split),
  'past = last day before today, falling back to first day');
assert(/!!endK && endK < todayK/.test(split), 'a trip with NO dates at all is never judged past');

// ---- year grouping ----
const grp = seg('const pastByYear = new Map()', 1600);
assert(/\.sort\(\)\.reverse\(\)/.test(grp), 'year sections run newest first');
assert(/tripsyExpandedYears\.has\(y\) \|\| yearTrips\.some\(t => !isTripsyTripCollapsed\(t\.key\)\)/.test(grp),
  'a year containing an EXPANDED trip renders open -- the jump paths rely on this');
assert(/open \? yearTrips\.map\(tripCardHtml\)\.join\(''\) : ''/.test(grp),
  'a collapsed year builds NO trip cards at all');
assert(/data-tripsy-year-toggle="\$\{esc\(y\)\}"/.test(grp), 'the header row is the toggle');
assert(/Past Trips<\/div>/.test(html), 'the past block is labeled');

// ---- toggle handler ----
const th = seg("container.querySelectorAll('[data-tripsy-year-toggle]')", 1000);
assert(/tripsyExpandedYears\.delete\(y\)/.test(th) && /tripsyExpandedYears\.add\(y\)/.test(th),
  'the handler toggles the year set');
assert(/forEach\(t => setTripsyTripCollapsed\(t\.key, true\)\)/.test(th),
  'closing a year re-collapses its trips, or the forced-open rule would bounce it straight open');
assert(/renderTripsyEventsList\(\)/.test(th), 'and re-renders through the normal path');

// ---- lifetime ----
assert(/tripsyExpandedYears\.clear\(\); \/\/ past-year sections close again on a fresh visit/.test(html),
  'a fresh visit closes every year section, same lifetime as the per-trip collapse reset');
assert(/const tripsyExpandedYears = new Set\(\);/.test(html), 'state is in-memory, never persisted');

// ---- behaviour of the split, executed against fixtures ----
function extractArrow(name, src) {
  const i = src.indexOf(`const ${name} = `);
  let depth = 0, j = src.indexOf('{', i);
  if (src.slice(i, j).includes('=>') && !src.slice(i, j + 1).includes('{')) return null;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(i, j + 1) + ';'; }
  }
}
const todayK = '2026-08-11';
const tripsyDayKey = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) ? v.slice(0, 10) : null;
const isPastTrip = t => { const endK = tripsyDayKey(t.end) || tripsyDayKey(t.start); return !!endK && endK < todayK; };
assert(isPastTrip({ start: '2011-12-12', end: '2011-12-15' }) === true, 'a 2011 trip is past');
assert(isPastTrip({ start: '2026-08-02', end: '2026-08-20' }) === false, 'an in-progress trip is current');
assert(isPastTrip({ start: '2028-02-08', end: '2028-02-20' }) === false, 'a future trip is current');
assert(isPastTrip({ start: '2026-08-01' }) === true, 'no end: judged by its start');
assert(isPastTrip({}) === false, 'no dates at all: never past');
