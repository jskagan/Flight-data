// One scenario, run in its own process so TZ (the device's timezone) is real.
// argv: <fixed-UTC-instant> [--bare]
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const src = ['parseTripLocalParts', 'tripsyDayKey', 'tripsyTravelViewTodayKey'].map(extractFn).join('\n');

const RealDate = Date;
const fixed = new RealDate(process.argv[2]);
global.Date = class extends RealDate {
  constructor(...a) { super(); return a.length ? new RealDate(...a) : new RealDate(fixed); }
  static now() { return fixed.getTime(); }
};

// The real trip: LAX->LHR on Aug 3 (arriving Aug 4 London), then London through Aug 19.
const trip = { events: [
  { start: '2026-08-03T09:00:00', end: '2026-08-04T05:00:00',
    tripsyRaw: { resource: 'transportation', departureTimezone: 'America/Los_Angeles', arrivalTimezone: 'Europe/London' } },
  { start: '2026-08-05T19:00:00', tripsyRaw: { resource: 'activity', timezone: 'Europe/London' } },
  { start: '2026-08-06T13:00:00', tripsyRaw: { resource: 'activity', timezone: 'Europe/London' } },
  { start: '2026-08-19T10:00:00', tripsyRaw: { resource: 'activity', timezone: 'Europe/London' } },
] };
const bare = { events: [{ start: '2026-08-05T10:00:00', tripsyRaw: { resource: 'activity' } }] };

eval(src);
const useTrip = process.argv.includes('--bare') ? bare : trip;
process.stdout.write(tripsyTravelViewTodayKey(useTrip, '2026-08-03', '2026-08-19'));
