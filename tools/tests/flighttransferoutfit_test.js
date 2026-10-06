// "An outfit for transportation from a flight to a hotel should always be the same as
// the outfit on the flight" (2026-10-05). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  const m = html.match(new RegExp(`\\n(async function ${name}\\(|function ${name}\\()`));
  const start = m.index + 1;
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const constLine = name => html.match(new RegExp(`\\nconst ${name} = [^\\n]*`))[0];
const src = [
  ...['TRIPSY_ATTIRE_CATEGORY_ORDER', 'TRIPSY_ATTIRE_ITEMIZED_CATEGORIES', 'TRIPSY_ATTIRE_ITEMIZED_KEY', 'TRIPSY_ATTIRE_CAMEL_KEY'].map(constLine),
  ...['tripsyAttireDaypart', 'tripsyAttireMinutesOf', 'tripsyAttireGapWithinThreeHours', 'tripsyAttireCasualSmartAdjacent',
    'tripsyAttireOutfitChangeNeeded', 'tripsyAttireIsFlightEvent', 'tripsyAttireIsAirportTransfer', 'tripsyAttireFlightTransferLinks',
    'tripsyAttireMatchTransfersToFlights', 'tripsyOutfitSyncFlightTransfers', 'computeTripsyAttireBlocks'].map(extractFn),
].join('\n');
function tripsyParse12HourTime(s) {
  const m = String(s || '').match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  return { hour: h, minute: Number(m[2]) };
}
eval(src);

const T = (id, name, startTime, category, extra = {}) => ({ id, name, startTime, endTime: null, category, resource: 'transportation', ...extra });
const E = (id, name, startTime, category) => ({ id, name, startTime, endTime: null, category, resource: 'activity' });

// Same day: the flight lands, the car is smart-casual by Claude's call -> it takes the flight's tier.
const sameDay = [{ dayKey: '2030-03-01', events: [
  T('f1', 'Flight from AAA to BBB • Air X1', '9:00 AM', 'casual'),
  T('c1', 'Car from BBB Airport → Grand Hotel', '2:00 PM', 'smart_casual'),
  E('d1', 'Dinner', '8:00 PM', 'cocktail'),
] }];
const r1 = computeTripsyAttireBlocks(sameDay);
const ev1 = sameDay[0].events;
assert(ev1[1].category === 'casual' && ev1[1].displayCategory === ev1[0].displayCategory, 'THE ASK (same day): the transfer takes the flight\'s dress code, so they share one block');
assert(r1.counts.casual === 1, 'flight + transfer count as one occasion');

// A manual override on the transfer still wins.
const ov = [{ dayKey: '2030-03-01', events: [
  T('f1', 'Flight from AAA to BBB', '9:00 AM', 'casual'),
  T('c1', 'Car from BBB Airport → Grand Hotel', '2:00 PM', 'formal', { categoryOverridden: true }),
] }];
computeTripsyAttireBlocks(ov);
assert(ov[0].events[1].category === 'formal', 'an owner override on the transfer is kept');

// Not a link: a car TO the airport, a train, a car whose previous event isn't a flight.
const notLinks = [{ dayKey: '2030-03-01', events: [
  E('h', 'Hotel', '8:00 AM', 'casual'),
  T('c2', 'Car from Grand Hotel → BBB Airport', '9:00 AM', 'smart_casual'),
  T('f2', 'Flight from BBB to CCC', '11:00 AM', 'casual'),
  T('t2', 'Train from CCC Airport → City', '2:00 PM', 'athletic'),
] }];
assert(tripsyAttireFlightTransferLinks(notLinks).length === 0, 'cars to the airport, trains, and rides not after a flight are never linked');

