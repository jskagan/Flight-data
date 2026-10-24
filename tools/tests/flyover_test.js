// Trip Fly-over, phase 1 ("after a trip is over, create a fly-over map that would show
// each destination we went to … photos would play in a slideshow format when the flyover
// map showed a plane or other transportation device reaching that destination,"
// 2026-10-20). Destinations are derived from the trip (lodgings + the airports flown out
// of / home to), geocoded once and saved with their photos; the player animates them.
// Fixtures are synthetic.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') paren++;
    else if (html[i] === ')') { paren--; if (!paren) { i++; break; } }
  }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const constLine = name => (html.match(new RegExp(`const ${name} = [^\\n]*;`)) || [''])[0];
// A const whose literal spans lines (the airport-city table, the prefecture Set).
const constBlock = name => {
  const i = html.indexOf(`const ${name} =`);
  if (i < 0) return '';
  let depth = 0;
  for (let k = i; k < html.length; k++) {
    const c = html[k];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) return html.slice(i, k + 1);
  }
  return '';
};
const sliceStart = Math.min(...['TRIPSY_CITY_STATES','TRIPSY_STATE_CITIES','TRIPSY_COUNTRY_NAMES','TRIPSY_COUNTRY_ALIASES','TRIPSY_STREET_SUFFI']
  .map(n => html.indexOf('const ' + n + ' =')).filter(i => i >= 0));
const extractorEnd = html.indexOf(extractFn('tripsyPrimaryCityFromAddress')) + extractFn('tripsyPrimaryCityFromAddress').length;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function isTripsyEventEffectivelyHidden(ev) { return !!ev.hidden; }
eval([
  (html.match(/const TV_STRIP_LOC = new Set\(\[[\s\S]*?\]\);/) || [''])[0],
  html.slice(sliceStart, extractorEnd),
  constLine('TRIPSY_FLYOVER_MODE_RANK'), constLine('TRIPSY_FLYOVER_MERGE_KM'), constLine('TRIPSY_FLYOVER_SHARED_DOT_KM'), constLine('TRIPSY_FLYOVER_SAME_POINT_KM'),
  constLine('TRIPSY_TAXI_ICON_MARKER'), constLine('TRIPSY_FLYOVER_MODES'), constBlock('TRIPSY_AIRPORT_CITIES'), constBlock('TRIPSY_JP_PREFECTURES'),
  // The airport-transfer rule (2026-10-22) compares an airport's city with the stay's.
  ...['tripsyFlyoverAirportCity', 'tripsyFlyoverNameIsNonLatin', 'tripsyVerifyLodgingCity', 'tripsyDescMatchesCity', 'tripsyAirportCodeOf'].map(extractFn),
  ...['tripsyFlyoverModeOf', 'tripsyFlyoverAirportQuery', 'tripsyFlyoverDeriveStops', 'tripsyFlyoverDistanceKm',
    'tripsyFlyoverMergeNearby', 'tripsyFlyoverCarryOver', 'tripsyFlyoverGreatCircle', 'tripsyFlyoverStraight',
    'tripsyFlyoverUnwrap', 'tripsyFlyoverPlayableStops', 'tripsyFlyoverLegMs'].map(extractFn),
].join('\n'));

const leg = (id, category, summary, dep, arr, depAt, arrAt) => ({ id: 't' + id, summary, start: depAt, end: arrAt,
  tripsyRaw: { resource: 'transportation', id, category, departureDescription: dep, arrivalDescription: arr, departureAt: depAt, arrivalAt: arrAt } });
const stay = (id, name, address, start, end) => ({ id: 'h' + id, summary: name, start, end, tripsyRaw: { resource: 'hosting', id, name, address } });
const act = (id, name, start) => ({ id: 'a' + id, summary: name, start, end: start, tripsyRaw: { resource: 'activity', id, name } });
const trip = { key: 'T1', name: 'Test trip', events: [
  leg(1, 'airplane', 'Flight from LAX to LHR • Air Test AT1', 'LAX', 'LHR', '2030-05-01T18:00:00', '2030-05-02T12:00:00'),
  leg(2, 'car', 'Car from Heathrow → The Example Hotel', 'Heathrow', 'The Example Hotel', '2030-05-02T13:00:00', '2030-05-02T14:00:00'),
  stay(10, 'The Example Hotel', '1 High St, London W1 1AA, United Kingdom', '2030-05-02T15:00:00', '2030-05-05T11:00:00'),
  act(20, 'Museum', '2030-05-03T10:00:00'),
  stay(11, 'Second Example Hotel', '9 Low Rd, London SW1 2BB, United Kingdom', '2030-05-05T15:00:00', '2030-05-06T11:00:00'),
  leg(3, 'train', 'Train from London to Paris', 'London', 'Paris', '2030-05-06T12:00:00', '2030-05-06T15:00:00'),
  stay(12, 'Hôtel Exemple', '5 Rue Test, 75001 Paris, France', '2030-05-06T16:00:00', '2030-05-09T11:00:00'),
  leg(4, 'car', 'Car from Hôtel Exemple → CDG', 'Hôtel Exemple', 'CDG', '2030-05-09T08:00:00', '2030-05-09T09:00:00'),
  leg(5, 'airplane', 'Flight from CDG to LAX • Air Test AT2', 'CDG', 'LAX', '2030-05-09T12:00:00', '2030-05-09T15:00:00'),
  { ...stay(13, 'Hidden Hotel', '1 Nowhere, Rome, Italy', '2030-05-07T15:00:00', '2030-05-08T11:00:00'), hidden: true },
] };

// ---- destinations ----
const derived = tripsyFlyoverDeriveStops(trip);
assert(derived.map(s => s.kind + ':' + s.label).join(',') === 'origin:LAX,stay:London,stay:London,stay:Paris,return:LAX',
  'THE ASK: origin airport, each stay, and the airport flown home to -> ' + derived.map(s => s.kind + ':' + s.label).join(' | '));
assert(derived[2].mode === 'car', 'moving hotels across town is a ground leg');
// Two hotels in one city are one destination once placed (by city name or distance).
const stops = tripsyFlyoverMergeNearby(derived.map(s => ({ ...s, names: [...s.names] })));
assert(stops.map(s => s.kind).join(',') === 'origin,stay,stay,return',
  'consecutive stays in one city merge -> ' + stops.map(s => s.kind + ':' + s.label).join(' | '));
assert(stops[1].label === 'London' && stops[1].names.join('|') === 'The Example Hotel|Second Example Hotel',
  'the merged destination keeps both hotel names');
assert(stops[1].end === '2030-05-06T11:00:00', 'the merged stop runs to the later stay\'s check-out');
assert(stops[2].label === 'Paris', 'the next city is its own stop -> ' + stops[2].label);
assert(!derived.some(s => /Rome/.test(s.query)), 'a hidden lodging is not a destination');
assert(stops[0].query === 'LAX airport' && stops[3].query === 'LAX airport', 'a bare airport code geocodes as "<code> airport"');
assert(stops[0].mode === '' && stops[1].mode === 'plane', 'the origin has no arrival leg; London is reached by plane (the flight outranks the car to the hotel)');
assert(stops[2].mode === 'train', 'Paris is reached by train -> ' + stops[2].mode);
assert(stops[3].mode === 'plane', 'home is reached by plane, the car to the airport notwithstanding');
assert(stops[1].id === 'hosting-10' && stops[0].id === 'origin' && stops[3].id === 'return', 'stable ids, so a rebuild keeps each stop\'s photos');
// The same hotel as several records is one stay; a date-only check-in (midnight) still
// comes AFTER the morning flight that gets you there -- ordering is by day.
const ski = { key: 'T3', events: [
  stay(1, 'Mountain Lodge', '1 Main St, Telluride, CO', '2030-03-10', '2030-03-15'),
  stay(2, 'Mountain Lodge', '1 Main St, Telluride, Colorado', '2030-03-10T15:00:00', '2030-03-15T11:00:00'),
  leg(1, 'airplane', 'Flight from LAX to DEN', 'Los Angeles (LAX)', 'Denver (DEN)', '2030-03-10T08:45:00', '2030-03-10T12:00:00'),
  leg(2, 'airplane', 'Flight from DEN to MTJ', 'Denver (DEN)', 'Montrose (MTJ)', '2030-03-10T13:30:00', '2030-03-10T14:30:00'),
  leg(3, 'airplane', 'Flight from MTJ to LAX', 'Montrose (MTJ)', 'Los Angeles (LAX)', '2030-03-15T14:00:00', '2030-03-15T16:00:00'),
] };
const sk = tripsyFlyoverDeriveStops(ski);
// Since the airport-transfer rule (2026-10-22) Montrose, the airport for a lodge in
// Telluride, is a transit stop on both sides: the flight lands there and a (guessed) ride
// reaches the lodge; the trip home starts with a ride back to it.
assert(sk.map(s => s.kind).join(',') === 'origin,transit,stay,transit,return' && sk[1].mode === 'plane' && sk[2].mode === 'car' && sk[2].modeGuessed === true,
  'a date-only stay still gets its origin, one stay for duplicate records, and a flight in -- via the Montrose airport transfer -> ' + sk.map(s => s.kind + ':' + s.label + ':' + s.mode).join(' | '));
assert(sk[1].label === 'Montrose' && sk[3].label === 'Montrose' && sk[3].modeGuessed === true && sk[4].mode === 'plane',
  'both transfers are named for the airport\'s city; the ride back to it is a guess the page asks about; the flight home leaves from it');
assert(sk.filter(s => s.kind === 'stay').length === 1, 'transfers are not stays (no photos, not numbered)');

// ---- airport transfers (2026-10-22) ----
// "there is a walk to beppu followed by a flight from Fukuoka to Seoul. The user must get
// from beppu to Fukuoka on that day": the flight into Seoul really leaves from Fukuoka, so a
// transit stop goes in before Seoul, reached by a guessed ride (nothing on the trip says how).
const jp = { key: 'T7', events: [
  leg(1, 'airplane', 'Flight from LAX to FUK', 'LAX', 'FUK', '2030-10-01T10:00:00', '2030-10-02T16:00:00'),
  stay(1, 'The Ritz-Carlton Fukuoka', '2-6-50 Daimyo, Chuo-ku, Chuo-ku Fukuoka Japan, 810-0041', '2030-10-02T15:00:00', '2030-10-04T11:00:00'),
  stay(2, 'Marugamiya', '4 Kumi, Miyuki Kanzawa, Beppu, Oita 874-0045, Japan', '2030-10-04T16:00:00', '2030-10-05T11:00:00'),
  leg(2, 'airplane', 'Flight from FUK to ICN', 'FUK', 'ICN', '2030-10-05T15:50:00', '2030-10-05T17:20:00'),
  stay(3, 'Andaz Seoul Gangnam', '854 Nonhyeon-ro, Gangnam-gu, Seoul, South Korea', '2030-10-05T15:00:00', '2030-10-08T11:00:00'),
  leg(3, 'airplane', 'Flight from ICN to LAX', 'ICN', 'LAX', '2030-10-08T19:40:00', '2030-10-08T14:00:00'),
] };
const jps = tripsyFlyoverDeriveStops(jp);
const jpk = jps.map(s => s.kind + ':' + s.label + ':' + s.mode + (s.modeGuessed ? '?' : '')).join(' | ');
assert(jps.map(s => s.kind).join(',') === 'origin,stay,stay,transit,stay,return', 'THE ASK: Beppu -> [Fukuoka airport] -> Seoul -> ' + jpk);
assert(jps[3].kind === 'transit' && jps[3].label === 'Fukuoka' && jps[3].mode === 'car' && jps[3].modeGuessed === true && jps[3].id === 'transit-dep-2',
  'the ride to the airport is a guessed drive the setup page asks about, named for the airport\'s city, keyed to the flight');
assert(jps[4].mode === 'plane' && !jps[4].modeGuessed, 'Seoul is then reached by the flight, from the airport');
assert(jps[1].mode === 'plane' && jps.filter(s => s.kind === 'transit').length === 1, 'FUK for a hotel in Fukuoka needs no transfer, nor ICN for a hotel in Seoul, nor the flight home from Seoul');
assert(jps[2].city === 'Beppu' && jps[1].city === 'Fukuoka', 'stays carry the town their address names (the Verify page\'s own city rule)');
// A ground leg on the trip before the flight IS the ride: its mode, no question.
const jp2 = { key: 'T8', events: [...jp.events, leg(9, 'taxi', 'Taxi from Marugamiya to Fukuoka Airport', 'Marugamiya, Beppu', 'Fukuoka airport (FUK)', '2030-10-05T12:00:00', '2030-10-05T13:40:00')] };
const jp2s = tripsyFlyoverDeriveStops(jp2);
assert(jp2s[3].kind === 'transit' && jp2s[3].mode === 'taxi' && !jp2s[3].modeGuessed, 'a taxi leg to the airport on the trip gives the transfer its mode (taxi) with no question -> ' + jp2s[3].mode);
assert(tripsyFlyoverModeOf({ category: 'taxi' }, '') === 'taxi' && tripsyFlyoverModeOf({ category: 'car' }, '') === 'car', 'a taxi leg is a taxi, a car a car');
// Arrival side: a flight landing in another city than the stay's lands at a transfer, and
// the stay is reached by the ground leg after it (or a guessed drive).
const vn = { key: 'T9', events: [
  leg(1, 'airplane', 'Flight from SIN to DAD', 'SIN', 'DAD', '2030-10-01T10:00:00', '2030-10-01T12:00:00'),
  leg(2, 'car', 'Car from Da Nang airport to Nam Hai', 'Da Nang International Airport (DAD)', 'Four Seasons The Nam Hai', '2030-10-01T12:30:00', '2030-10-01T13:15:00'),
  stay(1, 'Four Seasons The Nam Hai', 'Block Ha My Dong B, Dien Duong, Hoi An, Vietnam', '2030-10-01T15:00:00', '2030-10-04T11:00:00'),
  leg(3, 'airplane', 'Flight from DAD to SIN', 'DAD', 'SIN', '2030-10-04T15:00:00', '2030-10-04T17:00:00'),
] };
const vns = tripsyFlyoverDeriveStops(vn);
assert(vns.map(s => s.kind + ':' + s.label + ':' + s.mode).join(' | ') === 'origin:SIN: | transit:Da Nang:plane | stay:Hoi An:car | transit:Da Nang:car | return:SIN:plane',
  'a flight into Da Nang for a hotel in Hoi An lands at a transfer; the car on the trip reaches the hotel -> ' + vns.map(s => s.kind + ':' + s.label + ':' + s.mode).join(' | '));
assert(!vns[2].modeGuessed && vns[3].modeGuessed === true, 'the car in is on the trip (no question); nothing says how you got back to the airport (asked)');
// Lenient where a city can't be told: an unknown bare code, or an airport's city named in
// the stay's own address (a hotel whose address parses to its state) -- no transfer invented.
const or = { key: 'T10', events: [
  leg(1, 'airplane', 'Flight from DFW to PDX', 'DFW', 'PDX', '2030-09-19T13:10:00', '2030-09-19T15:00:00'),
  stay(1, 'RIVERPLACE', '1510 HARBOR WAY, Portland, OR, 97201', '2030-09-19T17:05:00', '2030-09-21T11:00:00'),
  leg(2, 'airplane', 'Flight from PDX to DFW', 'PDX', 'DFW', '2030-09-21T12:25:00', '2030-09-21T18:00:00'),
] };
assert(tripsyFlyoverDeriveStops(or).every(s => s.kind !== 'transit'), 'Portland named in the address: no transfer for a hotel whose address parses to "OR"');
const zz = { key: 'T11', events: [
  leg(1, 'airplane', 'Flight from LAX to ZZZ', 'LAX', 'ZZZ', '2030-09-19T13:10:00', '2030-09-19T15:00:00'),
  stay(1, 'Somewhere Inn', '1 Road, Faraway, Nowhere', '2030-09-19T17:05:00', '2030-09-21T11:00:00'),
] };
assert(tripsyFlyoverDeriveStops(zz).every(s => s.kind !== 'transit'), 'an airport code the table does not know never plants a transfer');
// A stay dated after the flight home (old records) takes that flight too; landing back in
// the ORIGIN's city is the trip home, not a transfer.
const old = { key: 'T12', events: [
  leg(1, 'airplane', 'Flight from LAX to SJC', 'LAX', 'SJC', '2011-12-07T12:10:00', '2011-12-07T13:15:00'),
  stay(1, 'Four Seasons Silicon Valley', '2050 University Ave, East Palo Alto, U.S.A', '2011-12-08T15:00:00', '2011-12-08T18:00:00'),
  leg(2, 'airplane', 'Flight from SJC to LAX', 'SJC', 'LAX', '2011-12-08T21:20:00', '2011-12-08T22:45:00'),
] };
assert(tripsyFlyoverDeriveStops(old).every(s => s.kind !== 'transit-arr' && !String(s.id).startsWith('transit-arr')), 'a mis-filed flight home plants no arrival transfer');
// Taxi is a pickable mode with its own picture, ranked with the car.
// (the consts eval'd above live in that eval's own scope, so these are source checks)
assert(/const TRIPSY_FLYOVER_MODES = \[[^\]]*'taxi'/.test(html) && /const TRIPSY_FLYOVER_MODE_RANK = \{[^}]*car: 1, taxi: 1/.test(html) && /taxi: 'Taxi'/.test(html),
  'taxi is in the mode list ("there is no taxi option appearing"), labelled, and ranks as a drive');
assert(/data-fe-add-after/.test(html) && /addDestination\(i \+ 1\)/.test(html), 'Edit destinations: a + on every row adds a destination right after it');
// Each leg reads FROM → TO, both editable (2026-10-22); the origin is the previous shown stop.
eval(extractFn('tripsyFlyoverLegFromIndex'));
const legStops = [{ id: 'a' }, { id: 'b', removed: true }, { id: 'c' }, { id: 'd' }];
assert(tripsyFlyoverLegFromIndex(legStops, 0) === -1 && tripsyFlyoverLegFromIndex(legStops, 2) === 0 && tripsyFlyoverLegFromIndex(legStops, 3) === 2,
  'a leg starts at the nearest earlier stop still shown (a removed one is skipped); the first stop has no leg in');
const feDlg = extractFn('tripsyFlyoverEditDestinationsDialog');
assert(/data-fe-from data-fe-from-id=/.test(feDlg) && /data-fe-label/.test(feDlg) && /data-fe-from-place/.test(feDlg),
  'the row shows an editable origin (with its own 📍) and an editable destination');
assert(/update\(fromId, \{ label: v, labelEdited: true \}\)/.test(feDlg) && /update\(id, \{ label: v, labelEdited: true \}\);\s*render\(\)/.test(feDlg),
  'editing the origin renames the previous stop, and either edit re-renders so both rows agree');
assert(/data-mode-select/.test(html) && /<select[^>]*data-mode-select/.test(html), 'the mode question is a drop-down');
assert(/b\.kind === 'transit'\) \{ if \(!\(await wait\(r, 900\)\)\) return; continue; \}/.test(html), 'the player passes through a transfer like a layover (no arrival, no photos)');
assert(/\(dx > 0\) !== facesRight/.test(html), 'the taxi picture faces right, so it flips the other way round');
// ---- photos show at once, upload in the background (2026-10-22) ----
// "There is a massive delay from the time I select photos for the flyover until they appear
// in the flyover pages. Can we reduce that delay?"
eval([extractFn('tripsyFlyoverResolvePendingIds'), extractFn('tripsyFlyoverDropLostPending')].join('\n'));
{
  const rec = { tripKey: 'T', stops: [{ id: 's1', photos: [{ driveFileId: 'pending-a' }, { driveFileId: 'real1' }], pages: [{ ids: ['pending-a', 'real1'], count: 2 }] }, { id: 's2', photos: [{ driveFileId: 'pending-b' }] }] };
  const map = new Map([['pending-a', 'drive-A']]);
  const out = tripsyFlyoverResolvePendingIds(rec, map);
  assert(out !== rec && out.stops[0].photos[0].driveFileId === 'drive-A' && out.stops[0].pages[0].ids.join(',') === 'drive-A,real1',
    'an uploaded photo\'s pending id is swapped for its Drive id in the stop\'s photos AND its pages');
  assert(out.stops[1].photos[0].driveFileId === 'pending-b' && rec.stops[0].photos[0].driveFileId === 'pending-a', 'a still-pending id is left; the input is not mutated');
  assert(tripsyFlyoverResolvePendingIds(rec, new Map()) === rec, 'nothing uploaded -> the same record back');
  const lost = tripsyFlyoverDropLostPending(rec, id => id === 'pending-a');
  assert(lost.dropped === 1 && lost.record.stops[1].photos.length === 0 && lost.record.stops[0].photos.length === 2 && lost.record.stops[0].pages[0].ids.length === 2,
    'a pending photo whose bytes are gone is dropped (from its pages too); one still held stays');
  assert(tripsyFlyoverDropLostPending(rec, () => true).dropped === 0, 'nothing lost -> nothing dropped');
}
assert(/const _driveFolderIdMemo = new Map\(\)/.test(html) && /if \(_driveFolderIdMemo\.has\(folderName\)\) return _driveFolderIdMemo\.get\(folderName\)/.test(html),
  'the Drive folder id is looked up once per session, not once per photo');
assert(/const TRIPSY_FLYOVER_UPLOAD_PARALLEL = 3/.test(html) && /tripsyFlyoverQueueUpload\(trip\.key, pendingId\)/.test(html) && /if \(queued\) \{ save\(\); if \(!closed\) render\(\); \}/.test(html),
  'picked photos are staged with pending ids, rendered at once, and uploaded three at a time in the background');
