// The Review Parsed Docs destination default prefers a date-matched trip that
// already holds the same confirmation number ("Mo's NY Trip" was offered for
// Jon's UA904 though Jon's trip held the rest of that booking, 2026-11-05).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  let d = 0;
  for (let k = html.indexOf('{', i); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
(0, eval)([
  'var tripsyDayKey = iso => (String(iso || "").match(/^\\d{4}-\\d{2}-\\d{2}/) || [null])[0];',
  'var esc = s => String(s);',
  'var formatTripDateRange = (a, b) => a + "–" + b;',
  'var isTripsyEventEffectivelyHidden = ev => !!ev.hidden;',
  extractFn('tripsyItineraryStartDayKey'), extractFn('tripsyItineraryEndDayKey'),
  extractFn('tripsyParseMatchTrips'), extractFn('tripsyParseTripOptionsHtml'),
].join('\n'));
const tA = { key: 'A', name: 'Trip A', start: '2030-03-01', end: '2030-03-05',
  events: [{ start: '2030-03-01T09:00:00', end: '2030-03-05T10:00:00', tripsyRaw: { confirmation: 'AAA111' } }] };
const tB = { key: 'B', name: 'Trip B', start: '2030-03-02', end: '2030-03-20',
  events: [{ start: '2030-03-02T09:00:00', end: '2030-03-20T10:00:00', tripsyRaw: { confirmation: 'bbb222' } }] };
const trips = [tA, tB];
assert(tripsyParseMatchTrips('2030-03-05', trips).map(t => t.key).join() === 'A,B', 'without fields: date order kept');
assert(tripsyParseMatchTrips('2030-03-05', trips, { confirmation: 'BBB222' })[0].key === 'B',
  'the trip holding the same confirmation (case-insensitive) comes first');
assert(tripsyParseMatchTrips('2030-03-05', trips, { confirmation: 'ZZZ' }).map(t => t.key).join() === 'A,B',
  'an unknown confirmation changes nothing');
assert(tripsyParseMatchTrips('2030-03-10', trips, { confirmation: 'AAA111' }).map(t => t.key).join() === 'B',
  'a trip outside the date range is never pulled in');
assert(/<option value="B" selected>/.test(tripsyParseTripOptionsHtml('2030-03-05', trips, { confirmation: 'BBB222' })),
  'the dropdown selects the confirmation-matched trip');
assert(/tripsyParseMatchTrips\(day, tripsyDecryptedTrips, ctx\.newFields\)\[0\]/.test(extractFn('tripsyLiveConflicts')),
  'the live conflict check uses the same destination');
assert(/tripsyParseMatchTrips\(dayKey, trips \|\| \[\], ev\.fields\)\[0\]/.test(extractFn('tripsyParseConflictEventCount')),
  'and so does the status badge conflict count');

// ---- event range beats the stored range ----
const mo = { key: 'M', name: 'Mo', start: '2030-04-01', end: '2030-04-06',
  events: [{ start: '2030-04-01T09:00:00', end: '2030-04-01T12:00:00' }, { start: '2030-04-05T15:00:00', end: '2030-04-05T18:00:00' }] };
const jon = { key: 'J', name: 'Jon', start: '2030-04-01', end: '2030-04-20',
  events: [{ start: '2030-04-01T09:00:00', end: '2030-04-01T12:00:00' }, { start: '2030-04-19T09:00:00', end: '2030-04-19T12:00:00' }] };
assert(tripsyParseMatchTrips('2030-04-06', [mo, jon]).map(t => t.key).join() === 'J',
  "THE ASK: a day after a trip's last event no longer matches it, though its stored end covers that day");
const lone = { key: 'L', name: 'Lone', start: '2030-05-01', end: '2030-05-04',
  events: [{ start: '2030-05-01T09:00:00', end: '2030-05-02T10:00:00' }] };
assert(tripsyParseMatchTrips('2030-05-04', [lone]).map(t => t.key).join() === 'L',
  "when no trip's events cover the day, the stored range still counts (a return flight past the last event)");
const empty = { key: 'E', name: 'Empty', start: '2030-06-01', end: '2030-06-03', events: [] };
assert(tripsyParseMatchTrips('2030-06-02', [empty]).length === 1, 'a trip with no events falls back to its stored dates');
