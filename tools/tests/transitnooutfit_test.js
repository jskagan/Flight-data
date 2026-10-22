// Transportation wears no outfit, except the trip's first and last flight (with their
// connecting legs): "For transportation events, there should not be an outfit associated
// with them, except for the initial and final flight of each trip" (2026-10-22).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) return null;
  let d = 0;
  for (let k = html.indexOf('{', i); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
let marked = 0, recomputed = 0;
(0, eval)([
  'var tripsyDayKey = iso => (String(iso || "").match(/^\\d{4}-\\d{2}-\\d{2}/) || [null])[0];',
  'var tripsyAttireFreeDayEvent = k => ({ id: "freeday-" + k, freeDay: true, name: "No events planned", date: k, resource: "activity" });',
  'var tripsyAttireMarkInFlightDays = () => { globalThis.__marked = (globalThis.__marked || 0) + 1; return 0; };',
  'var computeTripsyAttireBlocks = days => ({ blocks: days.map(d => d.dayKey), counts: { n: days.length } });',
  'var tripsyAttireApplyRecomputedBlocks = (g, r) => { g.blocks = r.blocks; g.counts = r.counts; };',
  'var tripsyAttireFingerprint = evs => ({ count: evs.length, hash: evs.map(e => e.id).join(",") });',
  extractFn('tripsyAttireOutfitlessTransitIds'), extractFn('tripsyAttireEventBaseId'),
  extractFn('tripsyAttireDropOutfitlessTransit'), extractFn('tripsyOutfitDropOutfitlessTransit'),
].join('\n'));

const ev = (id, resource, category, start, summary) => ({ id: `${resource}-${id}`, start, end: start, summary: summary || '',
  tripsyRaw: { resource, id, category } });
const trip = { key: 'T', events: [
  ev(1, 'transportation', 'car', '2030-05-01T07:00:00', 'Car from Home to LAX'),
  ev(2, 'transportation', 'airplane', '2030-05-01T10:00:00', 'Flight from LAX to JFK'),
  ev(3, 'transportation', 'airplane', '2030-05-01T18:00:00', 'Flight from JFK to LHR'),   // connecting leg
  ev(4, 'transportation', 'car', '2030-05-02T08:00:00', 'Car from LHR to Hotel'),
  ev(5, 'hosting', null, '2030-05-02T15:00:00', 'Hotel London'),
  ev(6, 'transportation', 'train', '2030-05-04T09:00:00', 'Train from London to Paris'),
  ev(7, 'activity', 'restaurant', '2030-05-04T20:00:00', 'Dinner'),
  ev(8, 'transportation', 'airplane', '2030-05-06T09:00:00', 'Flight from CDG to FCO'),  // mid-trip flight
  ev(9, 'hosting', null, '2030-05-06T15:00:00', 'Hotel Rome'),
  ev(10, 'transportation', 'taxi', '2030-05-09T06:00:00', 'Taxi from Hotel to FCO'),
  ev(11, 'transportation', 'airplane', '2030-05-09T10:00:00', 'Flight from FCO to LAX'), // last flight
] };
const drop = tripsyAttireOutfitlessTransitIds(trip);
assert(!drop.has('transportation-2') && !drop.has('transportation-11'), 'the first and last flight keep their outfits');
assert(!drop.has('transportation-3'), 'the first flight\'s connecting leg (only transportation between, same day) keeps it too');
assert(['transportation-1', 'transportation-4', 'transportation-6', 'transportation-8', 'transportation-10'].every(id => drop.has(id)) && drop.size === 5,
  'every car, train, taxi and mid-trip flight gets no outfit');
assert(!drop.has('hosting-5') && !drop.has('activity-7'), 'non-transportation events are never affected');
const oneFlight = { key: 'X', events: [ev(1, 'transportation', 'airplane', '2030-01-01T09:00:00'), ev(2, 'transportation', 'car', '2030-01-01T13:00:00')] };
assert(tripsyAttireOutfitlessTransitIds(oneFlight).size === 1 && !tripsyAttireOutfitlessTransitIds(oneFlight).has('transportation-1'),
  'a trip with one flight keeps that flight');
assert(tripsyAttireOutfitlessTransitIds({ key: 'Y', events: [ev(1, 'transportation', 'car', '2030-01-01T09:00:00')] }).has('transportation-1'),
  'a trip with no flight dresses no transportation at all');

// A saved guide is corrected on read.
const guide = { tripKey: 'T', days: [
  { dayKey: '2030-05-01', events: [{ id: 'transportation-1', resource: 'transportation' }, { id: 'transportation-2', resource: 'transportation' }, { id: 'transportation-3-begin', resource: 'transportation' }] },
  { dayKey: '2030-05-02', events: [{ id: 'transportation-3-end', resource: 'transportation' }, { id: 'transportation-4', resource: 'transportation' }, { id: 'hosting-5', resource: 'hosting' }] },
  { dayKey: '2030-05-04', events: [{ id: 'transportation-6', resource: 'transportation' }] },
], eventFingerprint: { count: 7, hash: 'old' } };
assert(tripsyAttireDropOutfitlessTransit(guide, trip) === true, 'the retrofit reports a change');
const idsNow = guide.days.map(d => d.events.map(e => e.id).join(','));
assert(idsNow[0] === 'transportation-2,transportation-3-begin' && idsNow[1] === 'transportation-3-end,hosting-5',
  'outfitless transit leaves the guide; both halves of a kept multi-day leg stay');
assert(idsNow[2] === 'freeday-2030-05-04' && guide.days[2].events[0].category === 'casual',
  'a day left with nothing gets the free-day placeholder a fresh build would have');
assert(guide.eventFingerprint.count === 5 && Array.isArray(guide.blocks) && guide.blocks.length === 3 && globalThis.__marked >= 1,
  'blocks, counts and the fingerprint are re-derived from the corrected days');
assert(tripsyAttireDropOutfitlessTransit(guide, trip) === false, 'idempotent');

// Saved outfits lose the transit events; a block left with nothing is dropped.
const outfits = { blocks: [
  { dayKey: '2030-05-01', eventIds: ['transportation-2', 'transportation-3-begin'], garmentIds: ['g1'] },
  { dayKey: '2030-05-02', eventIds: ['transportation-4', 'hosting-5'], garmentIds: ['g2'] },
  { dayKey: '2030-05-04', eventIds: ['transportation-6'], garmentIds: ['g3'] },
] };
assert(tripsyOutfitDropOutfitlessTransit(outfits, trip) === true && outfits.blocks.length === 2
  && outfits.blocks[1].eventIds.join(',') === 'hosting-5' && outfits.blocks[0].eventIds.length === 2,
  'outfit blocks drop transit ids, and a transit-only block disappears');

// Wiring.
const build = extractFn('tripsyAttireBuildDays');
assert(/const outfitlessTransit = tripsyAttireOutfitlessTransitIds\(effectiveTrip \|\| trip\);/.test(build)
  && /\.filter\(ev => !\(ev\.resource === 'transportation' && outfitlessTransit\.has\(tripsyAttireEventBaseId\(ev\.id\)\)\)\)/.test(build),
  'a fresh build leaves outfitless transit out before the free-day gap fill');
assert(/tripsyAttireDropOutfitlessTransit\(guide, trip\)/.test(html) && /tripsyOutfitDropOutfitlessTransit\(rec, trip\)/.test(html),
  'the guide and outfit getters apply the rule to saved records');
assert(/if \(noOutfit\.has\(tripsyAttireEventBaseId\(id\)\)\) continue;/.test(extractFn('tripsyOutfitEventPersonsMap')),
  'the My Trips 👔 glyph never appears on outfitless transit');
assert(/tripsyAttireOutfitlessTransitIds\(t\)\.has\(attireEventId\)\) attireEventId = null;/.test(extractFn('renderTripsyViewPanel')),
  'the event detail panel offers no Outfit button for outfitless transit');