// Overnight flight: departs day 1, car on day 3 (the in-flight day 2 holds only a free-day placeholder).
const overnight = [
  { dayKey: '2030-03-01', events: [T('f3', 'Flight from AAA to DDD', '11:30 PM', 'casual')] },
  { dayKey: '2030-03-02', events: [{ id: 'freeday-2030-03-02', name: 'No events planned', freeDay: true, category: 'casual' }] },
  { dayKey: '2030-03-03', events: [T('c3', 'Car from DDD Airport arrival → Harbor Hotel', '8:00 AM', 'smart_casual'), E('h3', 'Harbor Hotel', '9:00 AM', 'smart_casual')] },
];
const links = tripsyAttireFlightTransferLinks(overnight);
assert(links.length === 1 && links[0].flight.id === 'f3' && links[0].transfer.id === 'c3', 'an overnight flight links to the next day\'s airport car across the placeholder day');
const r3 = computeTripsyAttireBlocks(overnight);
assert(overnight[2].events[0].category === 'casual', 'the arrival car takes the flight\'s tier');
assert(r3.counts.casual === 2, 'the arrival-day run is not counted as a NEW occasion (flight + free day only)');

// Outfits: the transfer block copies the flight block; a swap on either side holds for both.
const guide = { days: overnight };
const outfits = { blocks: [
  { dayKey: '2030-03-01', eventIds: ['f3'], garmentIds: ['jeans', 'tee', 'sneakers'] },
  { dayKey: '2030-03-02', eventIds: ['freeday-2030-03-02'], garmentIds: ['shorts', 'polo'] },
  { dayKey: '2030-03-03', eventIds: ['c3', 'h3'], garmentIds: ['chinos', 'shirt'] },
] };
assert(tripsyOutfitSyncFlightTransfers(guide, outfits) > 0, 'a mismatched transfer block is corrected');
assert(JSON.stringify(outfits.blocks[2].garmentIds) === JSON.stringify(['jeans', 'tee', 'sneakers']), 'THE ASK (overnight): the airport ride wears the flight outfit');
assert(outfits.blocks[2].wornFromFlightDayKey === '2030-03-01', 'and is marked as the same wearing as the flight');
assert(tripsyOutfitSyncFlightTransfers(guide, outfits) === 0, 'idempotent');
outfits.blocks[2].garmentIds[1] = 'henley';
tripsyOutfitSyncFlightTransfers(guide, outfits, outfits.blocks[2]);
assert(outfits.blocks[0].garmentIds[1] === 'henley', 'a swap on the transfer block carries back to the flight');
outfits.blocks[0].garmentIds[0] = 'trousers';
tripsyOutfitSyncFlightTransfers(guide, outfits, outfits.blocks[0]);
assert(outfits.blocks[2].garmentIds[0] === 'trousers', 'a swap on the flight block carries to the transfer');
assert(outfits.blocks[1].garmentIds[0] === 'shorts', 'unrelated blocks are untouched');

// Wiring.
assert(/tripsyOutfitSyncFlightTransfers\(guide, rec\)/.test(html), 'every outfit read applies the sync');
assert(/tripsyOutfitSyncFlightTransfers\(guide, outfits, block\);/.test(extractFn('showTripsyOutfitModal')), 'Swap syncs the partner block');
const compose = extractFn('composeTripsyOutfits');
assert(/!keptByIndex\.has\(i\) && !flightCopyIdx\.has\(i\)/.test(compose), 'compose never asks Claude to dress the copied transfer block');
assert(/asFlightDay \? b\.wornFromFlightDayKey/.test(extractFn('tripsyWardrobeWearDays')), 'wear days count the ride as the flight\'s wearing, not a second one');

