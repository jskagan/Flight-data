// Watch feed (tools/auth-worker/worker.js): the day text, trip/day lists and the
// iCalendar the Apple Watch Shortcut and Calendar subscription read. Synthetic
// fixtures only.
const fs = require('fs');
const path = require('path');
let ok = 0, fail = 0;
function assert(c, m) { if (c) { ok++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } }

const src = fs.readFileSync(path.join(__dirname, '../auth-worker/worker.js'), 'utf8').replace(/export default/, 'const __worker =');
const m = new Function(src + '\nreturn { feedDayText, feedRowsForDay, feedTripList, feedTripLabel, feedTripDays, feedDayLabel, feedParseDate, feedIcs, feedWallToUtc, feedIcsFold, feedTokenMatches, __worker };')();

const ev = (resource, id, raw, disp) => ({ id: `${resource}-${id}`, hidden: false, ...disp, tripsyRaw: { resource, id, ...raw } });
const tripA = { key: 'A', name: 'London Trip', start: '2030-05-01', end: '2030-05-05', events: [
  ev('transportation', 1, { category: 'airplane', company: 'Test Air', transportNumber: 'TA1', departureDescription: 'Home (HOM)', arrivalDescription: 'London (LHR)',
    departureAt: '2030-05-01T21:00:00', arrivalAt: '2030-05-02T09:10:00', departureTimezone: 'America/New_York', arrivalTimezone: 'Europe/London' },
    { type: 'flight', summary: 'Flight from Home to London', location: 'Home (HOM) → London (LHR)', start: '2030-05-01T21:00:00', end: '2030-05-02T09:10:00', tripsyExtra: 'Confirmation: ABC123' }),
  ev('hosting', 2, { name: 'Test Hotel' }, { type: 'hotel', summary: 'Test Hotel', location: '1 Street, London', start: '2030-05-02T15:00:00', end: '2030-05-05T11:00:00' }),
  ev('activity', 3, { category: 'theater', name: 'A Show', timezone: 'Europe/London' }, { type: 'concert', summary: 'A Show', location: 'Theatre, London', start: '2030-05-03T14:00:00', end: '2030-05-03T16:30:00' }),
  ev('activity', 4, { category: 'restaurant', name: 'Dinner' }, { type: 'dining', summary: 'Dinner', location: 'Somewhere', start: '2030-05-03T19:30:00', end: null }),
  { ...ev('activity', 5, { name: 'Hidden' }, { summary: 'Hidden', start: '2030-05-03T10:00:00' }), hidden: true },
] };
const tripOld = { key: 'O', name: 'Old Trip', start: '2029-01-01', end: '2029-01-03', events: [
  ev('activity', 9, { name: 'Past' }, { summary: 'Past', start: '2029-01-02T10:00:00' })] };
const tripNext = { key: 'N', name: 'Ski Trip', start: '2031-02-10', end: '2031-02-12', events: [
  ev('activity', 10, { name: 'Skiing' }, { summary: 'Skiing', start: '2031-02-10T09:00:00' }),
  ev('activity', 11, { name: 'More skiing' }, { summary: 'More skiing', start: '2031-02-12T09:00:00' })] };
const trips = [tripNext, tripA, tripOld];

// ---- dates ----
assert(m.feedDayLabel('2030-05-03') === 'Fri, May 3 2030', 'a day label carries weekday, date and year');
assert(m.feedParseDate('Fri, May 3 2030') === '2030-05-03' && m.feedParseDate('2030-05-03') === '2030-05-03', 'the day endpoint accepts a /days line or an ISO date');
assert(m.feedParseDate('nonsense') === '', 'an unreadable date parses to nothing');

// ---- trip + day lists ----
const list = m.feedTripList(trips, '2030-05-02');
assert(list.map(t => t.key).join(',') === 'A,N', 'trips list: current and upcoming only, in start order (a finished trip is left out)');
assert(m.feedTripLabel(tripA) === 'London Trip (May 1–5, 2030)', 'a trip line names the trip and its event span');
const days = m.feedTripDays(tripA);
assert(days.length === 5 && days[0] === '2030-05-01' && days[4] === '2030-05-05', 'a trip lists every day from its first to its last event');

