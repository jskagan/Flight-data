// New York City events are omitted from attire schedules and packing lists, and shown
// as "Omitted" on the schedules: "When preparing any attire schedules or packing lists,
// omit all events in New York City. When there are events in New York, show them as
// 'omitted' on any schedules" (2026-11-05). Synthetic fixtures only.
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
  'var formatTripTime = iso => { const m = String(iso || "").match(/T(\\d\\d):(\\d\\d)/); return m ? m[1] + ":" + m[2] : ""; };',
  'var tripsyAttireFreeDayEvent = k => ({ id: "freeday-" + k, freeDay: true, name: "No events planned", date: k, resource: "activity" });',
  'var tripsyAttireMarkInFlightDays = () => 0;',
  'var computeTripsyAttireBlocks = days => ({ blocks: [], counts: { n: days.length } });',
  'var tripsyAttireApplyRecomputedBlocks = (g, r) => { g.counts = r.counts; };',
  'var tripsyAttireFingerprint = evs => ({ count: evs.length, hash: evs.map(e => e.id).join(",") });',
  extractFn('tripsyAttireFlightRoles'), extractFn('tripsyAttireOutfitlessTransitIds'), extractFn('tripsyAttireEventBaseId'),
  extractFn('tripsyDayKeyRange'),
  extractFn('tripsyAddressIsNyc'), extractFn('tripsyEndpointIsNyc'), extractFn('tripsyAttireNycOmittedIds'),
  extractFn('tripsyNycAreaEndpoint'), extractFn('tripsyAttireNycStayDays'),
  extractFn('tripsyAttireNycOmittedRowsByDay'), extractFn('tripsyAttireNoOutfitIds'),
  extractFn('tripsyAttireDropOutfitlessTransit'), extractFn('tripsyOutfitDropOutfitlessTransit'),
].join('\n'));

// ---- the address rule ----
for (const a of ['10 Lincoln Center Plaza, New York, NY 10023', '1335 Avenue of the Americas, New York, NY, 10019',
  'Brooklyn, NY 11201', '5 East 66th Street, New York, New York', 'NYC', '123 Main St, NY 11373'])
  assert(tripsyAddressIsNyc(a), `NYC: ${a}`);
for (const a of ['1201 New York Avenue, NW, Washington, DC 20005', 'Newark, NJ', '1 Old Country Rd, Mineola, NY 11501',
  'Albany, NY 12207', '', 'Grosvenor Square, London'])
  assert(!tripsyAddressIsNyc(a), `not NYC: ${a || '(empty)'}`);
assert(tripsyEndpointIsNyc('JFK') && tripsyEndpointIsNyc('New York, NY Moynihan Train Hall'),
  'JFK and an NYC address are NYC endpoints');
assert(!tripsyEndpointIsNyc('LAX') && !tripsyEndpointIsNyc('EWR'), 'LAX and a bare EWR are not');

// ---- which events ----
const act = (id, start, address, name) => ({ id: `activity-${id}`, start, end: null, summary: name || `A${id}`, location: address,
  tripsyRaw: { resource: 'activity', id, address } });
const leg = (id, start, dep, arr, category) => ({ id: `transportation-${id}`, start, end: start, summary: `Leg ${id}`,
  tripsyRaw: { resource: 'transportation', id, category: category || 'car', departureDescription: dep, arrivalDescription: arr } });
const trip = { key: 'T', events: [
  leg(1, '2030-02-11T08:00:00', 'LAX', 'JFK', 'airplane'),
  leg(2, '2030-02-11T17:00:00', 'JFK', 'Hotel, New York, NY 10019'),
  act(3, '2030-02-12T12:00:00', '1900 Broadway, New York, NY 10023', 'Lunch'),
  act(4, '2030-02-13T12:00:00', null, 'Lunch, venue TBA'),
  act(5, '2030-02-14T10:00:00', null, 'Brunch, venue TBA'),
  leg(6, '2030-02-15T09:00:00', 'JFK', 'FRA', 'airplane'),
  act(7, '2030-02-16T19:00:00', 'Opernplatz, 60313 Frankfurt, Germany', 'Opera'),
  leg(8, '2030-02-18T10:00:00', 'FRA', 'LAX', 'airplane'),
] };
const nyc = tripsyAttireNycOmittedIds(trip);
assert(nyc.has('activity-3'), 'an activity with an NYC address is omitted');
assert(nyc.has('activity-4') && nyc.has('activity-5'), 'an address-less event goes with the nearest located event (NYC here)');
assert(nyc.has('transportation-2'), 'a ride with both ends in the city is omitted');
assert(!nyc.has('transportation-1') && !nyc.has('transportation-6'), 'a flight to or from New York is still dressed for');
assert(!nyc.has('activity-7') && !nyc.has('transportation-8'), 'events outside New York are untouched');
const noTbd = { key: 'U', events: [act(1, '2030-02-16T19:00:00', 'Frankfurt, Germany'), act(2, '2030-02-17T12:00:00', null)] };
assert(tripsyAttireNycOmittedIds(noTbd).size === 0, 'an address-less event near a non-NYC event stays');
const rows = tripsyAttireNycOmittedRowsByDay(trip);
assert(rows.get('2030-02-12')[0].name === 'Lunch' && rows.get('2030-02-12')[0].startTime === '12:00', 'omitted rows are listed by day with their time');
assert(tripsyAttireNoOutfitIds(trip).has('activity-3') && tripsyAttireNoOutfitIds(trip).has('transportation-2'), 'the no-outfit set includes NYC events');

