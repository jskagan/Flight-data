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
const src = ['parseTripLocalParts','tripsyDayKey','tripsyEventKey','getTripsyEventOverride',
  'isTripsyEventEffectivelyHidden','tripsyItineraryStartDayKey','tripsyDayNumberFromTripStart']
  .map(extractFn).join('\n');
fs.writeFileSync('daynum_run.js', `
let driveData = { tripsyHiddenEventOverrides: {}, tripsyEventOverrides: {} };
${src}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// The real trip: declared Aug 2-19, but the first actual event is Aug 3.
const trip = { start:'2026-08-02', end:'2026-08-19', events:[
  { start:'2026-08-03T09:00:00', tripsyRaw:{resource:'transportation', id:1} },
  { start:'2026-08-05T12:00:00', tripsyRaw:{resource:'activity', id:2} },
]};
const startKey = tripsyItineraryStartDayKey(trip);
assert(startKey === '2026-08-03', 'Day 1 anchors on the first EVENT day (Aug 3), not trip.start Aug 2 -> ' + startKey);
assert(tripsyDayNumberFromTripStart('2026-08-03', startKey) === 1, 'Aug 3 = Day 1');
assert(tripsyDayNumberFromTripStart('2026-08-05', startKey) === 3, 'Aug 5 (today) = Day 3');
// vs the OLD trip.start-based numbering, which is what produced the mismatch.
assert(tripsyDayNumberFromTripStart('2026-08-05', '2026-08-02') === 4, 'old trip.start rule called today Day 4 -- the inconsistency reported');
`);