assert(/driveFileId\.startsWith\('pending-'\)\) \{\s*if \(tripsyFlyoverUploadedIds\.has\(driveFileId\)\) return tripsyPlacePhotoDisplayUrl/.test(html),
  'tripsyPlacePhotoDisplayUrl paints a pending photo from its local bytes (and follows an uploaded one to its Drive id)');
assert(/document\.addEventListener\('tripsy-flyover-upload', onUpload\)/.test(html) && /document\.removeEventListener\('tripsy-flyover-upload', onUpload\)/.test(html),
  'the setup page repaints when an upload lands and unhooks on close');
assert(/const lost = tripsyFlyoverDropLostPending\(record\)/.test(html) && /data-flyover-retry-upload/.test(html),
  'a reload mid-upload drops the lost photos with a message; a failed upload offers Retry');

// ---- play a part of the journey (2026-10-22) ----
// "present him with a numbered list of the cities visited and ask whether he wants to view
// the entire journey or allow him to select a starting and ending city. If he selects a
// start and end, only show the portion of the flyover that relates to those cities"
eval(extractFn('tripsyFlyoverRangeStops'));
const route = ['o', 'a', 'b', 'c', 'r'].map(id => ({ id, label: id.toUpperCase() }));
assert(tripsyFlyoverRangeStops(route, 'a', 'c').map(s => s.id).join('') === 'abc', 'from A to C plays A, B, C');
assert(tripsyFlyoverRangeStops(route, 'c', 'a').map(s => s.id).join('') === 'abc', 'a reversed pair is swapped');
assert(tripsyFlyoverRangeStops(route, 'zzz', 'b').map(s => s.id).join('') === 'oab', 'an unknown start falls back to the departure');
assert(tripsyFlyoverRangeStops(route, 'b', undefined).map(s => s.id).join('') === 'bcr', 'no end plays through to the home airport');
assert(tripsyFlyoverRangeStops(route, 'b', 'b').length === 1, 'the same city twice is one stop (the dialog refuses it; the player would just land there)');
assert(/tripsyFlyoverRangeDialog\(record, range =>/.test(html) && /const extra = !range \? \{\} : range\.previewStopId \? \{ previewStopId: range\.previewStopId \} : \{ range \};\s*tripsyFlyoverMapChoiceDialog\(mapService => playTripsyFlyover\(trip, record, \{ mapService, \.\.\.extra \}\)\)/.test(html),
  'the setup page\'s Play asks whole / part / one slideshow first, then which map, and passes the range or the one destination to the player');
assert(/data-range-all/.test(html) && /data-range-from/.test(html) && /data-range-to/.test(html) && /data-range-part/.test(html) && /<ol/.test(extractFn('tripsyFlyoverRangeDialog')),
  'the dialog lists the cities numbered, with Entire journey and From/To + Play this part');
assert(/if \(opts\.range\) return tripsyFlyoverRangeStops\(all, opts\.range\.fromId, opts\.range\.toId\)/.test(html) && !/if \(preview\) stops = stops\.filter/.test(html),
  'the player cuts its stops to the range in BOTH places it computes them (one cutStops helper)');
// Retrofit of a saved fly-over: each derived transfer goes in before the stop that follows
// it; that stop takes the derived mode/layovers unless its transport was set by hand.
eval(extractFn('tripsyFlyoverInsertTransitStops'));
const saved = [{ id: 'origin', label: 'LAX' }, { id: 'hosting-1', label: 'Fukuoka', mode: 'plane' }, { id: 'hosting-2', label: 'Beppu', mode: 'hike', modeManual: true }, { id: 'hosting-3', label: 'Seoul', mode: 'plane', via: [{ label: 'X' }] }, { id: 'return', label: 'LAX', mode: 'plane' }];
const ins = tripsyFlyoverInsertTransitStops(saved, jps);
assert(ins.changed && ins.stops.map(s => s.id).join(',') === 'origin,hosting-1,hosting-2,transit-dep-2,hosting-3,return', 'the transfer is inserted before Seoul -> ' + ins.stops.map(s => s.id).join(','));
assert(ins.stops[3].photos.length === 0 && ins.stops[4].mode === 'plane' && ins.stops[4].via === undefined && ins.stops[2].mode === 'hike', 'no photos on the transfer; Seoul takes the derived leg (its stale layover dropped); the hand-set hike is kept');
assert(!tripsyFlyoverInsertTransitStops(ins.stops, jps).changed, 'idempotent');
const vnIns = tripsyFlyoverInsertTransitStops([{ id: 'origin' }, { id: 'hosting-1', mode: 'plane', modeManual: true }, { id: 'return', mode: 'plane' }], vns);
assert(vnIns.stops.map(s => s.id).join(',') === 'origin,transit-arr-1,hosting-1,transit-dep-3,return' && vnIns.stops[2].mode === 'plane', 'both transfers inserted; a hand-set mode on the stay is never replaced');
// A leg departing AFTER the next hotel's nominal check-in hour, on the moving day, still
// arrives at that hotel (the flight to Seoul left after the Seoul hotel's 15:00).
const late = { key: 'T4', events: [
  stay(1, 'Inn A', '1 Rd, Fukuoka, Japan', '2030-04-01T15:00:00', '2030-04-05T11:00:00'),
  stay(2, 'Inn B', '2 Rd, Seoul, South Korea', '2030-04-05T15:00:00', '2030-04-08T11:00:00'),
  leg(1, 'airplane', 'Flight from FUK to ICN', 'FUK', 'ICN', '2030-04-05T17:00:00', '2030-04-05T18:30:00'),
] };
assert(tripsyFlyoverDeriveStops(late)[1].mode === 'plane', 'a moving-day flight after the nominal check-in still counts as how you got there');
// No lodging, no usable flight arrival: the trip's own location is the destination.
const camp = { key: 'T5', location: 'Black Rock City, NV', events: [
  leg(1, 'airplane', 'Flight from BUR', 'BUR', '', '2030-08-31T14:30:00', '2030-08-31T16:00:00'),
  leg(2, 'airplane', 'Flight to BUR', '', 'BUR', '2030-09-06T14:00:00', '2030-09-06T15:30:00'),
] };
const cs = tripsyFlyoverDeriveStops(camp);
assert(cs.map(s => s.kind).join(',') === 'origin,stay,return' && cs[1].query === 'Black Rock City, NV',
  'no lodging: the trip location stands in as the destination -> ' + cs.map(s => s.kind + ':' + s.label).join(' | '));

// A trip with no lodging: each flight's arrival is a destination.
const hop = { key: 'T2', events: [
  leg(1, 'airplane', 'Flight from LAX to SFO', 'LAX', 'SFO', '2030-06-01T08:00:00', '2030-06-01T09:30:00'),
  leg(2, 'airplane', 'Flight from SFO to LAX', 'SFO', 'LAX', '2030-06-01T18:00:00', '2030-06-01T19:30:00'),
] };
const hs = tripsyFlyoverDeriveStops(hop);
assert(hs.map(s => s.label).join(',') === 'LAX,SFO,LAX', 'no lodging: the departure airport, then each flight\'s arrival -> ' + hs.map(s => s.label).join(','));
{ const only = tripsyFlyoverDeriveStops({ events: [act(1, 'Lunch', '2030-01-01T12:00:00')] });
  assert(only.length === 1 && only[0].needsPlace, 'nothing placeable on the trip -> one placeholder to ask the owner about'); }
assert(tripsyFlyoverModeOf({ category: 'roadtrip' }, 'Roadtrip from A to B') === 'car' && tripsyFlyoverModeOf({ category: '' }, 'Ferry to the island') === 'boat',
  'modes: a road trip drives, an uncategorized ferry sails');

// ---- after geocoding ----
const geo = [
  { id: 'origin', kind: 'origin', label: 'Los Angeles', lat: 33.94, lng: -118.41, names: [], photos: [] },
  { id: 'a', kind: 'stay', label: 'Shoreditch', lat: 51.52, lng: -0.08, names: ['A'], end: 'x' },
  { id: 'b', kind: 'stay', label: 'Mayfair', lat: 51.51, lng: -0.15, names: ['B'], end: 'y', photos: [{ driveFileId: 'p' }] },
  { id: 'c', kind: 'stay', label: 'Paris', lat: 48.86, lng: 2.35, names: [] },
  { id: 'return', kind: 'return', label: 'Los Angeles', lat: 33.94, lng: -118.41, names: [] },
];
const merged = tripsyFlyoverMergeNearby(geo.map(s => ({ ...s, names: [...s.names] })));
assert(merged.map(s => s.id).join(',') === 'origin,a,c,return', 'two stays a few km apart are one destination on the map -> ' + merged.map(s => s.id).join(','));
assert(merged[1].end === 'y' && merged[1].photos.length === 1, 'the merged stop keeps the later end and both stops\' photos');

// ---- carrying the owner's work across a rebuild ----
const prev = [
  { id: 'origin', kind: 'origin', label: 'Home', autoLabel: 'Los Angeles', labelEdited: true, photos: [{ driveFileId: 'o1' }] },
  { id: 'hosting-OLD', kind: 'stay', label: 'Paris', autoLabel: 'Paris', removed: true, photos: [{ driveFileId: 'p1' }] },
];
const carried = tripsyFlyoverCarryOver([
  { id: 'origin', kind: 'origin', label: 'Los Angeles' },
  { id: 'hosting-NEW', kind: 'stay', label: 'Paris' },
  { id: 'hosting-X', kind: 'stay', label: 'Lyon' },
], prev);
assert(carried[0].label === 'Home' && carried[0].photos[0].driveFileId === 'o1', 'a renamed stop keeps its name and photos on rebuild');
assert(carried[1].removed === true && carried[1].photos.length === 1, 'a removed stop matched by city stays removed (a rebuild never resurrects it), photos kept');
assert(carried[2].autoLabel === 'Lyon' && carried[2].photos.length === 0 && !carried[2].removed, 'a new stop starts with no photos');

// ---- the route geometry ----
const gc = tripsyFlyoverGreatCircle({ lat: 33.94, lng: -118.41 }, { lat: 1.36, lng: 103.99 }, 64);
assert(gc.length === 64 && Math.abs(gc[0][0] - 33.94) < 1e-6 && Math.abs(gc[63][0] - 1.36) < 1e-6, 'a great circle runs end to end');
const jumps = gc.slice(1).map((p, i) => Math.abs(p[1] - gc[i][1]));
assert(Math.max(...jumps) < 20, 'LAX -> SIN never jumps across the map at the date line (longitudes unwrapped) -> max step ' + Math.max(...jumps).toFixed(1));
assert(gc[63][1] < -180, 'it crosses the Pacific: Singapore is reached at an unwrapped longitude west of -180 -> ' + gc[63][1].toFixed(1));
const mid = gc[32];
assert(mid[0] > 33.94, 'and bows north of both ends, as a long-haul great circle does -> ' + mid[0].toFixed(1));
const st = tripsyFlyoverStraight({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 3);
assert(JSON.stringify(st) === '[[0,0],[5,10],[10,20]]', 'a ground leg is a straight line');
const play = tripsyFlyoverPlayableStops({ stops: [
  { id: 'a', lat: 33.9, lng: -118.4 }, { id: 'x', lat: null, lng: null }, { id: 'r', removed: true, lat: 0, lng: 0 },
  { id: 'b', lat: 1.36, lng: 103.99 }, { id: 'c', lat: 35.6, lng: 139.7 },
] });
assert(play.map(s => s.id).join(',') === 'a,b,c', 'playback skips stops that couldn\'t be placed and stops the owner removed');
assert(play[1].lng < -180 && play[2].lng < -180, 'stop longitudes are unwrapped in sequence too, so the whole route stays continuous');
assert(tripsyFlyoverLegMs('plane', 14000) === 7000 && tripsyFlyoverLegMs('plane', 300) === 2600 && tripsyFlyoverLegMs('car', 50) === 2200,
  'leg durations scale with distance within bounds');

// ---- menu + wiring ----
eval([extractFn('tripsyFlyoverMenuItems'), extractFn('tripsyFlyoverTripOver'), extractFn('tripsyFlyoverStopVisited')].join('\n'));
global.tripsyItineraryEndDayKey = t => t.endKey;
global.tripsyDayKey = v => (v ? String(v).slice(0, 10) : null);
// 2026-10-20: "Allow the feature to run on existing trips (non-finished) … when there is no
// trip fly-over started, have the menu item be 'Start Fly-Over'. If it is started but not
// finished it should read 'Finish Fly-Over'. After it is completed, there should be options
// to view it or edit it."
const labels = (o, r) => tripsyFlyoverMenuItems(o, r).map(i => i.mode + ':' + i.label).join(',');
assert(labels(true, null) === 'edit:Start Fly-Over', 'owner, nothing built yet -> Start Fly-Over (on ANY trip, finished or not)');
assert(labels(true, { stops: [{}] }) === 'edit:Finish Fly-Over', 'owner, started -> Finish Fly-Over');
assert(labels(true, { stops: [{}], completedAt: 'x' }) === 'view:View Fly-Over,edit:Edit Fly-Over', 'owner, completed -> View and Edit');
assert(labels(false, null) === '' && labels(false, { stops: [{}] }) === '', 'a viewer sees nothing until the fly-over is completed');
assert(labels(false, { stops: [{}], completedAt: 'x' }) === 'view:View Fly-Over', 'then a viewer can View it (no Edit)');
assert(tripsyFlyoverTripOver({ endKey: '2030-05-09' }, '2030-05-10') && !tripsyFlyoverTripOver({ endKey: '2030-05-09' }, '2030-05-09'),
  'completing needs the trip to be OVER (its last day before today)');
assert(tripsyFlyoverStopVisited({ start: '2030-05-03T15:00:00' }, '2030-05-03') && !tripsyFlyoverStopVisited({ start: '2030-05-04T15:00:00' }, '2030-05-03'),
  'THE ASK: a destination is visited from its first day on -- before that, no photos');
assert(tripsyFlyoverStopVisited({ start: '' }, '2030-05-03'), 'a stop with no date never locks its photos');
const setupSrc = extractFn('showTripsyFlyover');
assert(/!tripsyFlyoverStopVisited\(s, todayKey\)\s*\? `<span[^`]*🔒 Photos open once you get here/.test(setupSrc),
  'an unvisited destination shows a lock line INSTEAD of the photo buttons');
assert(/data-flyover-complete \$\{tripOver \? '' : 'disabled'\}/.test(setupSrc), 'Complete Fly-Over is disabled until the trip is over');
assert(/completedAt: new Date\(\)\.toISOString\(\)/.test(setupSrc) && /renderTripsyEventsList\(\);/.test(setupSrc), 'completing stamps completedAt and re-renders the menu');
assert(/if \(prevRecord && prevRecord\.completedAt\) rec\.completedAt = prevRecord\.completedAt;/.test(extractFn('tripsyFlyoverBuild')), 'a rebuild from Edit keeps the fly-over completed');
assert(/tripsyFlyoverMenuItems\(isOwner, Store\.getTripsyFlyover\(trip\.key\)\)\.map\(it => menuListButtonHtml\(`data-tripsy-flyover data-mode="\$\{it\.mode\}"/.test(html), 'the ⚙️ Trip menu carries the state-dependent items');
assert(/btn\.dataset\.mode === 'view'[\s\S]{0,700}playTripsyFlyover\(trip, record, layovers \? \{ layovers \} : \{\}\)/.test(html), 'View plays the fly-over straight away');
assert(/container\.querySelectorAll\("\[data-tripsy-flyover\]"\)[\s\S]{0,2600}showTripsyFlyover\(btn\.dataset\.key\)/.test(html), 'Start/Finish/Edit open the setup page');
assert(/driveData\.tripsyFlyovers = driveData\.tripsyFlyovers\.filter\(r => keys\.has\(r\.tripKey\)\)/.test(extractFn('pruneDriveDataInMemory')),
  'prune rule: a fly-over goes when its trip does');
const player = extractFn('playTripsyFlyover');
assert(/tripsyPlacePhotoDisplayUrl\(p\.driveFileId\)\.catch/.test(player), 'every photo starts downloading before playback, so each is ready on arrival');
assert(/if \(!r\.paused\) elapsed \+= now - last;/.test(player) && /if \(!r\.paused\) left -= now - last;/.test(player), 'pause freezes both the moving vehicle and the slideshow clock');
assert(/run\.cancelled = true;[\s\S]{0,80}map\.remove\(\)/.test(player), 'closing cancels the run and tears the map down');
assert(/tripsyFlyoverLoadLeaflet\._p = null/.test(extractFn('tripsyFlyoverLoadLeaflet')), 'a failed map-library load is retried next time, not remembered');

// ---- a trip with NO location anywhere asks the owner (2026-10-20: "For locations such as
// burning man that do not have a location, have the map ask user for the location name") ----
const bare = { key: 'T6', location: '', events: [
  leg(1, 'airplane', 'Flight from BUR', 'BUR', '', '2030-08-31T14:30:00', '2030-08-31T16:00:00'),
  leg(2, 'airplane', 'Flight to BUR', '', 'BUR', '2030-09-06T14:00:00', '2030-09-06T15:30:00'),
] };
const bs = tripsyFlyoverDeriveStops(bare);
assert(bs.map(s => s.kind).join(',') === 'origin,stay,return' && bs[1].needsPlace === true && bs[1].id === 'location',
  'no lodging and no location: a placeholder destination flagged needsPlace sits between the flights -> ' + bs.map(s => s.kind + ':' + (s.needsPlace ? '?' : s.label)).join(' | '));
assert(bs[1].mode === 'plane', 'and is still reached by plane');
(async () => {
  eval(extractFn('tripsyFlyoverBuild'));
  global.tripsyFlyoverGeocodeVias = async st => st;
  global.tripsyFlyoverApplyAirportCities = r => ({ record: r, changed: false });
  global.TRIPSY_FLYOVER_LAYOVERS_V = 2;
  global.TRIPSY_FLYOVER_TRANSIT_V = 1;
  const geo = { 'BUR airport': { lat: 34.2, lng: -118.36, city: 'Burbank' } };
  global.tripsyFlyoverGeocode = async q => geo[q] || null;
  let asked = [];
  const answer = r => async s => { asked.push(s.id); return r; };
  let rec = await tripsyFlyoverBuild(bare, null, { askPlace: answer({ lat: 40.78, lng: -119.2, label: 'Black Rock City', query: 'Black Rock City' }) });
  const loc = rec.stops.find(s => s.id === 'location');
  assert(asked.join(',') === 'location', 'THE ASK: only the unplaceable stop is asked about');
  assert(loc.label === 'Black Rock City' && loc.lat === 40.78 && loc.manualPlace === 'Black Rock City' && !loc.removed,
    'a found match is used, under the name the owner typed');
  asked = [];
  rec = await tripsyFlyoverBuild(bare, rec, { askPlace: answer(null) });
  assert(asked.length === 0 && rec.stops.find(s => s.id === 'location').lat === 40.78, 'a rebuild reuses the typed place without asking again');
  asked = [];
  let none = await tripsyFlyoverBuild(bare, null, { askPlace: answer(null) });
  const nloc = none.stops.find(s => s.id === 'location');
  assert(nloc.removed === true && nloc.placeSkipped === true && asked.length === 1, '"Show nothing" leaves the stop out of the fly-over');
  asked = [];
  none = await tripsyFlyoverBuild(bare, none, { askPlace: answer({ lat: 1, lng: 1, label: 'x', query: 'x' }) });
  assert(asked.length === 0 && none.stops.find(s => s.id === 'location').removed === true, 'and a rebuild does not ask again or bring it back');
  // A stay the geocoder can't find is asked about too.
  asked = [];
  const lost = { key: 'T7', events: [stay(1, 'Mystery Inn', 'Nowhere Lane', '2030-01-01T15:00:00', '2030-01-03T11:00:00')] };
  const lr = await tripsyFlyoverBuild(lost, null, { askPlace: answer(null) });
  assert(asked.join(',') === 'hosting-1' && lr.stops[0].removed === true, 'a lodging the map can\'t find is asked about as well');
  const silent = await tripsyFlyoverBuild(lost, null);
  assert(silent.stops[0].lat === null && !silent.stops[0].removed, 'with no one to ask, an unplaced stop is kept and flagged, not dropped');
})();
const ask = extractFn('tripsyFlyoverAskPlace');
assert(/Couldn’t find “\$\{text\}”\. Try another name, or choose Show nothing\./.test(ask), 'no match: the dialog stays open, asks for another name, offers Show nothing');
assert(/data-place-none/.test(ask) && /done\(null\)/.test(ask), 'Show nothing resolves null');
assert(/askPlace: st => \{[^}]*tripsyFlyoverAskPlace\(trip, st\)/.test(extractFn('showTripsyFlyover')), 'the setup page\'s build asks through the dialog');
assert(/data-flyover-set-place/.test(extractFn('showTripsyFlyover')), 'an unplaced stop on the setup page has a Set location button');

// ---- each visited destination starts with the itinerary's photo for its first event ----
eval([(html.match(/const TRIPSY_FLYOVER_LAX_PHOTO_ID = [^\n]*/) || [''])[0].replace(/^const /, 'var '),
  (html.match(/const TRIPSY_FLYOVER_LAX_LATLNG = [^\n]*/) || [''])[0].replace(/^const /, 'var '),
  extractFn('tripsyFlyoverStopIsLax'), extractFn('tripsyFlyoverItineraryPhotoFor'), extractFn('tripsyFlyoverSeedItineraryPhotos')].join('\n'));
{
  const t = { key: 'T8', events: [
    stay(1, 'Hotel One', '1 A St, Alpha, Land', '2030-05-01T15:00:00', '2030-05-04T11:00:00'),
    act(2, 'Museum', '2030-05-02T10:00:00'),
    stay(3, 'Hotel Two', '2 B St, Beta, Land', '2030-05-04T15:00:00', '2030-05-06T11:00:00'),
    act(4, 'Gallery', '2030-05-05T10:00:00'),
    stay(5, 'Hotel Three', '3 C St, Gamma, Land', '2030-05-06T15:00:00', '2030-05-08T11:00:00'),
  ] };
  // Keys as the itinerary writes them: the CARD title ("… check-in") and hint differ from the raw event.
  const cache = {
    'hotel one|1 a st, alpha, land|hotel one check-in|': { driveFileId: 'f-hotel1' },
    'museum||museum|alpha': { driveFileId: 'f-museum' },
    'hotel two|2 b st, beta, land|hotel two check-in|': { skipped: true },
    'gallery||gallery|beta': { driveFileId: 'f-gallery' },
  };
  const stops = [
    { id: 'origin', kind: 'origin', start: '2030-05-01T08:00:00', photos: [] },
    { id: 'h1', kind: 'stay', start: '2030-05-01T15:00:00', photos: [] },
    { id: 'h3', kind: 'stay', start: '2030-05-04T15:00:00', photos: [] },
    { id: 'h5', kind: 'stay', start: '2030-05-06T15:00:00', photos: [] },
  ];
  assert(tripsyFlyoverItineraryPhotoFor(t, stops[1], stops[2], cache) === 'f-hotel1',
    'THE ASK: the first itinerary event at the destination (the hotel check-in) supplies its photo, matched despite the card-title key');
  assert(tripsyFlyoverItineraryPhotoFor(t, stops[2], stops[3], cache) === 'f-gallery',
    'a skipped hotel photo falls through to the next event in the window, never one from another destination');
  assert(tripsyFlyoverItineraryPhotoFor(t, stops[3], null, cache) === null, 'nothing in the itinerary yet -> no photo');
  let r = tripsyFlyoverSeedItineraryPhotos({ stops }, t, '2030-05-05', cache);
  assert(r.changed && r.record.stops[1].photos[0].driveFileId === 'f-hotel1' && r.record.stops[1].photos[0].source === 'itinerary' && r.record.stops[1].autoPhotoSeeded,
    'a visited stay starts with that one photo, marked as offered');
  assert(r.record.stops[2].photos.length === 1 && r.record.stops[3].photos.length === 0 && !r.record.stops[3].autoPhotoSeeded,
    'an unvisited stay gets nothing yet');
  assert(r.record.stops[0].photos.length === 0, 'the departure airport is not a destination and gets no photo');
  // The owner deletes it: it never comes back.
  const deleted = { stops: r.record.stops.map(s => s.id === 'h1' ? { ...s, photos: [] } : s) };
  const again = tripsyFlyoverSeedItineraryPhotos(deleted, t, '2030-05-09', cache);
  assert(again.record.stops[1].photos.length === 0, 'a deleted itinerary photo is never re-added');
  assert(!again.changed, 'and nothing else changes once every reachable stay has been offered its photo');
  const noDup = tripsyFlyoverSeedItineraryPhotos({ stops: [stops[0], { ...stops[1], photos: [{ driveFileId: 'f-hotel1' }] }, stops[2]] }, t, '2030-05-09', cache);
  assert(noDup.record.stops[1].photos.length === 1 && noDup.record.stops[1].autoPhotoSeeded, 'a photo already there is not added twice');
}
// ---- an LAX departure / home airport starts with the app's own LAX picture ----
{
  const t = { key: 'T9', events: [] };
  const stops = [
    { id: 'origin', kind: 'origin', label: 'Los Angeles', query: 'LAX airport', start: '2030-05-01T08:00:00', photos: [] },
    { id: 'h1', kind: 'stay', label: 'Alpha', start: '2030-05-01T15:00:00', photos: [] },
    { id: 'return', kind: 'return', label: 'Los Angeles', lat: 33.94, lng: -118.41, start: '2030-05-08T18:00:00', photos: [] },
  ];
  assert(tripsyFlyoverStopIsLax(stops[0]) && tripsyFlyoverStopIsLax(stops[2]), 'LAX is recognised by its code or by where it was geocoded');
  assert(!tripsyFlyoverStopIsLax({ kind: 'return', label: 'San Francisco', query: 'SFO airport', lat: 37.62, lng: -122.38 })
    && !tripsyFlyoverStopIsLax({ kind: 'stay', label: 'Los Angeles', query: 'LAX airport' }), 'another airport, or a hotel stay, is not');
  const mid = tripsyFlyoverSeedItineraryPhotos({ stops }, t, '2030-05-03', {});
  assert(mid.record.stops[0].photos[0].driveFileId === TRIPSY_FLYOVER_LAX_PHOTO_ID && mid.record.stops[0].autoPhotoSeeded,
    'THE ASK: leaving from LAX starts with the default LAX picture');
  assert(mid.record.stops[2].photos.length === 0, 'the trip home is not visited yet, so it waits');
  const home = tripsyFlyoverSeedItineraryPhotos(mid.record, t, '2030-05-09', {});
  assert(home.record.stops[2].photos[0].driveFileId === TRIPSY_FLYOVER_LAX_PHOTO_ID, 'THE ASK: arriving home at LAX gets it too');
  const del = { stops: home.record.stops.map(s => s.id === 'origin' ? { ...s, photos: [] } : s) };
  assert(tripsyFlyoverSeedItineraryPhotos(del, t, '2030-05-09', {}).record.stops[0].photos.length === 0, 'deleting it keeps it deleted');
  assert(/driveFileId === TRIPSY_FLYOVER_LAX_PHOTO_ID\) return Promise\.resolve\(`data:image\/jpeg;base64,\$\{PS_RESERVATION_PHOTO_B64\}`\)/.test(extractFn('tripsyPlacePhotoDisplayUrl')),
    'the built-in id resolves to the embedded LAX photo wherever fly-over photos are drawn');
}
assert(/autoPhotoSeeded: !!p\.autoPhotoSeeded/.test(extractFn('tripsyFlyoverCarryOver')), 'a rebuild carries the offered flag, so a deleted photo stays deleted');
assert(/tripsyFlyoverSeedItineraryPhotos\(record, trip, tripsyTodayDayKey\(\), driveData\.tripsyPlacePhotoCache\)/.test(extractFn('showTripsyFlyover')), 'the setup page seeds on open and after a build');

// ---- per-destination slideshow: layout, transition, timing (2026-10-20) ----
eval([constLine('TRIPSY_FLYOVER_PHOTO_MS'), constLine('TRIPSY_FLYOVER_SECONDS_MIN'), constLine('TRIPSY_FLYOVER_SECONDS_MAX'),
  (html.match(/const TRIPSY_FLYOVER_LAYOUTS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_PHOTO_REVEALS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_PHOTO_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0], extractFn('tripsyFlyoverPageRecord'),
  extractFn('tripsyFlyoverSlideshowConfig'), extractFn('tripsyFlyoverIsVideo'), extractFn('tripsyFlyoverPhotoGroups')].join('\n'));
{
  const def = tripsyFlyoverSlideshowConfig({});
  assert(def.layout === 'single' && def.transition === 'fade' && def.seconds === 3.2, 'defaults: one photo at a time, fading, 3.2 s each');
  const c = tripsyFlyoverSlideshowConfig({ slideshow: { layout: 'grid', transition: 'kenburns', seconds: 6 } });
  assert(c.layout === 'grid' && c.transition === 'kenburns' && c.seconds === 6, 'a stop\'s own choices are honored');
  assert(tripsyFlyoverSlideshowConfig({ slideshow: { layout: 'bogus', transition: 'warp', seconds: 99 } }).seconds === 15
    && tripsyFlyoverSlideshowConfig({ slideshow: { layout: 'bogus' } }).layout === 'single'
    && tripsyFlyoverSlideshowConfig({ slideshow: { seconds: 0.2 } }).seconds === 1, 'unknown values fall back and seconds clamp to 1-15');
  const ph = [1, 2, 3, 4, 5, 6, 7].map(n => ({ driveFileId: 'p' + n }));
  const sizes = l => tripsyFlyoverPhotoGroups(ph, l).map(g => g.length).join(',');
  assert(sizes('single') === '1,1,1,1,1,1,1' && sizes('pair') === '2,2,2,1' && sizes('grid') === '4,3' && sizes('collage') === '6,1',
    'THE ASK: several photos share the screen -- pairs, a grid of four, a collage of six');
  assert(tripsyFlyoverPhotoGroups([], 'grid').length === 0, 'no photos, no screens');
}
{
  const player = extractFn('playTripsyFlyover');
  assert(/const pages = tripsyFlyoverPages\(s\);[\s\S]*const enter = tripsyFlyoverEnterTransitions\(s, pages\);[\s\S]*showPage\(r, pages\[k\], enter\[k\]\)/.test(player), 'each destination plays its OWN pages');
  assert(/const ms = Math\.round\(page\.seconds \* 1000\);[\s\S]*return wait\(r, Math\.max\(0, ms - tMs, revealMs \+ 1000 - tMs\)\);/.test(player), 'each page holds for its own seconds (longer only if its photos are still arriving), pause-aware');
  assert(/g\.dataset\.layout = layout;\s*g\.dataset\.tr = enterTr;/.test(player), 'the page\'s layout and entering transition drive its CSS');
  assert(/ov\.classList\.toggle\('tfo-paused', run\.paused\)/.test(player) && /\.tfo-paused \* \{ animation-play-state: paused !important; \}/.test(html), 'pause also freezes the pan-and-zoom animation');
  assert(/if \(preview\) return all\.filter\(s => s\.id === opts\.previewStopId\);/.test(player), 'Preview plays just that destination');
  // "remove any zoom in or zoom out on the screen before showing the preview" (2026-10-22):
  // the map is SET on the destination (no flyTo, no arrive/burst) and the pictures start.
  const pv = (player.match(/if \(preview\) \{[\s\S]*?\n      return;\n    \}/) || [''])[0];
  assert(/map\.setView\(\[s\.lat, s\.lng\], s\.kind === 'stay' \? 10 : 9, \{ animate: false \}\);/.test(pv) && /ensureDot\(s\);\s*showDestLabel\(s\);\s*showCard\(s\.label, stopSub\(s, 0\)\);/.test(pv)
    && /if \(tripsyFlyoverPages\(s\)\.length\) \{[\s\S]*veilEl\.classList\.add\('tfo-show'\);[\s\S]*await slideshow\(r, s\)/.test(pv)
    && !/arrive\(/.test(pv) && !/flyTo/.test(pv) && !/startBurst/.test(pv),
    'a preview sets the map straight on the destination and plays its pictures with no zoom in, zoom out or burst');
  for (const k of ['slide', 'zoom', 'none']) assert(html.includes(`.tfo-group[data-tr="${k}"]`), `the ${k} transition has its CSS`);
  for (const k of ['pair', 'grid', 'collage']) assert(html.includes(`.tfo-group[data-layout="${k}"]`), `the ${k} layout has its CSS`);
  const setup = extractFn('showTripsyFlyover');
  assert(/data-flyover-slideshow/.test(setup) && /data-flyover-preview/.test(setup) && /tripsyFlyoverSlideshowSummary\(s\)/.test(setup),
    'each destination shows how its photos play, with Edit slideshow and Preview buttons');
  // "Change the name of the slideshow options button to edit slideshow, and put the button to
  // the left of the button showing the method of transport for that location" (2026-10-22).
  assert(/<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">\s*\$\{isOwner && !s\.removed && photos\.length && tripsyFlyoverStopVisited\(s, todayKey\) \? `<button class="btn" data-flyover-slideshow [^`]*>🎞 Edit slideshow<\/button>` : ''\}\s*\$\{legHtml\}/.test(setup)
    && !/Slideshow options<\/button>/.test(setup),
    'the card\'s "Edit slideshow" button sits directly left of the transport drop-down on the destination row');
  // "to the left of the last existing page show a button that is the same size as the images
  // of each page with a plus sign in it. If the user selects that, create a new page at the
  // end of the slideshow" (same day).
  const dlgAdd = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/const addChip = k === pages\.length - 1 \? `<button class="btn tfo-ss-chip tfo-ss-page" data-ss-add-page [^`]*><span class="tfo-ss-page-empty"[^`]*>＋<\/span><span>New page<\/span><\/button>` : '';\s*return `<button class="btn tfo-ss-chip tfo-ss-page[^`]*<\/button>\$\{addChip\}`;/.test(dlgAdd),
    'a ＋ chip in the page chips\' own size sits AFTER the last page chip ("always go after the last existing page," 2026-10-22)');
  assert(/const addPageAtEnd = \(\) => \{[\s\S]*pages = \[\.\.\.pages, pg\];\s*cur = pages\.length - 1;\s*render\(\);\s*\};/.test(dlgAdd)
    && /if \(cur < pages\.length - 1\) \{ cur\+\+; render\(\); return; \}\s*addPageAtEnd\(\);/.test(dlgAdd)
    && /if \(addChip\) addChip\.onclick = \(\) => \{ if \(Date\.now\(\) < dragState\.suppressTapUntil\) return; addPageAtEnd\(\); \};/.test(dlgAdd),
    'the ＋ chip and Next ▶ past the last page both add a page at the END and open it');
  assert(/updateStop\(id, \{ pages: r\.pages, photos: tripsyFlyoverPhotosInPageOrder/.test(setup), 'Save in the options box writes the pages onto that one stop');
}

// ---- map tiles: keyless, with a fallback (2026-10-20: "I get a message saying api key
// required when I try to play the trip" -- CARTO's free tiles now draw that onto every tile) ----
{
  assert(!/cartocdn/.test(html), 'CARTO tiles are gone entirely');
  const srcBlock = (html.match(/const TRIPSY_FLYOVER_TILE_SOURCES = \[[\s\S]*?\n\];/) || [''])[0];
  assert(/tile\.openstreetmap\.org/.test(srcBlock) && /arcgisonline\.com/.test(srcBlock) && !/key|token/i.test(srcBlock.replace(/rel="noopener"/g, '')),
    'Esri and OpenStreetMap, neither carrying a key');
  assert(srcBlock.indexOf('arcgisonline.com') < srcBlock.indexOf('tile.openstreetmap.org'),
    'THE ASK: Esri (English labels) is the map; OpenStreetMap (local-language labels) only the fallback');
  eval([srcBlock, constLine('TRIPSY_FLYOVER_TILE_FAIL_LIMIT'), extractFn('tripsyFlyoverAddTiles')].join('\n'));
  const added = [];
  const fakeL = { tileLayer: (url) => { const h = {}; const layer = { url, on: (ev, fn) => { h[ev] = fn; return layer; }, addTo: () => { added.push(layer); return layer; }, fire: ev => h[ev] && h[ev]() }; return layer; } };
  const removed = [];
  const fakeMap = { removeLayer: l => removed.push(l.url) };
  const first = tripsyFlyoverAddTiles(fakeL, fakeMap);
  for (let i = 0; i < 3; i++) first.fire('tileerror');
  assert(added.length === 1, 'a few failed tiles alone don\'t switch sources');
  first.fire('tileerror');
  assert(added.length === 2 && /openstreetmap/.test(added[1].url) && /arcgisonline/.test(removed[0]) && removed[0] === first.url, 'a run of failures before any tile loads switches to the fallback source');
  for (let i = 0; i < 10; i++) added[1].fire('tileerror');
  assert(added.length === 2, 'the last source is kept rather than leaving the map blank');
  added.length = 0;
  const ok = tripsyFlyoverAddTiles(fakeL, fakeMap);
  ok.fire('tileload');
  for (let i = 0; i < 10; i++) ok.fire('tileerror');
  assert(added.length === 1, 'once tiles have loaded, later stray errors never swap the map out');
  assert(/tripsyFlyoverAddTiles\(L, map, 0, tileSources\)/.test(extractFn('playTripsyFlyover')), 'the player adds its tiles through the fallback helper');
  // An explicit source list (Google first) falls back through the SAME list.
  added.length = 0;
  const g = tripsyFlyoverAddTiles(fakeL, fakeMap, 0, [{ url: 'G' }, { url: 'https://server.arcgisonline.com/x' }]);
  for (let i = 0; i < 4; i++) g.fire('tileerror');
  assert(added.length === 2 && added[0].url === 'G' && /arcgisonline/.test(added[1].url),
    'refused Google tiles fall back to Esri');
}

// ---- Google Map Tiles with the Places key ("Add Google Map Tiles with the Places key,"
// 2026-10-21: the keyless tiles have no @2x, so the map looked pixelated) ----
{
  const fn = extractFn('tripsyFlyoverGoogleTileSource');
  assert(/Store\.getPlacesApiKey\(\)/.test(fn) && /if \(!key\) return null/.test(fn), 'uses the owner\'s Places key from Drive, none means keyless tiles');
  assert(/createSession/.test(fn) && /highDpi: true/.test(fn) && /scaleFactor2x/.test(fn) && /language: 'en-US'/.test(fn),
    'a high-DPI, English roadmap session');
  assert(/if \(!res\.ok\)[^\n]*return null/.test(fn) && /catch \(e\)[\s\S]*return null/.test(fn), 'a refused or failed session falls back quietly');
  assert(!/AIza[0-9A-Za-z_-]{30}/.test(html), 'no Google key is written into the public file');
  eval([constLine('TRIPSY_FLYOVER_GOOGLE_TILES_API'), extractFn('tripsyFlyoverGoogleTileUrl')].join('\n'));
  assert(tripsyFlyoverGoogleTileUrl('s 1', 'k&2') === 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=s%201&key=k%262',
    'tile URL carries the session and key, encoded');
  const play = extractFn('playTripsyFlyover');
  assert(/googleTiles \? \[googleTiles, \.\.\.TRIPSY_FLYOVER_TILE_SOURCES\]/.test(play), 'Google first, keyless sources as the fallback');
  assert(/setTimeout\(\(\) => res\(null\), 2500\)/.test(play), 'a slow session never holds up the map for long');
  assert(play.indexOf('startMusic(true)') < play.indexOf('tripsyFlyoverGoogleTileSource()'),
    'the music still starts inside the tap, before the tile lookup');
  const attr = extractFn('tripsyFlyoverWireGoogleAttribution');
  assert(/tile\/v1\/viewport/.test(attr) && /moveend/.test(attr) && /if \(!isActive\(\)\)/.test(attr),
    'Google\'s copyright for the area in view is shown, and dropped after a fallback');
}

// ---- options when photos are added: "some may be one per page and others several in a
// page, and how to transition" (2026-10-20) ----
eval([constLine('TRIPSY_FLYOVER_PHOTO_MS'), constLine('TRIPSY_FLYOVER_SECONDS_MIN'), constLine('TRIPSY_FLYOVER_SECONDS_MAX'),
  (html.match(/const TRIPSY_FLYOVER_LAYOUTS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_PHOTO_REVEALS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_PHOTO_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0], extractFn('tripsyFlyoverPageRecord'),
  extractFn('tripsyFlyoverSlideshowConfig'), extractFn('tripsyFlyoverIsVideo'), extractFn('tripsyFlyoverPhotoGroups'),
  extractFn('tripsyFlyoverGroupLayout'), constLine('TRIPSY_FLYOVER_PAGE_MAX'), extractFn('tripsyFlyoverPageLayout'),
  extractFn('tripsyFlyoverNormalizePage'), extractFn('tripsyFlyoverPages'), extractFn('tripsyFlyoverEnterTransitions'),
  extractFn('tripsyFlyoverDialogPages'), extractFn('tripsyFlyoverTogglePagePhoto'), extractFn('tripsyFlyoverSlideshowSummary')].join('\n'));
{
  const P = (n, solo) => ({ driveFileId: 'p' + n, solo: !!solo });
  const ph = [P(1), P(2, true), P(3), P(4), P(5), P(6, true), P(7)];
  const ids = l => tripsyFlyoverPhotoGroups(ph, l).map(g => g.map(p => p.driveFileId.slice(1)).join('')).join('|');
  assert(ids('grid') === '1|2|345|6|7', 'THE ASK: an "Own page" photo gets a screen to itself; the others share screens in order -> ' + ids('grid'));
  assert(ids('pair') === '1|2|34|5|6|7', 'pairs break around an own-page photo too -> ' + ids('pair'));
  assert(ids('single') === '1|2|3|4|5|6|7', 'one at a time is unaffected');
  assert(tripsyFlyoverGroupLayout([P(1)], 'grid') === 'single' && tripsyFlyoverGroupLayout([P(1), P(2)], 'grid') === 'pair'
    && tripsyFlyoverGroupLayout([P(1), P(2), P(3)], 'grid') === 'grid' && tripsyFlyoverGroupLayout([P(1), P(2)], 'collage') === 'collage',
    'a lone photo fills the screen (never one cell of a grid), and two in a grid show as a pair');
  assert(tripsyFlyoverSlideshowSummary({ slideshow: { layout: 'grid' }, photos: ph }) === '5 pages: 1 · 1 · 3 · 1 · 1 photos per page',
    'the setup card says how the photos will play -> ' + tripsyFlyoverSlideshowSummary({ slideshow: { layout: 'grid' }, photos: ph }));
  // A stop saved before pages existed plays exactly as before.
  const legacy = tripsyFlyoverPages({ slideshow: { layout: 'grid', transition: 'slide', seconds: 4 }, photos: ph });
  assert(legacy.map(pg => pg.ids.join('')).join('|') === 'p1|p2|p3p4p5|p6|p7' && legacy.every(pg => pg.transition === 'slide' && pg.seconds === 4),
    'old per-destination settings become the same pages');
  // ---- how the photos on a page of several appear ("On a page with multiples photos, ask the
  // user how the photos should appear - all at the same time or sequentially, and if there
  // should be transitions for the photos - the same transition should apply to all on a page,"
  // 2026-10-22) ----
  assert(legacy.every(pg => pg.reveal === 'together' && pg.photoTransition === 'none'),
    'a page saved before the choice existed plays as it did: all at once, no per-photo transition');
  const nz = tripsyFlyoverNormalizePage({ ids: ['a', 'b'], count: 2, reveal: 'sequence', photoTransition: 'wipe' });
  assert(nz.reveal === 'sequence' && nz.photoTransition === 'wipe', 'THE ASK: a page keeps its reveal order and its one per-photo transition');
  const nz2 = tripsyFlyoverNormalizePage({ ids: ['a'], count: 1, reveal: 'random', photoTransition: 'dissolve' });
  assert(nz2.reveal === 'together' && nz2.photoTransition === 'none', 'an unknown choice falls back to the defaults');
  const keysOf = name => ((html.match(new RegExp(`const ${name} = \\[[\\s\\S]*?\\];`)) || [''])[0].match(/key: '([a-z]+)'/g) || []).map(m => m.slice(6, -1)).join();
  assert(keysOf('TRIPSY_FLYOVER_PHOTO_REVEALS') === 'together,sequence' && keysOf('TRIPSY_FLYOVER_PHOTO_TRANSITIONS') === 'none,fade,wipe,slide,zoom', 'the two choices offered');
  const rec = tripsyFlyoverPageRecord({ ids: ['a'], count: 1, style: 'grid', transition: 'fade', seconds: 3, reveal: 'sequence', photoTransition: 'zoom', photos: [{}], layout: 'single', auto: true });
  assert(JSON.stringify(Object.keys(rec)) === JSON.stringify(['ids', 'count', 'style', 'transition', 'seconds', 'reveal', 'photoTransition']),
    'a saved page record carries the two choices and none of the derived fields');
  const dlgR = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/\$\{!videoPage && page\.count >= 2 \? `[\s\S]*How should the \$\{page\.count\} photos appear\?[\s\S]*data-ss-reveal="\$\{r\.key\}"[\s\S]*How each photo comes in[\s\S]*The same transition applies to every photo on this page\.[\s\S]*data-ss-ptr="\$\{t\.key\}"/.test(dlgR),
    'a page of two or more asks both questions, saying the transition is the same for every photo; a one-photo or video page does not');
  assert(/\[data-ss-reveal\]'\)\.forEach\(b => b\.onclick = \(\) => \{ pages = pages\.map\(\(pg, k\) => k === cur \? \{ \.\.\.pg, reveal: b\.getAttribute\('data-ss-reveal'\) \}/.test(dlgR)
    && /\[data-ss-ptr\]'\)\.forEach\(b => b\.onclick = \(\) => \{ pages = pages\.map\(\(pg, k\) => k === cur \? \{ \.\.\.pg, photoTransition: b\.getAttribute\('data-ss-ptr'\) \}/.test(dlgR),
    'each pick is stored on the page being edited');
  const playerR = extractFn('playTripsyFlyover');
  assert(/const sequence = urls\.length > 1 && page\.reveal === 'sequence';/.test(playerR) && /img\.style\.setProperty\('--ph-delay', `\$\{i \* stagger\}ms`\)/.test(playerR)
    && /img\.classList\.add\('tfo-ph'\)/.test(playerR) && /Math\.max\(0, ms - tMs, revealMs \+ 1000 - tMs\)/.test(playerR),
    'the player staggers the photos of a sequence page, gives each the page\'s one transition, and holds the page until the last has arrived');
  assert(/\.tfo-group\.tfo-in \.tfo-ph \{ animation: var\(--ph-name, tfo-ph-cut\)/.test(html) && /\[data-tr="kenburns"\]\.tfo-in \.tfo-ph \{ animation: [^}]*tfo-kenburns/.test(html)
    && ['cut', 'fade', 'wipe', 'slide', 'zoom'].every(k => new RegExp(`@keyframes tfo-ph-${k} `).test(html)),
    'per-photo entrances are animations (so pause freezes them), with keyframes for every choice and the pan-and-zoom page keeping its own');
  // ---- pages, each configured on its own ----
  const Q = [1, 2, 3, 4, 5, 6].map(n => ({ driveFileId: 'q' + n }));
  const stop = { photos: Q, pages: [
    { ids: ['q2', 'q1'], count: 2, transition: 'zoom', seconds: 5 },
    { ids: ['q3', 'q4', 'q5'], count: 3, style: 'collage', transition: 'none', seconds: 2 },
    { ids: ['q1', 'gone'], count: 1 },
  ] };
  const pg = tripsyFlyoverPages(stop);
  assert(pg.map(x => x.ids.join(',')).join('|') === 'q2,q1|q3,q4,q5|q6',
    'THE ASK: each page plays the photos chosen for it, in order; a photo is on one page only; a removed photo drops off; one on no page plays after -> ' + pg.map(x => x.ids.join(',')).join('|'));
  assert(pg[0].layout === 'pair' && pg[1].layout === 'collage' && pg[2].layout === 'single' && pg[2].auto,
    'how many are on a page decides how it is drawn');
  assert(pg[0].seconds === 5 && pg[1].seconds === 2, 'each page has its own time on screen');
  assert(tripsyFlyoverEnterTransitions(stop, pg).join(',') === 'fade,zoom,none',
    'THE ASK: "the transition to the next page" is the way the NEXT page comes in');
  assert(tripsyFlyoverPageLayout(3, 'grid') === 'grid' && tripsyFlyoverPageLayout(5, 'grid') === 'collage' && tripsyFlyoverPageLayout(1, 'collage') === 'single',
    'three or four can be a grid or a collage; five or six are a collage');
  let t = tripsyFlyoverTogglePagePhoto([{ ids: ['q1'], count: 2 }, { ids: ['q2'], count: 1 }], 0, 'q2');
  assert(t.pages[0].ids.join() === 'q1,q2' && t.pages[1].ids.length === 0, 'tapping a photo from another page moves it here');
  t = tripsyFlyoverTogglePagePhoto(t.pages, 0, 'q3');
  assert(t.full, 'a page never holds more than the number chosen for it');
  t = tripsyFlyoverTogglePagePhoto([{ ids: ['q1', 'q2'], count: 2 }], 0, 'q1');
  assert(t.pages[0].ids.join() === 'q2', 'tapping a photo on this page takes it off');
  assert(tripsyFlyoverDialogPages(stop).map(x => x.ids.join()).join('|') === 'q2,q1|q3,q4,q5',
    'the dialog edits only the saved pages; a newly added photo waits for a page of its own');
  const player = extractFn('playTripsyFlyover');
  assert(/const prev = shownEl;\s*shownEl = g;[\s\S]*if \(prev\) prev\.remove\(\);/.test(player),
    'THE ASK: the next page goes over the one showing, which only then is removed -- no map between pictures');
  assert(/veilEl\.classList\.add\('tfo-show'\)/.test(player) && /const endSlideshow = async r => \{\s*clearBurst\(\);\s*veilEl\.classList\.remove\('tfo-show'\)/.test(player)
    && /\.tfo-group \{[^}]*background: #0b1020/.test(html), 'a dark backdrop stays up for the whole slideshow and every page is opaque');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/How many pictures on page/.test(dlg) && /data-ss-count/.test(dlg) && /data-ss-photo/.test(dlg) && /Transition to page \$\{cur \+ 2\}/.test(dlg)
    && /data-ss-seconds/.test(dlg) && /data-ss-next/.test(dlg) && /data-ss-prev/.test(dlg) && /data-ss-preview/.test(dlg),
    'THE ASK: page by page -- how many pictures, which ones, the transition to the next page and the time on screen');
  assert(/done\(\{ pages: cleaned\(\), photos \}\)/.test(dlg) && /data-ss-cancel[\s\S]*done\(null\)/.test(dlg), 'Save returns the pages, Cancel changes nothing');
  assert(/slideshow: \{ \.\.\.p\.slideshow \}/.test(extractFn('tripsyFlyoverCarryOver')) && /pages: p\.pages\.map/.test(extractFn('tripsyFlyoverCarryOver')),
    'rebuilding the destinations keeps each one\'s pages and settings');
  const setup = extractFn('showTripsyFlyover');
  assert(/const r = await addMediaToStop\(id, files, setStatus\);\s*if \(r\.done \|\| r\.queued\) \{\s*const total = r\.done \+ r\.queued;\s*if \(!closed\) openSlideshowOptions\(id, `\$\{total\} item/.test(setup), 'THE ASK: adding your own photos opens the options box straight away');
  assert(/added => \{\s*if \(added && !closed\) openSlideshowOptions\(id,/.test(setup), 'and so does closing the suggested photos after picking some');
  assert(/close = \(\) => \{[^}]*if \(onClosed\) onClosed\(added\);/.test(extractFn('tripsyFlyoverSuggestedPhotos')), 'the suggestions grid reports how many it added');
}

// ---- music by genre ----
eval([(html.match(/const TRIPSY_FLYOVER_MUSIC_GENRES = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '),
  (html.match(/const TRIPSY_FLYOVER_MUSIC_SPOKEN_WORDS = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '),
  (html.match(/const TRIPSY_FLYOVER_MUSIC_SPOKEN_PHRASES = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '),
  constLine('TRIPSY_FLYOVER_MUSIC_PREVIEW_SECONDS').replace(/^const /, 'var '), extractFn('tripsyFlyoverMusicPreviewStart'),
  extractFn('tripsyFlyoverMusicLooksSpoken'),
  extractFn('tripsyFlyoverMusicSearchUrl'), extractFn('tripsyFlyoverParseLength'), extractFn('tripsyFlyoverPickArchiveTrack'),
  extractFn('tripsyFlyoverLicenseLabel'), extractFn('tripsyFlyoverMusicLabel')].join('\n'));
{
  assert(TRIPSY_FLYOVER_MUSIC_GENRES.length >= 6 && new Set(TRIPSY_FLYOVER_MUSIC_GENRES.map(g => g.key)).size === TRIPSY_FLYOVER_MUSIC_GENRES.length,
    'THE ASK: music is offered across several genres');
  const regions = TRIPSY_FLYOVER_MUSIC_GENRES.filter(g => g.group === 'region').map(g => g.key);
  assert(['westafrican', 'northafrican', 'arabic', 'persianturkish', 'indian', 'chinese', 'japanese', 'korean', 'southeastasian',
    'brazilian', 'andean', 'mexican', 'cuban', 'tango', 'caribbean', 'spanish', 'greek', 'balkan', 'nordic', 'celtic'].every(k => regions.includes(k))
    && regions.length >= 25,
    'THE ASK: many regional options -- ' + regions.length + ': ' + regions.join(','));
  // ---- spoken word (language lessons) is never offered ----
  const sq = new URL(tripsyFlyoverMusicSearchUrl('arabic')).searchParams.get('q');
  assert(/AND NOT subject:\([^)]*\blesson\b[^)]*\blanguage\b/.test(sq) && /AND NOT title:\([^)]*\blearn\b/.test(sq),
    'THE ASK: the search itself rules out lessons and language courses');
  assert(tripsyFlyoverMusicLooksSpoken(['Learn Arabic: Lesson 1']) && tripsyFlyoverMusicLooksSpoken([['japanese', 'language']])
    && tripsyFlyoverMusicLooksSpoken('Japanese Pronunciation for Beginners'), 'a language lesson is recognised by title or subject');
  assert(!tripsyFlyoverMusicLooksSpoken(['Talking Drums of Ghana', ['afrobeat', 'west african']]) && !tripsyFlyoverMusicLooksSpoken(['Oud Improvisations']),
    'music is not mistaken for it (whole words only: "Talking" is not "talk")');
  assert(!tripsyFlyoverMusicLooksSpoken('Of course this album speaks a musical language all its own.', TRIPSY_FLYOVER_MUSIC_SPOKEN_PHRASES)
    && tripsyFlyoverMusicLooksSpoken('A language course for travellers.', TRIPSY_FLYOVER_MUSIC_SPOKEN_PHRASES),
    'a description is judged on phrases only, so ordinary prose never drops a song');
  const search = extractFn('tripsyFlyoverSearchMusic');
  assert(/\.filter\(doc => !tripsyFlyoverMusicLooksSpoken\(\[doc\.title, doc\.subject\]\)\)/.test(search)
    && /tripsyFlyoverMusicLooksSpoken\(md\.description, TRIPSY_FLYOVER_MUSIC_SPOKEN_PHRASES\)/.test(search)
    && /!tripsyFlyoverMusicLooksSpoken\(t\.title\)/.test(search), 'results are checked again, item and track, before they are offered');
  // ---- Preview ----
  assert(tripsyFlyoverMusicPreviewStart(240) === 45 && tripsyFlyoverMusicPreviewStart(100) === 25 && tripsyFlyoverMusicPreviewStart(35) === 0
    && tripsyFlyoverMusicPreviewStart(NaN) === 0 && tripsyFlyoverMusicPreviewStart(60) + 30 <= 60,
    'a preview starts a little way into the song and never runs past its end');
  assert(TRIPSY_FLYOVER_MUSIC_GENRES.every(g => g.group === 'style' || g.group === 'region'), 'every genre is a style or a region');
  for (const k of regions) {
    const q = new URL(tripsyFlyoverMusicSearchUrl(k)).searchParams.get('q');
    const g = TRIPSY_FLYOVER_MUSIC_GENRES.find(x => x.key === k);
    assert(q.includes(`subject:(${g.terms})`), 'each region searches its own subject words: ' + k);
  }
  const muPicker = extractFn('tripsyFlyoverMusicPicker');
  assert(/data-mu-play="\$\{i\}"[^>]*>\$\{playingUrl === t\.url \? '■ Stop' : '▶ Preview'\}/.test(muPicker) && /data-mu-preview-current/.test(muPicker),
    'THE ASK: every track, and the song already chosen, has a Preview button');
  assert(/left = Math\.ceil\(TRIPSY_FLYOVER_MUSIC_PREVIEW_SECONDS - elapsed\)/.test(muPicker) && /if \(left <= 0\) \{ stopAudio\(\);/.test(muPicker)
    && /Previewing — \$\{left\} s left/.test(muPicker), 'a preview counts down and stops by itself');
  assert(/if \(!audio\.paused && audio\.readyState >= 3\) elapsed \+=/.test(muPicker) && !/previewFrom/.test(muPicker),
    'the countdown counts time actually played, so a song that cannot be seeked still stops after the clip');
  assert(/TRIPSY_FLYOVER_MUSIC_GROUPS\.map/.test(muPicker) && /g\.group === gr\.key/.test(muPicker) && /data-mu-group/.test(muPicker),
    'the picker shows Styles and Regions as two rows');
  assert(/key: 'style'[^}]*Styles[\s\S]*key: 'region'[^}]*Regions/.test(html), 'the two rows are labelled Styles and Regions');
  const u = new URL(tripsyFlyoverMusicSearchUrl('jazz'));
  assert(u.host === 'archive.org' && /subject:\(jazz/.test(u.searchParams.get('q')) && /licenseurl:\*creativecommons\*/.test(u.searchParams.get('q'))
    && u.searchParams.getAll('fl[]').includes('identifier') && u.searchParams.get('output') === 'json',
    'the search asks the Internet Archive for Creative Commons audio in that genre, as JSON');
  assert(tripsyFlyoverParseLength('2:03') === 123 && tripsyFlyoverParseLength('95.5') === 95.5 && tripsyFlyoverParseLength('') === null, 'track lengths read both shapes');
  const meta = { metadata: { identifier: 'some-album', title: 'Album', creator: 'Band', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
    files: [
      { name: 'cover.jpg', format: 'JPEG' },
      { name: '01 intro.mp3', format: 'VBR MP3', length: '0:20', title: 'Intro' },
      { name: '02 main theme.mp3', format: 'VBR MP3', length: '3:45', title: 'Main Theme' },
      { name: 'mix.mp3', format: 'VBR MP3', length: '7200' },
    ] };
  const t = tripsyFlyoverPickArchiveTrack(meta, { identifier: 'some-album' });
  assert(t && t.title === 'Main Theme' && t.seconds === 225, 'a song of one to ten minutes is picked over a jingle or a two-hour mix -> ' + (t && t.title));
  assert(t.url === 'https://archive.org/download/some-album/02%20main%20theme.mp3' && t.artist === 'Band' && t.page === 'https://archive.org/details/some-album',
    'with a streamable URL, the artist, and a link to its source page');
  assert(tripsyFlyoverLicenseLabel(t.license) === 'CC BY' && tripsyFlyoverMusicLabel(t) === 'Main Theme — Band', 'its license and label read cleanly');
  assert(tripsyFlyoverPickArchiveTrack({ metadata: { identifier: 'x' }, files: [{ name: 'a.flac', format: 'Flac' }] }, null) === null, 'an item with no MP3 is skipped');
  const picker = extractFn('tripsyFlyoverMusicPicker');
  assert(/data-mu-genre/.test(picker) && /data-mu-play/.test(picker) && /data-mu-use/.test(picker) && /data-mu-own/.test(picker),
    'the picker offers genres, a listen button and Use per track, and your own song');
  assert(/f\.size > TRIPSY_FLYOVER_MUSIC_MAX_BYTES/.test(picker), 'an oversized song file is refused before upload');
  const player = extractFn('playTripsyFlyover');
  const firstAwait = player.indexOf('await ');
  assert(player.indexOf('const audio = music ? new Audio() : null;') > 0 && player.indexOf('const audio = music ? new Audio() : null;') < firstAwait
    && player.indexOf('startMusic(true);') > 0 && player.indexOf('startMusic(true);') < firstAwait, 'music starts before the first await, inside the Play tap (iOS only allows that)');
  assert(/data-tfo-music/.test(player) && /musicMuted = true; audio\.pause\(\)/.test(player), 'a music button mutes, and plays when the browser blocked autoplay');
  assert(/if \(run\.paused\) audio\.pause\(\); else startMusic\(\);/.test(player) && /run\.cancelled = true;\s*stopMusic\(\);/.test(player), 'pause pauses the music; closing stops it');
  assert(/if \(prevRecord && prevRecord\.music\) rec\.music = prevRecord\.music;/.test(extractFn('tripsyFlyoverBuild')), 'a rebuild keeps the chosen music');
  assert(/data-flyover-music/.test(extractFn('showTripsyFlyover')), 'the setup page shows the music with Choose/Change');
}

// ---- destination names in English ("Use the names of all destinations in the flyover in
// English," 2026-10-20) ----
{
  const geo = extractFn('tripsyFlyoverGeocode');
  assert(/textQuery: query, maxResultCount: 1, languageCode: 'en'/.test(geo), 'THE ASK: Places is asked for English names');
  assert(/return \{ lat: g\.lat, lng: g\.lon, city: g\.name \|\| '' \}/.test(geo), 'the fallback geocoder\'s English name is used, not thrown away');
  assert(/await tripsyFlyoverEnglishCityName\(lv\.name, country, lat, lng, apiKey, lv\)/.test(geo) && /!tripsyFlyoverNameIsNonLatin\(n\)/.test(geo),
    'an address\'s local city spelling is swapped for the English one, and a non-English answer is never taken');
  (async () => {
    const reqs = [];
    const f = new Function('reqs', `
      const tripsyFlyoverEnglishCityCache = new Map();
      ${extractFn('tripsyFlyoverDistanceKm')}
      async function fetch(u, o) { const b = JSON.parse(o.body); reqs.push(b);
        const at = { 'München, Germany': ['Munich', 48.14, 11.58], 'Paris, United States': ['Paris', 33.66, -95.56] }[b.textQuery];
        return { ok: true, json: async () => ({ places: at ? [{ displayName: { text: at[0] }, location: { latitude: at[1], longitude: at[2] } }] : [] }) }; }
      ${extractFn('tripsyFlyoverEnglishCityName')}
      return tripsyFlyoverEnglishCityName;`)(reqs);
    assert(await f('München', 'Germany', 48.14, 11.57, 'k') === 'Munich', 'THE ASK: München becomes Munich');
    assert(reqs[0].languageCode === 'en' && reqs[0].includedType === 'locality', 'by looking the city itself up in English');
    assert(await f('Paris', 'United States', 48.85, 2.35, 'k') === 'Paris' && await f('Zzz', '', 0, 0, 'k') === 'Zzz',
      'a far-away namesake, or no answer, keeps the address\'s own name');
    await f('München', 'Germany', 48.14, 11.57, 'k');
    assert(reqs.length === 3, 'each city is looked up once per session');
  })().catch(e => { console.log('FAIL english city', e); process.exitCode = 1; });
  assert(/for \(const s of stops\) s\.labelLang = 'en';/.test(extractFn('tripsyFlyoverBuild')), 'a build stamps its names as English');
  const en = extractFn('tripsyFlyoverEnglishLabels');
  (async () => {
    const calls = [];
    const f = new Function('calls', `
      ${extractFn('tripsyFlyoverNameIsNonLatin')}
      async function tripsyFlyoverGeocode(q) { calls.push(q); if (q === 'fail') return null; return { lat: 1, lng: 2, city: { '福岡市 hotel': 'Fukuoka', 'MUC airport': 'Munich' }[q] || '' }; }
      ${en}
      return tripsyFlyoverEnglishLabels;`)(calls);
    const rec = { stops: [
      { id: 'a', kind: 'stay', label: '福岡市', query: '福岡市 hotel' },
      { id: 'b', kind: 'origin', label: 'München', query: 'MUC airport' },
      { id: 'c', kind: 'stay', label: 'My Camp', labelEdited: true, query: 'x' },
      { id: 'd', kind: 'stay', label: 'Black Rock City', manualPlace: 'Black Rock City', query: 'y' },
      { id: 'e', kind: 'stay', label: 'Paris', labelLang: 'en', query: 'Paris' },
      { id: 'f', kind: 'stay', label: 'Somewhere', query: 'fail' },
    ] };
    const r = await f(rec);
    const L = id => r.record.stops.find(s => s.id === id);
    assert(r.changed && L('a').label === 'Fukuoka' && L('a').labelLang === 'en' && L('b').label === 'Munich',
      'THE ASK: a saved fly-over\'s destinations are re-named in English');
    assert(L('c').label === 'My Camp' && L('d').label === 'Black Rock City' && L('c').labelLang === 'en',
      'a name the owner typed or chose is kept');
    assert(!calls.includes('Paris') && !calls.includes('x') && !calls.includes('y'), 'stops already in English, or named by the owner, are not looked up');
    assert(L('f').label === 'Somewhere' && !L('f').labelLang, 'a failed lookup is retried next time');
  })().catch(e => { console.log('FAIL english labels', e); process.exitCode = 1; });
  assert(/tripsyFlyoverEnglishLabels\(record\)\.then/.test(extractFn('showTripsyFlyover')), 'the setup page re-names an older fly-over behind the page');
  assert(/playTripsyFlyover\(trip, record, layovers \? \{ layovers \} : \{\}\);[\s\S]{0,700}\/\/ Older fly-overs pick up English names/.test(html), 'and View does it after starting playback, so music still starts in the tap');
}

// ---- the page dialog's Save is always reachable ("When I edit pages on a flyover, there is
// no way to save the changes," 2026-10-21 — Save sat below the fold on a phone/iPad) ----
{
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/<div class="tfo-ss-footer">[\s\S]*data-ss-cancel[\s\S]*data-ss-save/.test(dlg), 'THE ASK: Save and Cancel sit in the pinned footer');
  assert(/\.tfo-ss-footer \{ position: sticky; bottom: 0;/.test(html) && /background: var\(--panel\)/.test((html.match(/\.tfo-ss-footer \{[^}]*\}/) || [''])[0]),
    'the footer is pinned to the bottom of the box and opaque, so it stays on screen while the photos scroll under it');
  assert(/class="tripsy-close-x tripsy-save-check" data-ss-save data-ss-save-top[^>]*>✓<\/button>\s*<button class="tripsy-close-x" data-ss-cancel/.test(dlg),
    'THE ASK (2026-10-21): a green ✓ Save box, styled like the ✕, sits next to it at the top');
  assert(/\.tripsy-close-x\.tripsy-save-check \{ border-color: #3AA76D; color: #3AA76D; \}/.test(html), 'the ✓ box is the ✕ box in green');
  assert(/querySelectorAll\('\[data-ss-save\]'\)\.forEach/.test(dlg), 'both Save buttons save');
  assert(/max-height:88vh; max-height:88dvh;/.test(dlg), 'the box fits the visible screen (dvh), not the full one under Safari\'s toolbars');
}

// ---- videos + fades + Shared Albums ("add the ability to add videos to the flyover. When
// videos play, cut the music and play sound from the video. Music should fade in and out.
// Also … add photos from shared albums," 2026-10-21) ----
eval([constLine('TRIPSY_FLYOVER_PHOTO_MS'), constLine('TRIPSY_FLYOVER_SECONDS_MIN'), constLine('TRIPSY_FLYOVER_SECONDS_MAX'),
  (html.match(/const TRIPSY_FLYOVER_LAYOUTS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_PHOTO_REVEALS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_PHOTO_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0], extractFn('tripsyFlyoverPageRecord'),
  extractFn('tripsyFlyoverSlideshowConfig'), extractFn('tripsyFlyoverIsVideo'), extractFn('tripsyFlyoverFileIsVideo'),
  extractFn('tripsyFlyoverDurationLabel'), extractFn('tripsyFlyoverPhotoGroups'),
  extractFn('tripsyFlyoverGroupLayout'), constLine('TRIPSY_FLYOVER_PAGE_MAX'), extractFn('tripsyFlyoverPageLayout'),
  extractFn('tripsyFlyoverNormalizePage'), extractFn('tripsyFlyoverPages'), extractFn('tripsyFlyoverTogglePagePhoto'),
  extractFn('tripsyFlyoverSlideshowSummary'), extractFn('tripsyFlyoverMusicFader')].join('\n').replace(/^const /gm, 'var '));
{
  const ph = id => ({ driveFileId: id });
  const vid = id => ({ driveFileId: id, kind: 'video', duration: 65 });
  assert(tripsyFlyoverIsVideo(vid('v')) && tripsyFlyoverIsVideo({ mime: 'video/quicktime' }) && !tripsyFlyoverIsVideo(ph('p')), 'a video record is told from a photo');
  assert(tripsyFlyoverFileIsVideo({ type: 'video/quicktime', name: 'IMG_1.MOV' }) && tripsyFlyoverFileIsVideo({ type: '', name: 'clip.mp4' })
    && !tripsyFlyoverFileIsVideo({ type: 'image/heic', name: 'IMG_2.HEIC' }), 'a picked file is a video by its type or extension');
  assert(tripsyFlyoverDurationLabel(65) === '1:05' && tripsyFlyoverDurationLabel(null) === '', 'video length reads m:ss');
  // auto pages: a video is always its own page, the photos around it keep their order
  const auto = tripsyFlyoverPages({ slideshow: { layout: 'grid' }, photos: [ph('a'), ph('b'), vid('v'), ph('c')] });
  assert(auto.map(pg => pg.ids.join('')).join('|') === 'ab|v|c' && auto[1].video && auto[1].layout === 'video',
    'THE ASK: a video plays on a page of its own, between the photos around it');
  // a saved page holding a video with photos is split, in place
  const saved = tripsyFlyoverPages({ photos: [ph('a'), vid('v'), ph('b')], pages: [{ ids: ['a', 'v', 'b'], count: 3 }] });
  assert(saved.map(pg => pg.ids.join('')).join('|') === 'a|v|b' && saved[1].layout === 'video', 'a video saved onto a photo page is split onto its own');
  assert(/🎬/.test(tripsyFlyoverSlideshowSummary({ photos: [ph('a'), vid('v')] })), 'the card summary marks the video page');
  // the dialog's toggle
  const isV = id => id === 'v';
  let r = tripsyFlyoverTogglePagePhoto([{ ids: ['a'], count: 2 }], 0, 'v', isV);
  assert(r.ownPage && r.pages[0].ids.join('') === 'a', 'a video cannot join a page of photos');
  r = tripsyFlyoverTogglePagePhoto([{ ids: ['a'], count: 2 }, { ids: [], count: 3 }], 1, 'v', isV);
  assert(!r.ownPage && r.pages[1].ids.join('') === 'v' && r.pages[1].count === 1, 'a video fills an empty page');
  r = tripsyFlyoverTogglePagePhoto([{ ids: ['v'], count: 1 }], 0, 'a', isV);
  assert(r.ownPage, 'and no photo joins a video page');
  assert(tripsyFlyoverTogglePagePhoto([{ ids: ['a'], count: 2 }], 0, 'b').pages[0].ids.join('') === 'ab', 'photos toggle as before without the video test');

  // the fader
  const fakeAudio = settable => { const a = { _v: 1, src: 'https://x/song.mp3', muted: false, paused: false };
    Object.defineProperty(a, 'volume', { get() { return a._v; }, set(v) { if (settable) a._v = v; } }); return a; };
  const fd = tripsyFlyoverMusicFader(fakeAudio(true), { AudioCtx: null });
  assert(fd.mode === 'volume' && fd.canFade, 'a settable volume fades by volume');
  const iosArchive = tripsyFlyoverMusicFader(fakeAudio(false), {});
  assert(iosArchive.mode === 'pause' && !iosArchive.canFade, 'iOS with a streamed song cannot fade, so ducking pauses');
  iosArchive.begin();
  assert(true, 'begin with a streamed song does not try Web Audio (it would play silence)');
  (async () => {
    const a = fakeAudio(true);
    const f = tripsyFlyoverMusicFader(a, { AudioCtx: null, base: 0.7 });
    f.begin(200);
    assert(a._v === 0, 'THE ASK: music starts silent and fades IN');
    await new Promise(res => setTimeout(res, 320));
    assert(Math.abs(a._v - 0.7) < 0.01, 'fade-in reaches the music level');
    await f.to(0, 150);
    assert(a._v === 0, 'and fades OUT to nothing');
    // iOS + a downloaded copy: never routed through Web Audio (it left the iPad silent) --
    // the song just plays, unmuted.
    const b = fakeAudio(false); b.src = 'blob:abc';
    let made = 0;
    const g = tripsyFlyoverMusicFader(b, { AudioCtx: function () { made++; } });
    g.begin(100);
    assert(g.mode === 'pause' && !b.muted && made === 0, 'iOS: a downloaded song plays as is, no audio context, never muted');
  })().catch(e => { console.log('FAIL fader', e); process.exitCode = 1; });

  const player = extractFn('playTripsyFlyover');
  assert(/const duckMusic = async \(\) => \{[\s\S]*fader\.to\(0, 700\)[\s\S]*else audio\.pause\(\)/.test(player), 'THE ASK: the music fades out (or stops) before a video');
  assert(/const duck = underMusic \? Promise\.resolve\(\) : duckMusic\(\);[\s\S]*await duck;[\s\S]*else try \{ await v\.play\(\); \}/.test(player), 'the video starts with its sound once the music is down');
  assert(/v\.muted = false;/.test(player) && /Tap for sound/.test(player), 'the video plays unmuted, with a tap-for-sound fallback');
  assert(/if \(!ok\) return false;\s*unduckMusic\(\);/.test(player) && /fader\.to\(1, 1500\)/.test(player), 'the music fades back in after the video');
  assert(/startMusic\(true\)/.test(player) && /fader\.to\(0, 2500\)/.test(player), 'music fades in at the start and out at the end');
  assert(/if \(curVideo\) \{ try \{ if \(run\.paused\) curVideo\.pause\(\)/.test(player), 'pause reaches the playing video');
  const pick = extractFn('tripsyFlyoverPickMedia');
  assert(/input\.accept = 'image\/\*,video\/\*'/.test(pick) && /input\.multiple = true/.test(pick) && !/capture/.test(pick.replace(/\/\/.*$/gm, '')),
    'THE ASK: one input for photos and videos, with no capture, so iOS shows its own Photos Library / camera sheet');
  assert(/input\.click\(\);\s*\}$/.test(pick.trim()) && !/tw-modal|innerHTML/.test(pick),
    'THE ASK (2026-10-21, "this is inefficient"): no in-app menu in front of the system picker — the tap opens it directly');
  assert(/tripsyFlyoverPickMedia\(async files =>/.test(extractFn('showTripsyFlyover')) && /tripsyFlyoverUploadVideo\(file/.test(extractFn('showTripsyFlyover')),
    'the setup page uses the media picker and uploads videos');
  const up = extractFn('uploadBlobToDriveResumable');
  assert(/uploadType=resumable/.test(up) && /Content-Range/.test(up) && /status !== 308/.test(up), 'videos upload resumably, in pieces');
  assert(/file\.size > TRIPSY_FLYOVER_VIDEO_MAX_BYTES/.test(extractFn('tripsyFlyoverUploadVideo')), 'an oversized video is refused with a message');
  assert(/data-ss-video-note/.test(extractFn('tripsyFlyoverSlideshowDialog')), 'the page dialog explains a video page instead of asking a count');
  assert(!/res\.blob\(\)/.test(extractFn('tripsyFlyoverPrefetchMusic')) && /return music\.url \|\| null/.test(extractFn('tripsyFlyoverMusicSrcNow')), 'a found song streams from its own address, as it did when music worked on the iPad');
}

// ---- a name that is STILL not English is never shown ("I am still seeing this," 2026-10-21:
// a Thai Four Seasons stop read "ตำบล เวียง" -- Places returned the Thai sub-district even when
// asked for English) ----
eval([extractFn('tripsyFlyoverNameIsNonLatin'), extractFn('tripsyFlyoverTidyPlaceName'), extractFn('tripsyFlyoverNameLevels'),
  extractFn('tripsyFlyoverStopNeedsEnglishName')].join('\n'));
{
  assert(tripsyFlyoverNameIsNonLatin('ตำบล เวียง') && tripsyFlyoverNameIsNonLatin('福岡市') && tripsyFlyoverNameIsNonLatin('Москва'),
    'Thai, Japanese and Cyrillic names are not English');
  assert(!tripsyFlyoverNameIsNonLatin('München') && !tripsyFlyoverNameIsNonLatin('Hội An') && !tripsyFlyoverNameIsNonLatin('St. John’s'),
    'Latin names with accents or curly quotes are fine');
  assert(tripsyFlyoverTidyPlaceName('Chiang Saen District') === 'Chiang Saen' && tripsyFlyoverTidyPlaceName('Amphoe Chiang Saen') === 'Chiang Saen'
    && tripsyFlyoverTidyPlaceName('Mexico City') === 'Mexico', 'district wording is trimmed');
  const lv = tripsyFlyoverNameLevels({ locality: 'ตำบล เวียง', admin2: 'อำเภอ เชียงแสน', admin1: 'เชียงราย' });
  assert(lv.map(l => l.type).join(',') === 'administrative_area_level_2,locality,administrative_area_level_1',
    'a non-Latin town (a Thai sub-district) tries the district first, then the town, then the province');
  assert(tripsyFlyoverNameLevels({ locality: 'München', admin2: 'Oberbayern' })[0].type === 'locality', 'a Latin town is still tried first');
  assert(tripsyFlyoverStopNeedsEnglishName({ labelLang: 'en', label: 'ตำบล เวียง' }) && !tripsyFlyoverStopNeedsEnglishName({ labelLang: 'en', label: 'Singapore' })
    && !tripsyFlyoverStopNeedsEnglishName({ labelLang: 'en', label: 'ตำบล เวียง', labelEdited: true }),
    'THE ASK: a stop already stamped English but still showing Thai is looked up again; an owner-typed name is not');
  assert(/record\.stops\.some\(tripsyFlyoverStopNeedsEnglishName\)/.test(extractFn('showTripsyFlyover')), 'the setup page re-checks such stops on open');
  assert(/if \(tripsyFlyoverNameIsNonLatin\(s\.label\)\) s\.label = '';/.test(extractFn('tripsyFlyoverBuild')), 'a build never keeps a non-English name');
  (async () => {
    const f = new Function(`
      ${extractFn('tripsyFlyoverNameIsNonLatin')}
      async function tripsyFlyoverGeocode(q) { return { lat: 1, lng: 2, city: q === 'camp' ? 'Chiang Saen' : '' }; }
      ${extractFn('tripsyFlyoverEnglishLabels')}
      return tripsyFlyoverEnglishLabels;`)();
    const r = await f({ stops: [{ id: 'a', kind: 'stay', label: 'ตำบล เวียง', labelLang: 'en', query: 'camp' },
      { id: 'b', kind: 'stay', label: 'ตำบล', labelLang: 'en', query: 'nothing' }] });
    assert(r.record.stops[0].label === 'Chiang Saen', 'THE ASK: the Thai stop becomes Chiang Saen');
    assert(r.record.stops[1].label === 'ตำบล' && r.record.stops[1].labelLang === 'en', 'no English found: left as is, and tried again next open (it still reads non-Latin)');
  })().catch(e => { console.log('FAIL thai label', e); process.exitCode = 1; });
}

// ---- photos listed in PAGE order ("Always show pages in the flyover edit view in the order of
// the pages … show them in the new order I selected," 2026-10-21) ----
eval([extractFn('tripsyFlyoverPhotosInPageOrder')].join('\n'));
{
  const ph = id => ({ driveFileId: id });
  const st = { photos: [ph('a'), ph('b'), ph('c'), ph('d')], pages: [{ ids: ['c'], count: 1 }, { ids: ['a', 'd'], count: 2 }] };
  const o = tripsyFlyoverPhotosInPageOrder(st);
  assert(o.map(x => x.photo.driveFileId + x.page).join(',') === 'c1,a2,d2,b3',
    'THE ASK: photos come back in the order their pages play, each with its page; one on no page plays last');
  const setup = extractFn('showTripsyFlyover');
  // Since 2026-10-22 the setup card shows ONE tile per PAGE, in play order ("show each page
  // as a single thumbnail"), so the photo-per-tile pins became page-per-tile pins.
  assert(/const pageTiles = tripsyFlyoverPages\(s\);/.test(setup) && /pageTiles\.map\(\(pg, k\)/.test(setup) && />Page \$\{k \+ 1\}\$\{pg\.photos\.length > 1 \? ` · \$\{pg\.photos\.length\}` : ''\}<\/span>/.test(setup)
    && /<div class="btn" data-flyover-thumb="\$\{k\}" data-flyover-thumb-page="\$\{k \+ 1\}" style="padding:3px; position:relative; cursor:[^\n]*>\s*\$\{tripsyFlyoverPageThumbHtml\(pg, 84, 64, 'border-radius:5px;'\)\}/.test(setup),
    'the setup page lists each destination\'s PAGES in play order, one framed tile each with a "Page N" badge (and a photo count on a page of several)');
  assert(/data-flyover-page-remove="\$\{k\}"/.test(setup) && /const fids = new Set\(pg\.photos\.map\(ph => ph\.driveFileId\)\);/.test(setup) && /filter\(ph => !fids\.has\(ph\.driveFileId\)\)/.test(setup)
    && /if \(fids\.size > 1 && !\(await tripsyConfirmDialog\(`Remove the \$\{fids\.size\} photos on this page\?`/.test(setup),
    'a tile\'s ✕ removes that page\'s photos by id, asking first when there are several');
  assert(/photos: tripsyFlyoverPhotosInPageOrder\(\{ \.\.\.st, pages: r\.pages, photos: r\.photos \}\)\.map\(x => x\.photo\)/.test(setup),
    'Save stores the photos in the new page order');
  assert(/const photos = tripsyFlyoverPhotosInPageOrder\(stop\)\.map/.test(extractFn('tripsyFlyoverSlideshowDialog')), 'the page dialog\'s grid opens in play order too');
  // "On a page where there are multiple photos, divide that thumbnail into as many vertical
  // sections as there are photos on that page, and show a vertical segment of that photo"
  // (2026-10-22).
  const thumbSrc = extractFn('tripsyFlyoverPageThumbHtml');
  assert(/if \(photos\.length <= 1\) return tripsyFlyoverThumbHtml\(photos\[0\] \|\| \{\}, w, h, extra\);/.test(thumbSrc), 'a page of one photo (or a video) is the ordinary thumbnail');
  assert(/display:flex;[^`]*\$\{photos\.map\(\(p, i\) => `<div style="flex:1 1 0; min-width:0; height:100%; background:var\(--panel-2\) center\/cover no-repeat;/.test(thumbSrc) && /data-diary-img="\$\{esc\(p\.driveFileId\)\}"/.test(thumbSrc),
    'THE ASK: a page of several is one frame split into equal vertical strips, each painted with the middle band of its photo (center/cover in a narrow strip)');
  const fakeEsc = s => String(s);
  const html3 = new Function('esc', 'tripsyFlyoverThumbHtml', thumbSrc + '; return tripsyFlyoverPageThumbHtml({ photos: [{driveFileId:"x"},{driveFileId:"y"},{driveFileId:"z"}] }, 84, 64);')(fakeEsc, () => 'SINGLE');
  assert((html3.match(/data-diary-img="/g) || []).length === 3 && /width:84px; height:64px/.test(html3) && (html3.match(/border-left/g) || []).length === 2,
    'three photos make three strips in one 84×64 frame, divided by two lines');
}

// ---- reordering pages from the fly-over page itself, and the wider panels ("Make the pages
// for creating and editing the flyover view much wider. Also, allow the user to edit the order
// of pages from the flyover page by selecting pages and re-ordering them in the same way he
// can from the slideshow edit page," 2026-10-22) ----
eval([extractFn('tripsyFlyoverMovePage'), extractFn('tripsyFlyoverPageRecord'), extractFn('tripsyFlyoverMoveStopPage'), extractFn('tripsyFlyoverMoveThumbPage')].join('\n'));
{
  const ph = id => ({ driveFileId: id });
  const st = { photos: ['A', 'B', 'C', 'D'].map(ph), pages: [{ ids: ['A'], count: 1, seconds: 3 }, { ids: ['B', 'C'], count: 2, seconds: 3 }, { ids: ['D'], count: 1, seconds: 3 }] };
  // Thumbnails in play order: A(1) B(2) C(2) D(3). Dragging A onto D moves page 1 to third.
  let r = tripsyFlyoverMoveThumbPage(st, 0, 3);
  assert(r && r.pages.map(p => p.ids.join('')).join('|') === 'BC|D|A' && r.photos.map(p => p.driveFileId).join('') === 'BCDA',
    'THE ASK: dragging a thumbnail onto another moves its PAGE there, and the stored photos follow the new play order');
  r = tripsyFlyoverMoveThumbPage(st, 3, 1);
  assert(r && r.pages.map(p => p.ids.join('')).join('|') === 'A|D|BC', 'dragging back moves the page before the target\'s page');
  assert(tripsyFlyoverMoveThumbPage(st, 1, 2) === null && tripsyFlyoverMoveThumbPage(st, 0, 9) === null, 'two thumbnails of one page, or a missing one, change nothing');
  assert(st.pages[0].ids.join('') === 'A' && st.photos.length === 4, 'the input is not changed');
  // A stop with no saved pages: its derived pages become the saved ones.
  const st2 = { photos: ['A', 'B', 'C'].map(ph), slideshow: { layout: 'single' } };
  r = tripsyFlyoverMoveThumbPage(st2, 2, 0);
  assert(r && r.pages.length === 3 && r.pages[0].ids.join('') === 'C' && r.pages.every(p => !('photos' in p) && !('auto' in p)),
    'a stop whose pages were only derived gets them saved, in the new order, without the derived-only fields');
  // One tile per PAGE since later the same day ("show each page as a single thumbnail"): a
  // tile's index IS its page index, so the move is tripsyFlyoverMoveStopPage.
  r = tripsyFlyoverMoveStopPage(st, 0, 2);
  assert(r && r.pages.map(p => p.ids.join('')).join('|') === 'BC|D|A' && tripsyFlyoverMoveStopPage(st, 1, 1) === null && tripsyFlyoverMoveStopPage(st, 0, 5) === null,
    'moving by page index moves the page; the same page, or a missing one, changes nothing');
  const setup = extractFn('showTripsyFlyover');
  assert(/const tiles = \[\.\.\.card\.querySelectorAll\('\[data-flyover-thumb\]'\)\];\s*tripsyFlyoverWireDrag\(tiles, \(from, to\) => \{\s*const r = tripsyFlyoverMoveStopPage\(stop\(\), from, to\);\s*if \(!r\) return;\s*updateStop\(id, r\);\s*save\(\);\s*\}, \{ holdMs: 280, state: dragState, afterDrop: \(\) => \{ if \(!closed\) render\(\); \} \}\);/.test(setup),
    'the setup page\'s page tiles drag through the shared mechanism with a press-and-hold, saving the move at once');
  assert(/if \(Date\.now\(\) < dragState\.suppressTapUntil\) return;[^\n]*\n\s*const pg = tripsyFlyoverPages\(stop\(\)\)\[Number\(b\.getAttribute\('data-flyover-page-remove'\)\)\]/.test(setup),
    'the release that ended a drag never removes a page');
  assert(/Tap a page to edit it\. Drag a page onto another to move it there\./.test(setup), 'the card says its pages can be tapped and dragged');
  assert(/tiles\.forEach\(t => t\.onclick = e => \{\s*if \(!isOwner \|\| e\.target\.closest\('button'\)\) return;\s*if \(Date\.now\(\) < dragState\.suppressTapUntil\) return;[^\n]*\n\s*openSlideshowOptions\(id, '', Number\(t\.getAttribute\('data-flyover-thumb'\)\)\);/.test(setup)
    && /if \(page != null && pages\[page\]\) cur = page;/.test(extractFn('tripsyFlyoverSlideshowDialog')),
    'tapping a page tile opens the Slideshow options page on that page');
  const wd = extractFn('tripsyFlyoverWireDrag');
  assert(/if \(e\.button \|\| \(btn && btn !== el\)\) return;/.test(wd), 'a tap on the ✕ inside a thumbnail is never the start of a drag (a chip that IS a button still drags)');
  assert(/<div class="tw-modal-paper tw-wide" style="max-width:1240px;/.test(setup)
    && /<div class="tw-modal-paper tw-wide" style="max-width:1140px;/.test(extractFn('tripsyFlyoverSlideshowDialog'))
    && /<div class="tw-modal-paper tw-wide" style="max-width:1140px;/.test(extractFn('tripsyFlyoverEditDestinationsDialog')),
    'the fly-over page and its two editing dialogs are much wider than the 820/660/720 px they were');
}

// ---- Save buttons on the fly-over page ("There should be save buttons on the flyover page,"
// 2026-10-21) ----
{
  const setup = extractFn('showTripsyFlyover');
  assert(/class="tripsy-close-x tripsy-save-check" data-flyover-save[^>]*>✓<\/button>` : ''\}\s*<button class="tripsy-close-x" data-flyover-close/.test(setup),
    'THE ASK: a green ✓ Save sits beside the ✕ at the top');
  // "The cancel and save buttons on the top and bottom of the flyover screen should be
  // consistent" (2026-10-22), then "The save and close buttons at the bottom of the flyover
  // menu should not have words in them" (same day): the footer pair is the header pair exactly,
  // glyph-only, same colours.
  assert(/<div class="tfo-ss-footer"[^>]*>\s*<button class="tripsy-close-x" data-flyover-close title="Close" aria-label="Close">✕<\/button>\s*<button class="tripsy-close-x tripsy-save-check" data-flyover-save title="Save" aria-label="Save">✓<\/button>/.test(setup),
    'and ✕ / ✓ sit in a pinned footer at the bottom, as the same word-free red/green boxes as the top');
  // "Do the same for the edit destinations and slideshow dialogs" (2026-10-22): their footers are
  // glyph-only too, and the wide word-carrying variant is gone.
  assert(!/tripsy-close-x--wide/.test(html), 'no wide word-carrying ✕/✓ variant remains anywhere');
  for (const [dlg, cancel, save] of [['tripsyFlyoverEditDestinationsDialog', 'data-fe-cancel', 'data-fe-save'], ['tripsyFlyoverSlideshowDialog', 'data-ss-cancel', 'data-ss-save']]) {
    const fn = extractFn(dlg);
    assert(new RegExp(`<div class="tfo-ss-footer"[\\s\\S]*?<button class="tripsy-close-x" ${cancel} title="Cancel" aria-label="Cancel">✕</button>\\s*<button class="tripsy-close-x tripsy-save-check" ${save} title="Save" aria-label="Save">✓</button>`).test(fn),
      `${dlg}'s footer is a word-free ✕ / ✓ pair in the same boxes as its header`);
  }
  assert(/querySelectorAll\('\[data-flyover-save\]'\)\.forEach\(b => b\.onclick = async/.test(setup) && /a\.blur\(\)/.test(setup)
    && /const ok = await save\(\);\s*if \(!ok\) throw/.test(setup) && /toast\('Fly-over saved\.'\);\s*close\(\);/.test(setup),
    'Save commits a name still being typed, waits for Drive, says so, then closes; a failed save keeps the page open');
  assert(/return ok;\s*\}, \(\) => false\);/.test(setup), 'save() reports whether Drive took it');
  assert(/querySelectorAll\('\[data-flyover-close\]'\)\.forEach/.test(setup), 'both Close controls close');
}

// ---- dragging pages to reorder them ("On the slideshow view, allow the user to reorder the
// pages by dragging them," 2026-10-21) ----
eval([extractFn('tripsyFlyoverMovePage'), extractFn('tripsyFlyoverNearestRect')].join('\n'));
{
  const P = ['A', 'B', 'C', 'D'];
  let r = tripsyFlyoverMovePage(P, 0, 2, 0);
  assert(r.pages.join('') === 'BCAD' && r.cur === 2, 'THE ASK: dragging page 1 onto page 3 moves it there, and the page being edited follows it');
  r = tripsyFlyoverMovePage(P, 3, 0, 1);
  assert(r.pages.join('') === 'DABC' && r.cur === 2, 'another page being edited keeps its own page as the others shift');
  r = tripsyFlyoverMovePage(P, 1, 1, 1);
  assert(r.pages.join('') === 'ABCD' && r.cur === 1 && tripsyFlyoverMovePage(P, 9, 0, 0).pages.join('') === 'ABCD', 'a drop on itself, or out of range, changes nothing');
  assert(P.join('') === 'ABCD', 'the input is not changed');
  const rects = [{ left: 0, top: 0, width: 50, height: 50 }, { left: 60, top: 0, width: 50, height: 50 }, { left: 0, top: 60, width: 50, height: 50 }];
  assert(tripsyFlyoverNearestRect(rects, 90, 10) === 1 && tripsyFlyoverNearestRect(rects, 20, 100) === 2 && tripsyFlyoverNearestRect([], 0, 0) === null,
    'the drop spot is the page nearest the finger, on any row of the strip');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  // The drag mechanism is the shared tripsyFlyoverWireDrag since 2026-10-22 (the setup page's
  // thumbnails use it too).
  const wd = extractFn('tripsyFlyoverWireDrag');
  assert(/el\.onpointerdown/.test(wd) && /el\.onpointermove/.test(wd) && /el\.onpointerup = \(\) => end\(false\)/.test(wd) && /holdMs \? 'manipulation' : 'none'/.test(wd),
    'drag runs on pointer events (a finger on iPad works like a mouse) and the page strip doesn\'t scroll while dragging');
  assert(/tripsyFlyoverMovePage\(pages, from, to, cur\)/.test(dlg) && /st\.suppressTapUntil = Date\.now\(\) \+ 400/.test(wd)
    && /const wireDrag = \(items, onDrop, opts = \{\}\) => tripsyFlyoverWireDrag\(items, onDrop, \{ \.\.\.opts, state: dragState, afterDrop: render \}\);/.test(dlg)
    && /if \(Date\.now\(\) < dragState\.suppressTapUntil\) return;[^\n]*\n\s*cur = Number\(b\.getAttribute\('data-ss-goto'\)\)/.test(dlg),
    'letting go reorders the pages, and the release doesn\'t also count as a tap on a page');
  assert(/tfo-ss-page/.test(dlg) && /tripsyFlyoverThumbHtml\(first, 44, 33/.test(dlg) && /Drag a page to change the order/.test(dlg),
    'each page in the strip shows its first photo, with a hint that pages can be dragged');
}

// ---- dragging PHOTOS in the grid to swap them ("I cannot click and drag pictures," 2026-10-21) ----
eval(extractFn('tripsyFlyoverSwapPhotos'));
{
  const ph = id => ({ driveFileId: id });
  const pages = [{ ids: ['a'] }, { ids: ['b', 'c'] }, { ids: ['v'] }];
  const photos = ['a', 'b', 'c', 'v', 'x'].map(ph);
  const isV = id => id === 'v';
  let r = tripsyFlyoverSwapPhotos(pages, photos, 'a', 'c', isV);
  assert(r.pages.map(p => p.ids.join('')).join('|') === 'c|ba|v' && r.photos.map(p => p.driveFileId).join('') === 'cbavx',
    'THE ASK: dragging a photo onto another swaps their pages and their places in the grid');
  r = tripsyFlyoverSwapPhotos(pages, photos, 'a', 'x', isV);
  assert(r.pages[0].ids.join('') === 'x' && r.photos.map(p => p.driveFileId).join('') === 'xbcva', 'a photo on no page swaps in, and the other comes off');
  assert(tripsyFlyoverSwapPhotos(pages, photos, 'v', 'b', isV).ownPage && tripsyFlyoverSwapPhotos(pages, photos, 'v', 'a', isV).pages.map(p => p.ids.join('')).join('|') === 'v|bc|a',
    'a video swaps only with a photo alone on its page');
  assert(pages[1].ids.join('') === 'bc' && photos[0].driveFileId === 'a', 'the inputs are not changed');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/wireDrag\(gridItems, \(from, to, side\) => \{[\s\S]*tripsyFlyoverSwapPhotos\(pages, photos, a, b, isVideo\)[\s\S]*\}, \{ holdMs: 280, zones: true \}\);/.test(dlg) && /<div data-ss-grid/.test(dlg),
    'the grid\'s photos are draggable, with a short press-and-hold for a finger so a swipe still scrolls');
  const wd = extractFn('tripsyFlyoverWireDrag');
  assert(/if \(st\.drag && st\.drag\.el === el && st\.drag\.held\) e\.preventDefault\(\);/.test(wd) && /\{ passive: false \}/.test(wd), 'once held, the finger drags instead of scrolling');
  assert(/data-ss-photo\]'\)\.forEach\(b => b\.onclick = \(\) => \{\s*if \(Date\.now\(\) < dragState\.suppressTapUntil\) return;/.test(dlg), 'the release that ends a drag is not also a tap');
  assert(/Drag a photo onto another to swap them/.test(dlg), 'the grid says it can be dragged');
}

// ---- moving a photo's page IN BETWEEN others ("Allow photo pages to also be moved in between
// other pages not just swapped," 2026-10-21) ----
eval([extractFn('tripsyFlyoverDropSide'), extractFn('tripsyFlyoverInsertPhotoPage')].join('\n'));
{
  const R = { left: 100, width: 100 };
  assert(tripsyFlyoverDropSide(R, 110) === 'before' && tripsyFlyoverDropSide(R, 150) === 'swap' && tripsyFlyoverDropSide(R, 190) === 'after'
    && tripsyFlyoverDropSide(R, 60) === 'before' && tripsyFlyoverDropSide(R, 240) === 'after', 'the outer 30% of a photo (or the gap beside it) means in between; the middle means swap');
  const ph = id => ({ driveFileId: id });
  const P = () => [{ ids: ['a'], t: 1 }, { ids: ['b'], t: 2 }, { ids: ['c', 'd'], t: 3, transition: 'slide', seconds: 5 }, { ids: ['e'], t: 4 }];
  const photos = ['a', 'b', 'c', 'd', 'e', 'x'].map(ph);
  const ids = r => r.pages.map(p => p.ids.join('')).join('|');
  let r = tripsyFlyoverInsertPhotoPage(P(), photos, 'a', 'e', 'before', 0);
  assert(r.ok && ids(r) === 'b|cd|a|e' && r.cur === 2 && r.photos.map(p => p.driveFileId).join('') === 'bcdaex',
    'THE ASK: a photo\'s page dropped before another page moves in between, and the page being edited follows it');
  r = tripsyFlyoverInsertPhotoPage(P(), photos, 'e', 'a', 'after', 1);
  assert(ids(r) === 'a|e|b|cd' && r.cur === 2, 'after works too, and another edited page keeps its own page');
  r = tripsyFlyoverInsertPhotoPage(P(), photos, 'd', 'a', 'before', 2);
  assert(ids(r) === 'd|a|b|c|e' && r.pages[0].transition === 'slide' && r.pages[0].seconds === 5 && r.pages[3].count === 1 && r.cur === 3,
    'a photo sharing its page leaves it for a new page of its own at that spot, with the page\'s timing');
  r = tripsyFlyoverInsertPhotoPage(P(), photos, 'd', 'c', 'before', 2);
  assert(ids(r) === 'a|b|dc|e' && r.cur === 2, 'two photos on the same page just change places on it');
  r = tripsyFlyoverInsertPhotoPage(P(), photos, 'x', 'b', 'after', 0);
  assert(ids(r) === 'a|b|x|cd|e', 'a photo on no page gets a new page in between');
  assert(!tripsyFlyoverInsertPhotoPage(P(), photos, 'a', 'x', 'before', 0).ok, 'dropping beside a photo on no page does nothing');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/if \(side !== 'swap'\) \{[\s\S]*tripsyFlyoverInsertPhotoPage\(pages, photos, a, b, side, cur\)/.test(dlg) && /\{ holdMs: 280, zones: true \}/.test(dlg)
    && /tfo-ss-ins-before/.test(extractFn('tripsyFlyoverWireDrag')), 'the grid drops in between at an edge, shown as a green bar, and swaps in the middle');
}

// ---- an in-between move shows ONLY a vertical dashed line ("just show a vertical dashed line
// between the pages it will be moved between," 2026-10-21) ----
{
  assert(/\.tfo-ss-ins-before::before, \.tfo-ss-ins-after::after \{[^}]*border-left: 3px dashed #3AA76D/.test(html) && !/\.tfo-ss-ins-before::before[^}]*background:/.test(html),
    'THE ASK: the in-between marker is a vertical dashed line in the gap, nothing else');
  const dlg = extractFn('tripsyFlyoverWireDrag'); // the shared drag mechanism (2026-10-22)
  assert(/\(drag\.to > drag\.from \? 'after' : 'before'\)/.test(dlg) && /c\.classList\.toggle\('tfo-ss-drop', hit && drag\.side === 'swap'\)/.test(dlg),
    'the page strip (which always moves) shows the same line on the side the page will land; only a swap outlines the target');
}

// ---- ask the transport when the trip names none ("Where there is no form of transportation
// specified between two points, bring up a dialog box asking the user what type of
// transportation is involved," 2026-10-21) ----
eval(extractFn('tripsyFlyoverStopsNeedingMode'));
{
  const st = (id, extra = {}) => ({ id, label: id.toUpperCase(), lat: 1, lng: 1, mode: 'car', ...extra });
  const rec = { stops: [st('o', { mode: '' }), st('a', { modeGuessed: true }), st('x', { removed: true, modeGuessed: true }),
    st('b'), st('c', { modeGuessed: true, modeManual: true }), st('d')] };
  let q = tripsyFlyoverStopsNeedingMode(rec, new Set(['d']));
  assert(q.map(x => `${x.from.id}>${x.stop.id}`).join(',') === 'o>a,c>d',
    'THE ASK: legs with no transport on the trip are asked about, in order, each with the stop it comes from; answered or removed ones are not');
  q = tripsyFlyoverStopsNeedingMode({ stops: [st('a', { modeGuessed: true }), st('b', { modeGuessed: true })] }, []);
  assert(q.length === 1 && q[0].stop.id === 'b', 'the first stop on the map has no leg in, so it is never asked');
  assert(tripsyFlyoverStopsNeedingMode({ stops: [st('a'), st('b', { modeGuessed: true, lat: null })] }, []).length === 0, 'an unplaced stop is not asked');
  const derive = extractFn('tripsyFlyoverDeriveStops');
  assert(/if \(!modes\[i\]\) stops\[i\]\.modeGuessed = true;/.test(derive), 'a leg the trip says nothing about is drawn as a drive but flagged as a guess');
  assert(/\.\.\.\(p\.modeManual \? \{ mode: p\.mode, modeManual: true, modeGuessed: false \} : \{\}\)/.test(extractFn('tripsyFlyoverCarryOver')),
    'a transport the owner chose survives a rebuild');
  const ask = extractFn('tripsyFlyoverAskMode');
  assert(/TRIPSY_FLYOVER_MODES\.map/.test(ask) && /data-mode-later/.test(ask) && /How did you get there\?/.test(ask),
    'the dialog offers flight / train / drive / ferry, or Not now');
  const setup = extractFn('showTripsyFlyover');
  assert(/render\(\);\s*askMissingModes\(\);/.test(setup) && /tripsyFlyoverDeriveStops\(trip\)\.filter\(x => x\.modeGuessed\)/.test(setup),
    'opening the setup page asks right away, including for fly-overs saved before the flag');
  assert(/updateStop\(st\.id, \{ mode: m, modeManual: true, modeGuessed: false \}\);/.test(setup) && /if \(!m \|\| closed\) break;/.test(setup),
    'each answer is saved on its stop; Not now stops asking until next time');
  assert(/<select class="field-input" data-flyover-mode-select/.test(setup) && /❓/.test(setup)
    && /modeSel\.onchange = \(\) => \{[\s\S]*updateStop\(id, \{ mode: m, modeManual: true, modeGuessed: false \}\);/.test(setup),
    'THE ASK (2026-10-21): each leg\'s transport is a drop-down menu to change it, marked ❓ while it is still a guess');
  assert(!/data-flyover-mode[^-]/.test(setup), 'the old tap-to-change button is gone');
}

// ---- a video's sound: its own, or the fly-over music ("When the user selects a video, ask the
// user if he wants to use audio from the video or the flyover music. Also, add an option for the
// user to hear the music from the video," 2026-10-21) ----
eval(extractFn('tripsyFlyoverVideoAudio'));
{
  assert(tripsyFlyoverVideoAudio({ kind: 'video', audio: 'music' }) === 'music' && tripsyFlyoverVideoAudio({ kind: 'video' }) === 'video'
    && tripsyFlyoverVideoAudio(null) === 'video', 'a video plays its own sound unless set to the music (older videos keep their sound)');
  const dlg = extractFn('tripsyFlyoverVideoAudioDialog');
  assert(/data-va-pick="video"/.test(dlg) && /data-va-pick="music"/.test(dlg) && /<video data-va-video playsinline controls/.test(dlg) && /▶ Hear the video/.test(dlg)
    && /v\.muted = false;/.test(dlg), 'THE ASK: the dialog plays the video so its sound can be heard, then asks: its own sound or the fly-over music');
  const setup = extractFn('showTripsyFlyover');
  assert(/tripsyFlyoverVideoAudioDialog\(localUrl,[\s\S]*tripsyFlyoverUploadVideo\(file, f =>[\s\S]*rec\.audio = audio === 'music' \? 'music' : 'video';/.test(setup),
    'each video picked is asked about (from the picked file, before uploading) and the answer saved on it');
  const ss = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/data-ss-vaudio="video"/.test(ss) && /data-ss-vaudio="music"/.test(ss) && /data-ss-vhear/.test(ss) && /photos\[i\] = \{ \.\.\.photos\[i\], audio: val \}/.test(ss),
    'a video page can switch its sound, or play the video to hear it, in Slideshow options (saved with Save)');
  const player = extractFn('playTripsyFlyover');
  assert(/const underMusic = tripsyFlyoverVideoAudio\(rec\) === 'music';/.test(player) && /v\.muted = underMusic;/.test(player)
    && /const duck = underMusic \? Promise\.resolve\(\) : duckMusic\(\);/.test(player),
    'a video set to the music plays silently and the music never fades out for it');
  assert(/tripsyFlyoverVideoAudio\(p\) === 'music' \? '🎵' : '🔊'/.test(extractFn('tripsyFlyoverThumbHtml')), 'its thumbnail shows which sound it uses');
}

// ---- hiking between locations ("Add an option to hike between locations for the flyover," 2026-10-21) ----
eval([constLine('TRIPSY_FLYOVER_MODES'), extractFn('tripsyFlyoverModeOf')].join('\n').replace(/^const /gm, 'var '));
{
  assert(TRIPSY_FLYOVER_MODES.includes('hike') && /hike: '🚶'/.test(html) && /hike: 'Hike'/.test(html), 'THE ASK: Hike is one of the transports, shown as 🚶 Hike');
  assert(/<select class="field-input" data-flyover-mode-select[^`]*\$\{TRIPSY_FLYOVER_MODES\.map/.test(extractFn('showTripsyFlyover')),
    'the leg drop-down offers it');
  assert(/TRIPSY_FLYOVER_MODES\.map/.test(extractFn('tripsyFlyoverAskMode')), 'and so does the "How did you get there?" question');
  assert(tripsyFlyoverModeOf({ category: 'other' }, 'Hike to the summit') === 'hike' && tripsyFlyoverModeOf({ category: 'car' }, 'Car from A to B') === 'car'
    && tripsyFlyoverModeOf({ category: 'other' }, 'Walkabout tour') === 'car', 'a transport leg the trip names as a hike or walk draws as one (whole words only)');
  assert(/mode === 'hike' \? '2 7'/.test(extractFn('playTripsyFlyover')), 'a hike is drawn as a dotted trail');
}

// ---- Layovers ("where there is a layover on a flight, show the flight to the layover cities,
// but do not zoom the map, or show photos. Just display the name of the city," 2026-10-21) ----
{
  const trip = { events: [
    leg(901, 'airplane', 'Flight from LAX to NRT', 'LAX', 'NRT', '2030-03-01T10:00:00', '2030-03-02T14:00:00'),
    leg(902, 'airplane', 'Flight from NRT to SIN', 'NRT', 'SIN', '2030-03-02T17:00:00', '2030-03-02T23:00:00'),
    stay(911, 'Raffles', '1 Beach Rd, Singapore 189673', '2030-03-02T15:00:00', '2030-03-06T11:00:00'),
    leg(903, 'airplane', 'Flight from SIN to HKG', 'SIN', 'HKG', '2030-03-06T09:00:00', '2030-03-06T13:00:00'),
    leg(904, 'airplane', 'Flight from HKG to LAX', 'HKG', 'LAX', '2030-03-06T15:00:00', '2030-03-06T12:00:00'),
  ] };
  const st = tripsyFlyoverDeriveStops(trip);
  const raffles = st.find(s => s.kind === 'stay'), home = st.find(s => s.kind === 'return');
  assert(raffles && raffles.via && raffles.via.length === 1 && raffles.via[0].label === 'NRT' && raffles.via[0].query === 'NRT airport',
    'two flights into a stay: the first arrival is a layover on that leg');
  assert(home && home.via && home.via.map(v => v.label).join() === 'HKG', 'the flights home carry their connection too');
  assert(!st.find(s => s.kind === 'origin').via, 'the departure airport has no layover');
  // a trip with no lodging: each arrival is a destination, never a layover
  const hop = { events: [
    leg(921, 'airplane', 'Flight from LAX to SFO', 'LAX', 'SFO', '2030-04-01T08:00:00', '2030-04-01T09:30:00'),
    leg(922, 'airplane', 'Flight from SFO to SEA', 'SFO', 'SEA', '2030-04-01T11:00:00', '2030-04-01T13:00:00'),
    leg(923, 'airplane', 'Flight from SEA to LAX', 'SEA', 'LAX', '2030-04-03T08:00:00', '2030-04-03T10:30:00'),
  ] };
  assert(tripsyFlyoverDeriveStops(hop).every(s => !(s.via || []).some(v => v.label === 'SFO')), 'an arrival that is itself a destination is not a layover');
  // a single flight: no layover
  const one = { events: [leg(931, 'airplane', 'Flight from LAX to SIN', 'LAX', 'SIN', '2030-05-01T10:00:00', '2030-05-02T18:00:00'),
    stay(932, 'Raffles', '1 Beach Rd, Singapore 189673', '2030-05-02T15:00:00', '2030-05-06T11:00:00')] };
  assert(tripsyFlyoverDeriveStops(one).every(s => !s.via), 'a nonstop flight has no layover');
  // playback: layover longitudes unwrap with the route, and the first stop shown has none
  const p = tripsyFlyoverPlayableStops({ stops: [
    { id: 'a', lat: 34, lng: -118, via: [{ label: 'X', lat: 1, lng: 1 }] },
    { id: 'b', lat: 1.3, lng: 103.8, via: [{ label: 'Tokyo', lat: 35.7, lng: 139.7 }, { label: 'Nowhere' }] },
  ] });
  assert(p[0].via.length === 0, 'the first stop shown has no leg in, so no layover');
  assert(p[1].via.length === 1 && p[1].via[0].label === 'Tokyo' && p[1].via[0].lng < -180 && p[1].lng < -180,
    'a layover is unwrapped in sequence (LAX → Tokyo → Singapore across the Pacific); one with no place is skipped');
  // the same city on two legs shares ONE point (and so one dot)
  const twice = tripsyFlyoverPlayableStops({ stops: [
    { id: 'o', label: 'Los Angeles', lat: 33.94, lng: -118.41 },
    { id: 'c', label: 'Chiang Rai', lat: 19.9, lng: 99.8, via: [{ label: 'Bangkok', lat: 13.69, lng: 100.75 }] },
    { id: 'd', label: 'Hoi An', lat: 15.9, lng: 108.3, via: [{ label: 'Bangkok', lat: 13.91, lng: 100.6 }] },
    { id: 's', label: 'Singapore', lat: 1.29, lng: 103.85 },
    { id: 'f', label: 'Fukuoka', lat: 33.59, lng: 130.4, via: [{ label: 'Singapore', lat: 1.36, lng: 103.99 }] },
  ] });
  assert(twice[2].via[0].lat === twice[1].via[0].lat && twice[2].via[0].lng === twice[1].via[0].lng,
    'a layover city flown through on two legs (Bangkok, BKK then DMK) uses the first visit\'s point');
  assert(twice[4].via[0].lat === twice[3].lat && twice[4].via[0].lng === twice[3].lng,
    'a layover in a city already shown (the Singapore airport, named for its city, near the Singapore stay) shares its point');
  assert(twice[3].lat === 1.29 && twice[1].lat === 19.9, 'distinct cities keep their own points');
  // Three towns 25-35 km apart are three places ("How come nakatsu, hita, and beppu all have
  // the same location," 2026-10-22 -- distance alone joined them); only a point a couple of
  // km away is the same place whatever it is called.
  const towns = tripsyFlyoverPlayableStops({ stops: [
    { id: 'n', label: 'Nakatsu', lat: 33.5158, lng: 131.2025 }, { id: 'h', label: 'Hita', lat: 33.3126, lng: 130.9309 },
    { id: 'b', label: 'Beppu', lat: 33.3163, lng: 131.4744 }, { id: 'x', label: 'Marugamiya', lat: 33.3201, lng: 131.4790 },
  ] });
  assert(towns[1].lat === 33.3126 && towns[2].lat === 33.3163, 'nearby towns with different names keep their own dots');
  assert(towns[3].lat === towns[2].lat && towns[3].lng === towns[2].lng, 'a point within a couple of km is the same place even under another name');
  const round = tripsyFlyoverPlayableStops({ stops: [
    { id: 'o', label: 'Los Angeles', lat: 33.94, lng: -118.41 },
    { id: 's', label: 'Singapore', lat: 1.29, lng: 103.85 },
    { id: 'r', label: 'Los Angeles', lat: 33.94, lng: -118.41 },
  ] });
  assert(round[2].lat === round[0].lat && round[2].lng === round[0].lng, 'flying home to where the trip started lands on the origin\'s own dot');
  const far = tripsyFlyoverPlayableStops({ stops: [
    { id: 'a', label: 'Here', lat: 0, lng: 170 }, { id: 'b', label: 'B', lat: 0, lng: -100 }, { id: 'c', label: 'C', lat: 0, lng: 0 },
    { id: 'd', label: 'D', lat: 0, lng: 100 }, { id: 'e', label: 'Here', lat: 0, lng: 170 },
  ] });
  assert(Math.abs(far[4].lng - far[0].lng) >= 180, 'a point a whole world away after unwrapping is never joined to the first copy');
}
{
  const play = extractFn('playTripsyFlyover');
  assert(/const via = b\.mode === 'plane' \? \(b\.via \|\| \[\]\) : \[\];/.test(play), 'only a flight leg is drawn through its layovers');
  assert(/L\.latLngBounds\(\[\[a\.lat, a\.lng\], \.\.\.via\.map/.test(play), 'the leg is framed WITH its layovers (no zoom into them)');
  const loop = play.slice(play.indexOf('for (const v of via)'), play.indexOf('from = v;'));
  assert(/animateLeg\(r, from, v, 'plane', carry\)/.test(loop) && !/tfo-via-label/.test(loop) && !/flyTo|showPage|showCard|arrive\(/.test(loop),
    'at a layover: fly there and pause -- no zoom, no card, no photos (its name is already up)');
  assert(/const showLayovers = via => via\.map\(v => \{\s*ensureDot\(v\);[\s\S]*?tfo-via-label tfo-dest-label[\s\S]*?viaLabels\.push\(m\);/.test(play)
    && /const viaMarks1 = showLayovers\(via1\);/.test(play) && /ensureDot\(b\);\s*const viaMarks = showLayovers\(via\);\s*if \(!\(await untilMoveEnd\(r, \(\) => map\.flyToBounds\(legBounds/.test(play),
    'a leg\'s layover dots and names go up WITH the destination\'s, as the leg begins (first leg included)');
  assert(/const key = `\$\{\(\+s\.lat\)\.toFixed\(5\)\},\$\{\(\+s\.lng\)\.toFixed\(5\)\}`;\s*if \(dotted\.has\(key\)\) return;/.test(play),
    'dots are keyed by position, so a city visited twice gets one dot');
  assert(/tripsyFlyoverGeocodeVias\(stops\)/.test(extractFn('tripsyFlyoverBuild')) && /layoversAt/.test(extractFn('tripsyFlyoverBuild')), 'a build places the layovers');
  assert(/tripsyFlyoverAddLayovers\(record, trip\)/.test(extractFn('showTripsyFlyover')), 'an older fly-over picks layovers up on the setup page');
  assert(/opts\.layovers/.test(play) && /tripsyFlyoverAddLayovers\(record, trip\)/.test(html.slice(html.indexOf('[data-tripsy-flyover]'), html.indexOf('[data-tripsy-flyover]') + 2000)),
    'and on View, before it plays');
}
// geocoding vias: placed, English name, unfound dropped
(async () => {
  const fake = new Function('tripsyFlyoverGeocode', 'tripsyFlyoverNameIsNonLatin', extractFn('tripsyFlyoverGeocodeVias') + '; return tripsyFlyoverGeocodeVias;')(
    async q => q === 'NRT airport' ? { lat: 35.7, lng: 140.4, city: 'Narita' } : q === 'BKK airport' ? { lat: 13.7, lng: 100.7, city: 'กรุงเทพ' } : null,
    n => /[^\u0000-ɏ]/.test(n));
  const stops = [{ id: 's', via: [{ label: 'NRT', query: 'NRT airport' }, { label: 'BKK', query: 'BKK airport' }, { label: 'ZZZ', query: 'ZZZ airport' }] }, { id: 't', via: [{ label: 'ZZZ', query: 'ZZZ airport' }] }];
  await fake(stops);
  assert(stops[0].via.map(v => v.label).join() === 'Narita,BKK' && stops[0].via[0].lat === 35.7, 'layovers take their English city name; a non-Latin answer keeps the flight\'s own wording');
  assert(!('via' in stops[1]), 'a layover that can\'t be found is dropped');
})();

// ---- Airport destinations take their airport's city ("Where there are flight destinations use
// the city names from the airports listed in the itinerary," 2026-10-21) ----
{
  const f = new Function('tripsyFlyoverNameIsNonLatin', [constLine('TRIPSY_AIRPORT_CITIES') || (html.match(/const TRIPSY_AIRPORT_CITIES = \{[\s\S]*?\n\};/) || [''])[0],
    extractFn('tripsyFlyoverAirportCity'), extractFn('tripsyFlyoverAirportDesc'), extractFn('tripsyFlyoverIsAirportStop'),
    extractFn('tripsyFlyoverApplyAirportCities'),
    'return { city: tripsyFlyoverAirportCity, apply: tripsyFlyoverApplyAirportCities };'].join('\n'))(n => /[^\u0000-ɏ]/.test(n));
  const C = f.city;
  assert(C('NRT') === 'Tokyo' && C('DMK') === 'Bangkok' && C('ICN') === 'Seoul' && C('LAX') === 'Los Angeles', 'a bare airport code reads as the city it serves');
  assert(C('Zürich (ZRH)') === 'Zurich' && C('Newark, NJ/New York, NY, US (EWR)') === 'Newark', 'a "City (CODE)" airport reads as its city, in English');
  assert(C('Montrose, CO (MTJ)') === 'Montrose' && C('Springfield (QQQ)') === 'Springfield', 'an unknown code with a city in the record uses the record\'s city');
  assert(C('SMO Santa Monica, CA - 3100 Donald Douglas Loop N, Santa Monica, CA 90405') === 'Santa Monica', 'a "CODE City - address" airport reads as its city');
  assert(C('QQQ') === '' && C('') === '', 'an unknown bare code leaves the geocoded name alone');
  const rec = { stops: [
    { id: 'origin', kind: 'origin', label: 'Los Angeles', query: 'LAX airport' },
    { id: 'hosting-1', kind: 'stay', label: 'Singapore', via: [{ label: 'Narita', query: 'NRT airport' }] },
    { id: 'return', kind: 'return', label: 'Incheon', query: 'ICN airport' },
    { id: 'arrive-2', kind: 'stay', label: 'Wherever', query: 'Zürich (ZRH)', labelEdited: true },
  ] };
  const r = f.apply(rec);
  assert(r.changed && r.record.stops[2].label === 'Seoul' && r.record.stops[2].labelLang === 'en', 'an older fly-over\'s airport stop is renamed from its stored lookup');
  assert(r.record.stops[1].via[0].label === 'Tokyo' && r.record.stops[1].label === 'Singapore', 'a layover takes its airport\'s city; a hotel stay is untouched');
  assert(r.record.stops[3].label === 'Wherever', 'a name the owner typed is kept');
  assert(f.apply(r.record).changed === false, 'applying twice changes nothing');
  assert(/airport: dep, names/.test(extractFn('tripsyFlyoverDeriveStops')) && /query: tripsyFlyoverAirportQuery\(d\), airport: d/.test(extractFn('tripsyFlyoverDeriveStops')), 'derived airport stops and layovers remember the airport as written');
  assert(/return tripsyFlyoverApplyAirportCities\(rec\)\.record;/.test(extractFn('tripsyFlyoverBuild')), 'a build names airports by city');
  assert(/record = tripsyFlyoverApplyAirportCities\(record\)\.record;/.test(extractFn('playTripsyFlyover')), 'playback names them too, saved or not');
  assert(/const named = tripsyFlyoverApplyAirportCities\(record\);/.test(extractFn('showTripsyFlyover')), 'the setup page renames an older fly-over\'s airports');
}
{
  assert(tripsyFlyoverModeOf({ category: 'car' }, 'Car from Chiang Rai Airport (arriving Flight TG136) → Camp') === 'car'
    && tripsyFlyoverModeOf({ category: 'roadtrip' }, 'Roadtrip to the airport for Flight X') === 'car',
    'a car whose wording names a flight is still a car (its category decides)');
  assert(tripsyFlyoverModeOf({ category: 'airplane' }, '') === 'plane' && tripsyFlyoverModeOf({}, 'Flight from LAX to SIN') === 'plane',
    'flights are still flights, by category or by title');
}
{
  const add = extractFn('tripsyFlyoverAddLayovers');
  assert(/tripsyFlyoverLayoversCurrent\(record\)/.test(add) && /const TRIPSY_FLYOVER_LAYOVERS_V = 2;/.test(html)
    && /layoversV: TRIPSY_FLYOVER_LAYOVERS_V/.test(extractFn('tripsyFlyoverBuild')),
    'a fly-over whose layovers were found by the earlier rules is looked at again, once');
  assert(/const \{ via: _gone, \.\.\.rest \} = s;/.test(add), 'and a stop that no longer has layovers loses its bogus ones');
  assert(!/record\.layoversAt \?|!record\.layoversAt\)/.test(html), 'no caller still keys on the old stamp');
}
{
  // Slideshow options take effect at once; bookend photos; sharp tiles (2026-10-21).
  const setup = extractFn('showTripsyFlyover');
  assert(/const save = \(\) => \{[\s\S]{0,400}?record = tripsyFlyoverResolvePendingIds\(record\);\s*Store\.stageTripsyFlyover\(record\);/.test(setup)
    && /Store\.persistTripsyFlyovers\(\)/.test(setup),
    'a fly-over change is staged in memory before its Drive write queues, so View plays it immediately');
  const dd = { tripsyFlyovers: [{ tripKey: 'a', v: 1 }, { tripKey: 'b', v: 1 }] };
  const store = new Function('driveData', 'return ({' + html.match(/  stageTripsyFlyover\(record\) \{[\s\S]*?\n  \},/)[0] + '})')(dd);
  store.stageTripsyFlyover({ tripKey: 'a', v: 2 });
  assert(dd.tripsyFlyovers.length === 2 && dd.tripsyFlyovers.find(r => r.tripKey === 'a').v === 2, 'staging replaces the trip\'s record synchronously');
  const play = extractFn('playTripsyFlyover');
  const iOpen = play.indexOf('if (openWithPhotos) {'), iOverview = play.indexOf("formatTripDateRange(tripsyItineraryStartDayKey(trip)");
  assert(iOpen > 0 && iOpen < iOverview && /if \(openWithPhotos\) \{[\s\S]*?slideshow\(r, first\)/.test(play)
    && /arrive\(r, first, stayNo\(first\), !openWithPhotos\)/.test(play),
    'the first destination\'s pictures play before the map, and are not repeated when the map lands there');
  const iClose = play.indexOf('if (closeWithPhotos) {'), iEndMap = play.lastIndexOf('map.flyToBounds(all');
  assert(iClose > iEndMap && play.indexOf("'The end'") > iClose && /if \(closeWithPhotos\) \{[\s\S]*?slideshow\(r, last\)/.test(play),
    'the last destination\'s pictures play after the closing map, before "The end"');
  // "On the flyover when the last flight arrives at its destination, zoom the map out to show
  // the full route" (2026-10-24): the last leg lands with no zoom into its city.
  assert(/if \(b === last\) \{ showCard\(b\.label, stopSub\(b, stayNo\(b\)\)\); break; \}\s*if \(!\(await arrive\(r, b, stayNo\(b\), true\)\)\) return;/.test(play)
    && play.indexOf('if (b === last) {') < iEndMap && /if \(!last\) clearDestLabel\(\);\s*if \(!\(await untilMoveEnd\(r, \(\) => map\.flyToBounds\(all/.test(play),
    'the last leg skips arrive(): its card goes up and the map zooms straight out to the whole route, keeping its name');
  assert(!/detectRetina: true/.test(extractFn('tripsyFlyoverAddTiles')) && /zoomSnap: 1, zoomAnimation: false \}/.test(play),
    'tiles are fetched at the zoom shown (no retina offset, which left gaps) and only whole zoom levels are used');
  // "The entire screen does go to orange, but then the app immediately shows the zoomed out
  // map with the orange dot and zooms in on the dot a second time" (2026-10-21).
  assert(/zoomAnimation: false/.test(play), 'no separate CSS zoom animation that could spring the map back after an instant jump');
  // The screen recording (2026-10-21): the dot and route lines are CSS-scaled while the map
  // zooms in, so the dot filled the screen and then snapped back before the real burst.
  {
    const arr = play.slice(play.indexOf('const arrive = async'), play.indexOf('const play = async'));
    // "I want the map and orange dot to zoom together": paths are redrawn on every zoom frame
    // instead of being hidden (hiding made the dot appear after the map).
    assert(!/hideOverlays|showOverlays|overlayPane\.style\.visibility/.test(play), 'dots and routes are never hidden for a zoom');
    assert(/map\.on\('zoom', redrawPathsAtZoom\)/.test(play)
      && /const redrawPathsAtZoom = \(\) => \{[\s\S]*?rd\._update\(\);[\s\S]*?l\._project\(\); l\._update\(\);/.test(play),
      'every zoom frame re-projects and redraws the dots and route lines, so they ride the map at their own size');
    // "the destination orange dot should appear on the map when the map first appears"
    assert(/ensureDot\(first\);\s*ensureDot\(stops\[1\]\);/.test(play), 'the opening map shows the first destination\'s dot as well as the origin\'s');
    assert(/showDestLabel\(b\);\s*ensureDot\(a\);\s*ensureDot\(b\);/.test(play), 'each later destination\'s dot goes up with its name as its leg begins');
    assert(!/L\.circleMarker/.test(play) && /const dot = s => L\.marker\(\[s\.lat, s\.lng\], \{ icon: dotIcon\(14\)/.test(play)
      && /ensureDot\(v\)/.test(play),
      'destination and layover dots are divIcon markers (repositioned every zoom frame like the labels), never SVG circles');
    // "make the labels with the origin and destination larger when they appear on the map"
    const css = (html.match(/\.tfo-dest-label span \{[^}]*\}/) || [''])[0];
    const grownCss = (html.match(/\.tfo-dest-label\.tfo-grow span \{[^}]*\}/) || [''])[0];
    const sc = (html.match(/const TRIPSY_FLYOVER_DEST_LABEL_SCALE = \{ start: ([\d.]+), grown: ([\d.]+) \}/) || []);
    assert(/\.tfo-via-label span \{[^}]*font: 700 20px/.test(html) && !/\.tfo-dest-label span \{[^}]*font-size/.test(html) && sc[1] === '1' && sc[2] === '1' && new RegExp(`scale\\(${sc[1]}\\)`).test(css) && new RegExp(`scale\\(${sc[2]}\\)`).test(grownCss),
      'every name on the map (origin, destination, layover) is one 20px size that never grows, and the centring constants match the CSS');
    assert(/TRIPSY_FLYOVER_DEST_LABEL_SCALE\.start \* TRIPSY_FLYOVER_DEST_LABEL_SCALE\.grown/.test(play), 'the arrival zoom frames the GROWN name');
    assert(/const ensureDot = s => \{[\s\S]{0,120}if \(dotted\.has\(key\)\) return;/.test(play) && /ensureDot\(s\);\s*showDestLabel\(s\)/.test(arr)
      && /dotted = new Set\(\);/.test(play.slice(play.indexOf('const play = async'))), 'one dot per stop, never a second on arrival, reset on Replay');
  }
  const arriveSrc = play.slice(play.indexOf('const arrive = async'), play.indexOf('const play = async'));
  assert(arriveSrc.indexOf('firstPageLoads(r, s)') > -1 && /const \[grown, ready\] = await Promise\.all\(\[burst\.done, pagesReady\]\);[\s\S]*?if \(!ready\) \{[^}]*clearBurst\(\);/.test(arriveSrc),
    'the slideshow only follows the orange once a photo of that stop has loaded; otherwise the orange fades back to the map');
  // "for the first leg do not zoom. Start with the unzoomed map with labels for origin and destination"
  const playSrc = play.slice(play.indexOf('const play = async'));
  assert(/if \(stops\.length > 1\) \{\s*ensureDot\(first\);[\s\S]*?tfo-dest-label[\s\S]*?showDestLabel\(stops\[1\]\)/.test(playSrc),
    'the opening map carries the origin dot and both names');
  assert(/if \(stops\.length === 1 && !\(await arrive\(r, first/.test(playSrc), 'no zoom onto the origin when there is a leg to fly');
  assert(/if \(k > 1\) \{[\s\S]*?flyToBounds\(legBounds/.test(playSrc), 'the first leg is flown on the whole-route map, later legs are framed');
  assert(/keepLabelsInView\(/.test(playSrc), 'a name at the right edge is slid into view without changing zoom');
  assert(/showDestLabel\(s\);[\s\S]*?untilTilesLoaded\(r, 1500\)/.test(play),
    'arriving names the destination beside its dot and lets the tiles land before photos cover the map');
  const iLeg = play.indexOf('const legBounds'), iClear = play.indexOf('clearDestLabel();', iLeg);
  assert(iClear > iLeg && iClear < play.indexOf('map.flyToBounds(legBounds', iLeg)
    && /clearViaLabels\(\);\s*if \(!last\) clearDestLabel\(\);\s*if \(!\(await untilMoveEnd\(r, \(\) => map\.flyToBounds\(all/.test(play),
    'the destination name is taken away before the next leg pulls back out; the closing map keeps the LAST destination\'s name (its arrival IS that zoom-out, 2026-10-24)');
  assert(/\.tfo-dot \{ background: #111;/.test(html), 'location dots are black');
  assert(/const m = L\.marker\(\[v\.lat, v\.lng\], \{ icon: L\.divIcon\(\{ className: 'tfo-via-label tfo-dest-label'/.test(play),
    'a layover name is drawn exactly like every other name, to the right of its dot');
}
{
  eval(extractFn('tripsyFlyoverMergeLookupFields'));
  const current = { tripKey: 'a', music: { x: 1 }, stops: [
    { id: 's1', label: 'Narita', photos: [{ driveFileId: 'v', kind: 'video', audio: 'music' }] },
    { id: 's2', label: 'Mine', labelEdited: true, via: [{ label: 'old' }] } ] };
  const looked = { tripKey: 'a', layoversV: 2, stops: [
    { id: 's1', label: 'Tokyo', via: [{ label: 'Seoul' }], photos: [{ driveFileId: 'v', kind: 'video' }] },
    { id: 's2', label: 'Auto' } ] };
  const m = tripsyFlyoverMergeLookupFields(current, looked, ['via', 'label'], ['layoversV']);
  assert(m.stops[0].label === 'Tokyo' && m.stops[0].via[0].label === 'Seoul' && m.stops[0].photos[0].audio === 'music'
    && m.music && m.layoversV === 2,
    'a background lookup copies only its own fields onto the record as it is now — a video\'s sound choice survives');
  assert(m.stops[1].label === 'Mine' && !('via' in m.stops[1]), 'a typed name is kept; a layover the lookup no longer finds is dropped');
  const view = html.slice(html.indexOf('container.querySelectorAll("[data-tripsy-flyover]")'));
  assert(/layovers\.then\(r => \{ if \(r\.changed\) tripsyFlyoverMergeLookups\(/.test(view)
    && /tripsyFlyoverEnglishLabels\(record\)\.then\(r => \{ if \(r\.changed\) tripsyFlyoverMergeLookups\(/.test(view)
    && !/\.then\(r => \{ if \(r\.changed\) Store\.saveTripsyFlyover\(r\.record\)/.test(view.slice(0, 3000)),
    'View no longer writes the copy taken at the tap back over later changes');
}
{
  // Every photo in the same 4:3 frame (2026-10-21), showing the WHOLE picture letterboxed
  // rather than cropped to fill ("The full pictures are not showing up," 2026-10-22).
  const css = (html.match(/@supports \(width: 1cqw\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  assert(/\.tfo-group \{ container-type: size; \}/.test(css)
    && /\[data-layout="collage"\] img \{ aspect-ratio: 4 \/ 3;[^}]*object-fit: contain; background: #000;/.test(css),
    'every photo layout shares one 4:3 frame shape with the whole picture letterboxed inside it');
  assert(!/#tripsy-flyover-player \.tfo-group\[data-layout="[a-z]+"\] img \{[^}]*object-fit: cover/.test(html),
    'no photo layout crops a picture to fill its frame');
  // "the transition from collage photo pages to single photo pages is not smooth" (2026-10-22):
  // a collage's z-indexed photos painted above the next page until the old page was removed.
  assert(/#tripsy-flyover-player \.tfo-group \{ position: absolute; inset: 0;[^}]*isolation: isolate; overflow: hidden;/.test(html),
    'every page is its own stacking context and clips to its box, so the old page never shows through or past the one coming in');
  assert(['single', 'pair', 'grid', 'collage'].every(l => new RegExp(`\\[data-layout="${l}"\\] img \\{ width: min\\(`).test(css)),
    'each layout sizes its frames from the page box, never from the photo\'s own shape');
  assert(!/video/.test(css.replace(/Videos keep\s+their own shape/, '')), 'videos are left at their own shape');
}
{
  // Labels go up as the leg begins; layover labels go with their leg; the dot bursts into the
  // first photo page (2026-10-21).
  const play = extractFn('playTripsyFlyover');
  const iLeg = play.indexOf('const legBounds');
  const legPart = play.slice(iLeg, play.indexOf('map.flyToBounds(legBounds', iLeg));
  assert(/clearDestLabel\(\);\s*clearViaLabels\(\);[\s\S]*showDestLabel\(b\);/.test(legPart),
    'the destination name is placed before the leg to it is framed, and the last leg\'s names are cleared');
  assert(/viaLabels\.push\(L\.marker/.test(play) && !/layers\.push\(L\.marker\(\[v\.lat, v\.lng\], \{ icon: L\.divIcon\(\{ className: 'tfo-via-label/.test(play),
    'layover labels are tracked so they are removed when the leg ends, not left on the map');
  assert(/const keepLabelsInView = \(labelMarkers, dotStops\) => \{[\s\S]*?map\.panBy\(\[shift, 0\], \{ animate: false \}\);/.test(play)
    && /keepLabelsInView\(\[originLabel, destLabel, \.\.\.viaMarks1\], \[first, \.\.\.via1, stops\[1\]\]\);/.test(play)
    && /map\.fitBounds\(legBounds[^\n]*\n\s*keepLabelsInView\(\[fromLabel, destLabel, \.\.\.viaMarks\], \[a, \.\.\.via, b\]\);/.test(play),
    'every leg, not just the first, slides the map so both names stay inside the screen');
  assert(/viaLabels\.push\(L\.marker\(\[a\.lat, a\.lng\][^\n]*tfo-dest-label[^\n]*\n\s*const fromLabel = viaLabels\[viaLabels\.length - 1\];\s*showDestLabel\(b\);/.test(play),
    'each later leg names the city being left as well as the destination');
  assert(/showDestLabel\(b\);\s*ensureDot\(a\);\s*ensureDot\(b\);\s*const viaMarks = showLayovers\(via\);\s*if \(!\(await untilMoveEnd\(r, \(\) => map\.flyToBounds\(legBounds/.test(play),
    'both ends of every leg have their dot (and name) before the zoomed-out leg view appears');
  assert(/const zoom = burstWanted \? burstZoomFor\(s, z0\) : \(s\.kind === 'stay' \? 10 : 9\);\s*const center = burstWanted \? L\.latLng\(s\.lat, s\.lng\) : arrivalCenter\(s, zoom\);/.test(play)
    && /const burst = burstWanted \? startBurst\(r, s, z0\) : null;\s*if \(!\(await untilMoveEnd\(r, \(\) => map\.flyTo\(center, zoom, \{ duration \}\)/.test(play)
    && /const duration = burstWanted \? TRIPSY_FLYOVER_BURST_MS \/ 1000 : 1\.4;/.test(play),
    'with photos, the arrival zoom goes straight into the dot, deep enough to turn the screen black; without, it frames the dot and its name');
  assert(/return Math\.min\(Math\.ceil\(z0 \+ Math\.log2\(endD \/ 14\)\), map\.getMaxZoom\(\)\);/.test(play)
    && /if \(burst\) burst\.settle\(\);/.test(play),
    'the zoom goes deep enough for a 14 px dot scaled with the map to cover the screen, and a max-zoom shortfall is finished once the zoom ends');
  assert(/if \(!grown \|\| r\.cancelled\) return false;[\s\S]*?return slideshow\(r, s\);/.test(play)
    && (play.match(/if \(prev\) prev\.remove\(\);\s*clearBurst\(\);/g) || []).length === 2,
    'a destination with photos swells its dot to fill the screen, and the first page (photo or video) comes straight in over it');
  assert(/\.tfo-burst \{[^}]*background: #111/.test(html) && !/\.tfo-burst \{[^}]*transition/.test(html) && !/@keyframes tfo-burst/.test(html)
    && /const ring = TRIPSY_FLYOVER_BURST_RING_MAX;\s*const endD = 2 \* \(far \+ 2 \+ ring\);\s*let d = Math\.min\(endD, 14 \* Math\.pow\(2, Math\.max\(0, map\.getZoom\(\) - z0\)\)\);[\s\S]*?el\.style\.width = el\.style\.height = `\$\{d\}px`;[\s\S]*?el\.style\.borderWidth = `\$\{Math\.min\(d \/ 7, ring\)\}px`;/.test(play)
    && !/el\.style\.transform = `scale/.test(play.slice(play.indexOf('const startBurst'))) && /\.tfo-burst \{[^}]*border: 2px solid #fff/.test(html)
    && !/elapsed/.test(play.slice(play.indexOf('const startBurst'), play.indexOf('const burstZoomFor')))
    && /const pt = map\.latLngToContainerPoint\(\[s\.lat, s\.lng\]\);/.test(play.slice(play.indexOf('const startBurst'))),
    'the burst is the dot\'s own colour, its ring stops growing at the photos\' border thickness, and it grows with the map\'s LIVE zoom (no clock of its own), following the dot');
  assert(/if \(Math\.abs\(map\.getZoom\(\) - zoom\) > 0\.01\) \{[\s\S]{0,120}map\.setView\(center, zoom, \{ animate: false \}\)/.test(play)
    && /map\.fitBounds\(legBounds, \{ padding: \[80, 80\], maxZoom: 9, animate: false \}\)/.test(play),
    'the map is always at its final view before the burst, and before a vehicle starts moving');
  assert(/const ahead = path\[Math\.min\(path\.length - 1, i \+ 4\)\];[\s\S]*?map\.project\(cur, z\)[\s\S]*?heading \+= /.test(play)
    && !/latLngToLayerPoint\(p0\)/.test(play),
    'the plane\'s heading uses unrounded pixels a few steps ahead and turns smoothly');
}

// ---- The setup page's Play asks which map service to use (2026-10-22) ----
{
  const html2 = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
  const ok = (c, m) => { if (c) console.log('ok   ' + m); else { console.log('FAIL ' + m); process.exitCode = 1; } };
  const dlgStart = html2.indexOf('function tripsyFlyoverMapChoiceDialog(onPick)');
  const dlg = html2.slice(dlgStart, html2.indexOf('\n}\n', dlgStart));
  ok(dlgStart > -1 && /data-map-choice="\$\{value\}"/.test(dlg) && /choice\('free'/.test(dlg) && /choice\('google'/.test(dlg),
    'the map dialog offers the free map and Google (credits)');
  ok(/b\.onclick = \(\) => \{ close\(\); onPick\(b\.dataset\.mapChoice\); \};/.test(dlg) && !/await/.test(dlg),
    'a choice starts playback synchronously inside its own tap (no await), so iOS music can still start');
  ok(/data-map-choice-cancel\]'\)\.onclick = close;/.test(dlg), 'Cancel plays nothing');
  ok(/\[data-flyover-play\]'\)\.onclick = \(\) => \{[\s\S]*?tripsyFlyoverRangeDialog\(record, range => \{[\s\S]*?tripsyFlyoverMapChoiceDialog\(mapService => playTripsyFlyover\(trip, record, \{ mapService, /.test(html2),
    'the setup page\'s Play asks whole-or-part, then which map, before playing');
  ok(/const googleTilesP = opts\.mapService === 'free' \? Promise\.resolve\(null\) : Promise\.race\(\[/.test(html2),
    'the free map never asks Google for a tile session');
}
{
  const html3 = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
  const m = html3.match(/const TRIPSY_FLYOVER_BURST_RING_MAX = (\d+);/);
  const photo = html3.match(/#tripsy-flyover-player \.tfo-photo img \{[^}]*border: (\d+)px solid #fff/);
  if (m && photo && m[1] === photo[1]) console.log('ok   the burst ring stops at the photos\' own border thickness');
  else { console.log('FAIL the burst ring stops at the photos\' own border thickness'); process.exitCode = 1; }
}

// The plane stays on the map through a stopover ("When the plane on a flyover does a
// stopover, do not make the plane disappear from the map," 2026-10-22): one marker is
// carried across the journey's legs, removed only after the last.
{
  const pf = html.slice(html.indexOf('const animateLeg = (r, a, b, legMode, carry = null)'), html.indexOf('const stopSub = (s, i) =>'));
  assert(/let marker = carry && carry\.marker;\s*if \(marker\) marker\.setLatLng\(path\[0\]\);/.test(pf), 'a carried plane is moved to the next leg\'s start, not recreated');
  assert(/if \(carry && carry\.keep\) \{ carry\.marker = marker; carry\.heading = heading; \}\s*else \{ marker\.remove\(\);/.test(pf), 'a leg ending at a layover leaves the plane on the map');
  assert(/if \(carry\) layers\.push\(marker\);/.test(pf), 'a carried plane is cleared by Replay with the other layers');
  const loop = html.slice(html.indexOf('const carry = via.length ?'), html.indexOf('const carry = via.length ?') + 500);
  assert(/animateLeg\(r, from, v, 'plane', carry\)[\s\S]*if \(carry\) carry\.keep = false;[\s\S]*animateLeg\(r, from, b, via\.length \? 'plane' : '', carry\)/.test(loop),
    'every layover leg keeps the plane, and the final leg removes it');
}

// A page's photos are drawn inside one narrow border in the Slideshow options grid ("when
// multiple photos are on the same page draw a narrow border around all of the photos on that
// page so they are grouped together," 2026-10-22).
{
  eval(extractFn('tripsyFlyoverGridGroups'));
  const ph = ['A', 'B', 'C', 'D', 'E'].map(driveFileId => ({ driveFileId }));
  const where = new Map([['A', 0], ['B', 1], ['C', 1], ['D', 1]]);
  const g = tripsyFlyoverGridGroups(ph, where);
  assert(g.map(x => `${x.page}:${x.photos.map(p => p.driveFileId).join('')}`).join(' ') === '0:A 1:BCD null:E',
    'consecutive photos of one page form a run; a lone photo and an unplaced one stand alone');
  const g2 = tripsyFlyoverGridGroups([ph[4], ph[4]], new Map());
  assert(g2.length === 2 && g2.every(x => x.page === null), 'photos on no page never group together');
  const dlg = html.slice(html.indexOf('<div data-ss-grid'), html.indexOf('How should the ${page.count} photos appear?'));
  assert(/tripsyFlyoverGridGroups\(photos, where\)\.map\(g => g\.page != null && g\.photos\.length > 1\s*\? `<div data-ss-page-group="\$\{g\.page\}" style="[^"]*border:1px solid \$\{g\.page === cur \? '#3AA76D' : 'rgba\(255,255,255,0\.65\)'\}; border-radius:9px;">\$\{g\.photos\.map\(tile\)\.join\(''\)\}<\/div>`\s*: g\.photos\.map\(tile\)\.join\(''\)\)/.test(dlg),
    'the grid wraps a run of 2+ photos on one page in a bright bordered group, green for the page being edited');
  assert(/<div data-ss-page-group="\$\{g\.page\}" style="display:flex; gap:8px; flex-wrap:wrap; max-width:100%;/.test(dlg), 'a group wraps inside itself on a narrow screen');
}


// The Play dialog's third option: one destination's slideshow alone, picked from a drop-down
// ("Add a third option—just play the slideshow from a single location, and allow the user to
// select that location from a drop down menu," 2026-10-22).
{
  eval(extractFn('tripsyFlyoverSlideshowStops'));
  const st = [
    { id: 'o', kind: 'origin', photos: [] }, { id: 'a', kind: 'stay', photos: [{ driveFileId: 'x' }] },
    { id: 't', kind: 'transit', photos: [{ driveFileId: 'y' }] }, { id: 'b', kind: 'stay', removed: true, photos: [{ driveFileId: 'z' }] },
    { id: 'c', kind: 'stay' }, { id: 'r', kind: 'return', photos: [{ driveFileId: 'w' }] }];
  assert(tripsyFlyoverSlideshowStops(st).map(s => s.id).join('') === 'ar', 'only shown, non-transit stops with pictures are offered; empty or removed ones are not');
  assert(tripsyFlyoverSlideshowStops(null).length === 0, 'no stops, no options');
  const dlg = extractFn('tripsyFlyoverRangeDialog');
  assert(/const slideshowStops = tripsyFlyoverSlideshowStops\(stops\);/.test(dlg) && /\$\{slideshowStops\.length \? `[\s\S]*<select id="tripsy-flyover-range-one" class="field-input" data-range-one[\s\S]*data-range-one-play[\s\S]*` : ''\}/.test(dlg),
    'the dialog shows a Destination drop-down and Play this slideshow only when some destination has pictures');
  assert(/if \(onePlay\) onePlay\.onclick = \(\) => \{\s*const id = ov\.querySelector\('\[data-range-one\]'\)\.value;\s*if \(!slideshowStops\.some\(s => s\.id === id\)\) return;\s*close\(\); onPick\(\{ previewStopId: id \}\);/.test(dlg),
    'Play this slideshow hands the picked destination to onPick as previewStopId, synchronously in its tap');
}

// The slideshow editor has its own "＋ Add photos" ("Add an add photo button to the edit
// slideshow page," 2026-10-23): one shared add path with the card's button, and new photos
// placed on the page being edited, the rest on new pages at the end.
{
  eval(extractFn('tripsyFlyoverPlaceAddedPhotos'));
  const blank = () => ({ ids: [], count: 1, style: 'grid', transition: 'fade', seconds: 4 });
  const isV = id => id.startsWith('v');
  const base = [{ ids: ['a'], count: 3 }, { ids: ['b'], count: 1 }];
  const r = tripsyFlyoverPlaceAddedPhotos(base, 0, ['n1', 'n2', 'n3', 'v1', 'n4'], blank, isV);
  assert(r.pages.map(p => p.ids.join()).join('|') === 'a,n1,n2|b|n3|v1|n4',
    'THE ASK: added photos fill the page being edited up to its count; the rest each get a new page at the end, a video on its own -> ' + r.pages.map(p => p.ids.join()).join('|'));
  assert(base[0].ids.join() === 'a' && base.length === 2, 'pure: the input pages are untouched');
  assert(r.pages.slice(2).every(p => p.count === 1), 'each new page holds one');
  const v = tripsyFlyoverPlaceAddedPhotos([{ ids: ['v9'], count: 1 }], 0, ['n1'], blank, isV);
  assert(v.pages.map(p => p.ids.join()).join('|') === 'v9|n1', 'nothing joins a video page');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/page = null, addMedia = null \} = \{\}\) \{/.test(dlg), 'the dialog takes an addMedia callback');
  assert(/\$\{addMedia \? `<button class="btn" data-ss-add-photos[^`]*>＋ Add photos<\/button>` : ''\}/.test(dlg),
    'an ＋ Add photos button renders beside the grid\'s label (owner-only: the caller passes addMedia only to the owner)');
  assert(/if \(addBtn\) addBtn\.onclick = \(\) => \{ if \(adding\) return; tripsyFlyoverPickMedia\(async files => \{/.test(dlg),
    'the pick opens synchronously inside the tap (iOS), the adding happens in its callback');
  assert(/const r = await addMedia\(files, setStatus\);[\s\S]*photos\.push\(\{ \.\.\.rec \}\);[\s\S]*pages = tripsyFlyoverPlaceAddedPhotos\(pages, cur, recs\.map\(x => x\.driveFileId\), blank, isVideo\)\.pages;/.test(dlg),
    'added records join the draft and are placed on the page being edited');
  const setup = extractFn('showTripsyFlyover');
  assert(/const addMediaToStop = async \(id, files, setStatusFn\) => \{/.test(setup)
    && /if \(own\) own\.onclick = \(\) => tripsyFlyoverPickMedia\(async files => \{\s*const r = await addMediaToStop\(id, files, setStatus\);/.test(setup)
    && /addMedia: isOwner \? \(files, setStatusFn\) => addMediaToStop\(id, files, setStatusFn\) : null,/.test(setup),
    'ONE add path: the card\'s button and the editor\'s button both run addMediaToStop (stage + background upload for photos, foreground for videos)');
  assert(/return \{ added, done, queued, problems \};/.test(setup), 'addMediaToStop reports the records it added');
}