// ---- saved records are corrected on read ----
const guide = { tripKey: 'T', days: [
  { dayKey: '2030-02-11', events: [{ id: 'transportation-1', resource: 'transportation' }] },
  { dayKey: '2030-02-12', events: [{ id: 'activity-3', resource: 'activity' }] },
  { dayKey: '2030-02-16', events: [{ id: 'activity-7', resource: 'activity' }] },
] };
assert(tripsyAttireDropOutfitlessTransit(guide, trip) === true, 'a saved guide holding an NYC event changes');
assert(guide.days.map(d => d.dayKey).join(',') === '2030-02-11,2030-02-16',
  'a day left with only NYC events leaves the guide (no free-day placeholder to dress for)');
assert(guide.eventFingerprint.count === 2, 'the fingerprint is re-derived from what remains');
const outfits = { blocks: [{ eventIds: ['activity-3'] }, { eventIds: ['activity-7'] }] };
assert(tripsyOutfitDropOutfitlessTransit(outfits, trip) && outfits.blocks.length === 1 && outfits.blocks[0].eventIds[0] === 'activity-7',
  'an outfit dressing only an NYC event is dropped');

// ---- empty days spent in New York ----
const stayTrip = { key: 'S', events: [
  leg(1, '2030-03-01T08:00:00', 'Los Angeles (LAX)', 'Newark (EWR)', 'airplane'),
  leg(2, '2030-03-05T21:00:00', 'Newark, NJ/New York, NY, US (EWR)', 'London, GB (LHR)', 'airplane'),
  act(3, '2030-03-07T19:00:00', 'Covent Garden, London WC2E 9DD', 'Opera'),
  leg(4, '2030-03-09T10:00:00', 'LHR', 'EWR', 'airplane'),
  leg(5, '2030-03-09T15:00:00', 'EWR', 'LAX', 'airplane'),
] };
stayTrip.events[0].end = '2030-03-01T16:00:00';
stayTrip.events[1].end = '2030-03-06T09:00:00';
const stays = tripsyAttireNycStayDays(stayTrip);
assert([...stays].join(',') === '2030-03-01,2030-03-02,2030-03-03,2030-03-04,2030-03-05',
  'THE ASK: the days between landing at Newark and flying out are New York days');
assert(!stays.has('2030-03-06') && !stays.has('2030-03-09'), 'London days, and a same-day connection through EWR, are not');
const stayRows = tripsyAttireNycOmittedRowsByDay(stayTrip);
assert(stayRows.get('2030-03-03')[0].name === 'In New York City', 'a stay day is listed as an omitted "In New York City" row');
const stayGuide = { tripKey: 'S', days: [
  { dayKey: '2030-03-01', events: [{ id: 'transportation-1', resource: 'transportation' }] },
  { dayKey: '2030-03-02', events: [{ id: 'freeday-2030-03-02', freeDay: true, resource: 'activity' }] },
  { dayKey: '2030-03-06', events: [{ id: 'freeday-2030-03-06', freeDay: true, resource: 'activity' }] },
] };
assert(tripsyAttireDropOutfitlessTransit(stayGuide, stayTrip) === true
  && stayGuide.days.map(d => d.dayKey).join(',') === '2030-03-01,2030-03-06',
  "a saved guide's free day in New York leaves it; a dressed day and a London free day stay");

// ---- source pins ----
const build = extractFn('tripsyAttireBuildDays');
assert(/const kept = dayEvents\.filter\(ev => !nycOmitted\.has\(tripsyAttireEventBaseId\(ev\.id\)\)\);/.test(build),
  'a fresh build leaves NYC events out of every day (so out of the prompt, counts, packing and outfits)');
assert(/nycOnlyDays\.has\(k\) \? null/.test(build), 'and gives a NYC-only day no free-day placeholder');
assert(/const nycOnlyDays = tripsyAttireNycStayDays\(/.test(build), 'nor an empty day spent in New York');
const dg = extractFn('renderTripsyDressGuideInto');
assert(/tripsyAttireNycOmittedRowsByDay\(dgTrip\)/.test(dg) && /\$\{omittedHtml\}/.test(dg) && /TRIPSY_ATTIRE_OMITTED_BADGE_HTML/.test(dg),
  'THE ASK: the Daily Dress Guide lists NYC events as Omitted, read live from the trip');
assert(/Omitted — New York City/.test(html.slice(html.indexOf('const TRIPSY_ATTIRE_OMITTED_BADGE_HTML'), html.indexOf('const TRIPSY_ATTIRE_OMITTED_BADGE_HTML') + 300)),
  'the badge reads "Omitted — New York City"');
assert(/const tvNycOmitted = tripsyAttireNycOmittedIds\(trip\);/.test(html) && /isOmitted && \(i === 0/.test(html),
  'Travel View\'s dress-code mode labels NYC events Omitted too');