// "Why is the attire on October 7 different than October 6?" (2026-10-06): a day spent
// entirely aboard the previous flight is an IN-FLIGHT placeholder, linked to that flight
// exactly like the airport ride, not a free day with its own outfit.
eval(['TRIPSY_ATTIRE_FREE_DAY_NAME'].map(constLine).join('\n'));
eval(['tripsyInFlightInfoForDay', 'tripsyInFlightDetailText', 'tripsyAttireMarkInFlightDays'].map(extractFn).join('\n'));
const inflightDays = [
  { dayKey: '2030-03-01', events: [T('f9', 'Flight from LAX to SIN • SQ37', '9:00 PM', 'casual')] },
  { dayKey: '2030-03-02', events: [{ id: 'freeday-2030-03-02', resource: 'activity', name: 'No events planned', freeDay: true, category: 'casual' }] },
  { dayKey: '2030-03-03', events: [T('c9', 'Car from Changi Airport arrival → Hotel', '8:00 AM', 'smart_casual')] },
  { dayKey: '2030-03-04', events: [{ id: 'freeday-2030-03-04', resource: 'activity', name: 'No events planned', freeDay: true, category: 'casual' }] },
];
const liveTrip = { events: [{ summary: 'Flight from LAX to SIN • SQ37', tripsyRaw: { resource: 'transportation', category: 'airplane', departureAt: '2030-03-01T21:00', arrivalAt: '2030-03-03T05:30', departureDescription: 'LAX', arrivalDescription: 'SIN', company: 'Singapore Airlines', transportNumber: 'SQ37' } }] };
assert(tripsyAttireMarkInFlightDays(inflightDays, liveTrip) === 1 && inflightDays[1].events[0].inFlight === true
  && /^✈️ In-flight — LAX → SIN • Singapore Airlines SQ37$/.test(inflightDays[1].events[0].name) && inflightDays[1].events[0].freeDay === true,
  'THE ASK: the whole-day-aboard placeholder is marked in-flight and named for the leg (still a placeholder: not a real event)');
assert(!inflightDays[3].events[0].inFlight, 'an ordinary free day after landing is untouched');
assert(tripsyAttireMarkInFlightDays(inflightDays, liveTrip) === 0, 'idempotent');
const il = tripsyAttireFlightTransferLinks(inflightDays);
assert(il.length === 2 && il[0].transfer.id === 'freeday-2030-03-02' && il[1].transfer.id === 'c9' && il.every(l => l.flight.id === 'f9'),
  'the in-flight day AND the arrival-day airport car both link to the flight (the placeholder never becomes the "previous event")');
computeTripsyAttireBlocks(inflightDays);
assert(inflightDays[1].events[0].category === 'casual' && inflightDays[2].events[0].category === 'casual', 'both take the flight\'s dress code');
const io = { blocks: [
  { dayKey: '2030-03-01', eventIds: ['f9'], garmentIds: ['henley', 'jeans', 'boots'] },
  { dayKey: '2030-03-02', eventIds: ['freeday-2030-03-02'], garmentIds: ['linen', 'trousers', 'oxfords'] },
  { dayKey: '2030-03-03', eventIds: ['c9'], garmentIds: ['polo', 'chinos'] },
] };
tripsyOutfitSyncFlightTransfers({ days: inflightDays }, io);
assert(JSON.stringify(io.blocks[1].garmentIds) === JSON.stringify(['henley', 'jeans', 'boots']) && io.blocks[1].wornFromFlightDayKey === '2030-03-01',
  'THE ASK: the in-flight day wears the flight outfit (one wearing), not its own');
assert(JSON.stringify(io.blocks[2].garmentIds) === JSON.stringify(['henley', 'jeans', 'boots']), 'and so does the airport car on landing');
assert(/tripsyAttireMarkInFlightDays\(filled, effectiveTrip\);/.test(extractFn('tripsyAttireBuildDays')), 'every build marks in-flight days');
assert(/tripsyAttireMarkInFlightDays\(guide\.days, trip\)/.test(html.slice(html.indexOf('async getTripsyAttireGuide(tripKey)'), html.indexOf('async saveTripsyAttireGuide'))),
  'a saved guide is retrofitted on read, so the live Oct 7 heals with no regeneration');
// "October 7 still shows a different outfit" (2026-10-06): the outfit read looked the guide up
// raw, bypassing the getter that marks in-flight days, so the link was never seen there.
assert(/const guide = await Store\.getTripsyAttireGuide\(tripKey\);\s*\n\s*if \(rec && guide\) tripsyOutfitSyncFlightTransfers\(guide, rec\);/.test(html),
  'the outfit read fetches the guide through the marking getter before syncing');
assert(/const attireGuideObj = [^\n]*\n[^\n]*\n[^\n]*\n\s*if \(attireGuideObj\) \{ try \{ tripsyAttireMarkInFlightDays\(attireGuideObj\.days, trip\); \}/.test(html),
  'the My Trips card builder marks in-flight days on its first touch of the guide');