// ---- one day ----
const d1 = m.feedDayText(trips, '2030-05-01');
assert(/9:00 PM  Home \(HOM\) → London \(LHR\) • Test Air TA1/.test(d1) && /Arrives Thu, May 2 9:10 AM/.test(d1), 'departure day: the flight with its route, carrier and next-day arrival');
const d2 = m.feedDayText(trips, '2030-05-02');
assert(/9:10 AM  Arrive: London \(LHR\)/.test(d2) && /3:00 PM  Check in: Test Hotel/.test(d2), 'arrival day: the landing, then the hotel check-in');
assert(d2.indexOf('Arrive:') < d2.indexOf('Check in'), 'rows are in time order');
const d3 = m.feedDayText(trips, '2030-05-03');
assert(/Staying at Test Hotel/.test(d3), 'a night in the middle of a stay says where you are staying');
assert(/🎭 2:00 PM–4:30 PM  A Show/.test(d3) && /🍽️ 7:30 PM  Dinner/.test(d3), 'events show their times and a glyph by category');
assert(!/Hidden/.test(d3), 'hidden events never show');
assert(/11:00 AM  Check out: Test Hotel/.test(m.feedDayText(trips, '2030-05-05')), 'the check-out day');
assert(/Nothing scheduled\./.test(m.feedDayText([tripNext], '2031-02-11')) && /Ski Trip/.test(m.feedDayText([tripNext], '2031-02-11')), 'an empty day inside a trip still names the trip');

// ---- calendar ----
const ics = m.feedIcs(trips, '2030-04-25', Date.UTC(2030, 3, 25));
assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'a well-formed iCalendar with CRLF lines');
assert(!/Past/.test(ics), 'the calendar leaves out finished trips');
assert(/DTSTART:20300502T010000Z/.test(ics) && /DTEND:20300502T081000Z/.test(ics), 'a flight converts its departure and arrival zones to UTC');
assert(/SUMMARY:Check in: Test Hotel/.test(ics) && /SUMMARY:Check out: Test Hotel/.test(ics), 'a hotel becomes a check-in and a check-out, never one multi-day block');
assert(/DTSTART:20300503T130000Z/.test(ics), 'an event with a zone is placed in UTC (2 PM London BST = 13:00Z)');
assert(/UID:activity-4@travel-tracker[\s\S]*?DTSTART:20300503T183000Z/.test(ics), 'an event with no zone of its own takes the trip\'s nearest known zone');
assert(/LOCATION:1 Street\\, London/.test(ics), 'text is escaped');
assert(ics.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75), 'every line is folded to 75 octets');
assert(/DTSTART:20310210T090000\r\n/.test(ics), 'with no zone anywhere on the trip, a floating local time');

// ---- the gate ----
(async () => {
  assert(await m.feedTokenMatches('abc', 'abc') && !(await m.feedTokenMatches('abd', 'abc')) && !(await m.feedTokenMatches('', 'abc')), 'the feed token must match exactly');
  const env = { AUTH_KV: {}, GOOGLE_CLIENT_SECRET: 'x', FEED_TOKEN: 'secret' };
  const r = await m.__worker.fetch(new Request('https://w.example/feed/wrong/day'), env);
  assert(r.status === 404, 'a wrong token reads as not found, before anything touches Drive');
  const r2 = await m.__worker.fetch(new Request('https://w.example/other'), env);
  assert(r2.status === 404, 'any other GET is not found');
  const r3 = await m.__worker.fetch(new Request('https://w.example/feed/secret/day'), { ...env, FEED_TOKEN: '' });
  assert(r3.status === 404, 'with no FEED_TOKEN set the feed is off');
  const src2 = fs.readFileSync(path.join(__dirname, '../auth-worker/worker.js'), 'utf8');
  assert(/if \(request\.method === 'GET'\)[\s\S]*?if \(request\.method !== 'POST'\)/.test(src2), 'the sign-in endpoints still accept POST only');
  if (fail) process.exit(1);
})();
