const { execFileSync } = require('child_process');
const path = require('path');
const CASE = path.join(__dirname, 'tv_zone_case.js');

const run = (instant, deviceTz, extra = []) =>
  execFileSync('node', [CASE, instant, ...extra], { env: { ...process.env, TZ: deviceTz } }).toString();

let failed = false;
const assert = (got, want, msg) => {
  const ok = got === want;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok   ' : 'FAIL '}${msg} -> got ${got}, want ${want}`);
};

// THE BUG JUST REPORTED. 01:00 on the 6th in London is still 17:00 on the 5th in LA.
// The traveler landed in London on Aug 4, so the answer must be the 6th. The old
// "first zone found on the trip" rule picked the LAX departure zone and said Aug 5.
assert(run('2026-08-06T01:00:00Z', 'Europe/London'), '2026-08-06',
  'in London past midnight: uses the London zone, not the LAX departure zone');

// Same instant, but the device clock is still on LA time. The itinerary still puts
// the traveler in London -- this is the ORIGINAL "device hasn't caught up" bug.
assert(run('2026-08-06T01:00:00Z', 'America/Los_Angeles'), '2026-08-06',
  'device stuck on LA time: itinerary zone still wins');

// BEFORE the flight the traveler really is in LA, so the LA date is the honest
// answer even though London has already ticked over. 00:30 UTC Aug 3 is Aug 3 in
// London but still Aug 2 in LA -- and Aug 2 is BEFORE the trip's first day, so the
// caller correctly treats today as outside the trip and opens at day 1 rather than
// being dragged a day forward into London's date.
assert(run('2026-08-03T00:30:00Z', 'America/Los_Angeles'), '2026-08-02',
  'evening before departure: stays on the LA date, not London\'s next day');

// Mid-trip midday: both zones agree, so nothing clever should happen.
assert(run('2026-08-10T12:00:00Z', 'Europe/London'), '2026-08-10',
  'mid-trip midday is unambiguous');

// Arrival day: the zone must flip to London at the flight's ARRIVAL, not at some
// later event. 23:30 UTC Aug 4 is already Aug 5 in London.
assert(run('2026-08-04T23:30:00Z', 'America/Los_Angeles'), '2026-08-05',
  'arrival day: zone flips to London mid-flight');

// No timezone data anywhere -> device date, whatever that is.
assert(run('2026-08-06T01:00:00Z', 'Europe/London', ['--bare']), '2026-08-06',
  'no timezone on any event: falls back to the device date');

process.exitCode = failed ? 1 : 0;
