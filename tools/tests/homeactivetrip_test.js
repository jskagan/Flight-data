// "On the upcoming trips box, the first trip listed should be any trip that is currently
// active" (2026-10-18). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const pick = new Function(fnSource('tripsyHomeUpcomingTrips') + '\nreturn tripsyHomeUpcomingTrips;')();
const T = (key, start, end) => ({ key, name: key, start, end });
const now = Date.UTC(2026, 9, 18, 20, 0, 0); // Oct 18 2026, 20:00 UTC
const cutoff = Date.UTC(2028, 9, 18);
const trips = [
  T('next-year', '2027-03-01', '2027-03-10'),
  T('active', '2026-10-06', '2026-11-02'),      // in progress
  T('soon', '2026-11-20', '2026-11-25'),
  T('over', '2026-09-01', '2026-09-10'),        // past
  T('ends-today', '2026-10-15', '2026-10-18'),  // last day today -> still active until the day ends
  T('far', '2029-01-01', '2029-01-05'),         // past the window
  T('no-start', null, null),
];
const got = pick(trips, now, cutoff).map(t => t.key);
assert(got[0] === 'active' || got[0] === 'ends-today', 'THE ASK: an in-progress trip is listed first -> ' + got.join(','));
assert(got.slice(0, 2).sort().join(',') === 'active,ends-today', 'every in-progress trip leads, including one on its last day');
assert(got.indexOf('active') === 0 && got.indexOf('ends-today') === 1, 'in-progress trips are in start order');
assert(got.slice(2).join(',') === 'soon,next-year', 'then the upcoming trips in start order, as before');
assert(!got.includes('over') && !got.includes('far') && !got.includes('no-start'), 'a finished trip, one past the window, and one with no dates are not listed');
assert(pick(trips, now, cutoff).find(t => t.key === 'active')._active === true && pick(trips, now, cutoff).find(t => t.key === 'soon')._active === false, 'active rows are marked for the ● Now badge');
assert(pick(trips, Date.UTC(2026, 10, 3, 12), cutoff).map(t => t.key)[0] === 'soon', 'the day after a trip ends it is no longer listed');
const home = html.slice(html.indexOf('const upcomingTrips = tripsyHomeUpcomingTrips('), html.indexOf('const upcomingTrips = tripsyHomeUpcomingTrips(') + 1500);
assert(/tripsyHomeUpcomingTrips\(decrypted\.filter\(t => !isTripsyTripEffectivelyHidden\(t\)\), now, cutoff\)/.test(home), 'Home builds the box from the helper (hidden trips still excluded)');
assert(/● Now/.test(home), 'an active row carries the ● Now marker');
