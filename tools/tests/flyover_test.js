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
assert(/const TRIPSY_FLYOVER_UPLOAD_PARALLEL = 3/.test(html) && /tripsyFlyoverQueueUpload\(trip\.key, pendingId\)/.test(html) && /if \(b === 0 \|\| b \+ TRIPSY_FLYOVER_INTAKE_BATCH >= photoIdx\.length\) \{ if \(queued\) \{ save\(\); render\(\); \} \}/.test(html),
  'picked photos are staged with pending ids, rendered after the first batch and the last, and uploaded three at a time in the background');
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
assert(/tripsyFlyoverRangeDialog\(record, range =>/.test(html) && /const extra = !range \? \{\} : range\.previewStopId \? \{ previewStopId: range\.previewStopId \} : \{ range \};\s*tripsyFlyoverMapChoiceDialog\(mapService => playTripsyFlyover\(trip, record, \{ mapService, \.\.\.extra, \.\.\.playerHooks \}\)\)/.test(html),
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
  assert(/const pages = tripsyFlyoverPages\(s\);[\s\S]*const enter = tripsyFlyoverEnterTransitions\(s, pages\);[\s\S]*showPage\(r, pages\[k\], enter\[k\], s\)/.test(player), 'each destination plays its OWN pages');
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
  // "Change the name of the slideshow options button to edit slideshow" (2026-10-22); its place
  // beside the transport drop-down was superseded by the photo-buttons line (2026-10-25, below).
  assert(/>🎞 Edit slideshow<\/button>/.test(setup) && !/Slideshow options<\/button>/.test(setup), 'the slideshow button reads "Edit slideshow"');
  // "The third line should be three buttons: add photos, then edit photos, then edit slideshow.
  // Move these buttons from their other locations on the card" (2026-10-25).
  const pbM = /<div data-flyover-photo-buttons [^>]*>([\s\S]*?)<\/div>` : ''\}/.exec(setup);
  const pb = pbM ? pbM[1] : '';
  assert(pbM && pb.indexOf('data-flyover-add-own') >= 0 && pb.indexOf('data-flyover-add-own') < pb.indexOf('data-flyover-edit-photos') && pb.indexOf('data-flyover-edit-photos') < pb.indexOf('data-flyover-slideshow')
    && />＋ Add photos<\/button>/.test(pb), 'THE ASK: line 3 is Add photos, then Edit photos, then Edit slideshow');
  assert(['data-flyover-add-own', 'data-flyover-edit-photos', 'data-flyover-slideshow'].every(k => setup.split(k + ' style').length === 2),
    'THE ASK: each of the three buttons appears once on the card — moved, not copied');
  const ctl2 = (/<div data-flyover-controls [^>]*>([\s\S]*?)<\/div>/.exec(setup) || [])[1] || '';
  assert(!/data-flyover-slideshow/.test(ctl2) && setup.indexOf('data-flyover-controls') < setup.indexOf('data-flyover-photo-buttons') && setup.indexOf('data-flyover-photo-buttons') < setup.indexOf('data-flyover-thumb='),
    'line 2 no longer holds Edit slideshow, and the buttons line sits between line 2 and the page thumbnails');
  // "Remove the suggested photos button. Have a button that says edit photos. When the user hits
  // it, show a page with thumbnails of all photos for that destination. When the user selects
  // one, show a large image with the buttons keep and delete" (2026-10-25).
  assert(!/data-flyover-add-suggested|Suggested photos<\/button>/.test(setup), 'THE ASK: the destination card has no Suggested photos button');
  assert(/\$\{photos\.length \? `<button class="btn" data-flyover-edit-photos [^`]*>✏️ Edit photos<\/button>/.test(setup)
    && /editPhotos\.onclick = \(\) => tripsyFlyoverEditPhotosPage\(stop, photoHooks\);/.test(setup) && /const photoHooks = \{\s*onDelete: photoId => removePhotoFromRecord\(id, photoId\),/.test(setup),
    'THE ASK: an Edit photos button (when the stop has photos) opens the photos page, and its Delete takes the photo off through the ordinary remove-and-save path');
  const ep = extractFn('tripsyFlyoverEditPhotosPage');
  assert(/tripsyFlyoverPhotosInPageOrder\(stop\)/.test(ep) && /data-ep-photo/.test(ep) && /tripsyFlyoverThumbHtml\(photo, 132, 100/.test(ep) && /tripsyDiaryPaintPhotos\(ov\)/.test(ep),
    'THE ASK: the page shows a thumbnail of every photo on the destination, in play order');
  const rsp = (extractFn('tripsyFlyoverReviewStopPhoto') + extractFn('tripsyFlyoverReviewStopPhotoLoop'));
  assert(/tripsyFlyoverPhotoReviewDialog\(url, \{ label: [\s\S]*?removeLabel: '🗑 Delete', isVideo, moveTargets: targets, nav, exitButton: true, keepButton: false, stay: true \}\)/.test(rsp) && /if \(answer === 'remove' && onDelete\) \{[\s\S]*?saving = onDelete\(cur\);/.test(rsp)
    && /const res = await tripsyFlyoverReviewStopPhoto\(getStop, b\.getAttribute\('data-ep-photo'\), b\.getAttribute\('data-ep-page'\), \{ onDelete, onMove, moveTargets \}\);[\s\S]*?if \(res !== 'keep'\) render\(\);/.test(ep),
    'THE ASK: a tap shows it large with Keep and Delete; Delete removes it and the grid redraws from what is left');
  assert(/isVideo\s*\? `<video src="\$\{esc\(url\)\}" controls playsinline/.test(extractFn('tripsyFlyoverPhotoReviewDialog')), 'a video opens playable in the same large view');
  // "Change Music from here button to say 'Change Music'" (2026-10-25).
  assert(/data-flyover-stop-music [^>]*>🎵 Change Music<\/button>/.test(setup) && !/Music from here<\/button>|Change music here/.test(setup) && /data-flyover-stop-music-name/.test(setup),
    'THE ASK: the destination music button always reads "Change Music"; a destination\'s own track is named beside it');
  // "When photos are Imported they should say 'No page'" (2026-10-25): the card, the Edit
  // photos page, and every add path.
  assert(/\$\{tripsyFlyoverUnplacedPhotos\(s\)\.map\(ph => `[\s\S]*data-flyover-nopage="\$\{esc\(ph\.driveFileId\)\}"[\s\S]*tripsyFlyoverThumbHtml\(ph, 84, 64,[\s\S]*>No page<\/span>[\s\S]*data-flyover-nopage-remove/.test(setup)
    && /card\.querySelectorAll\('\[data-flyover-nopage\]'\)\.forEach\(t => t\.onclick = e => \{[\s\S]*?tripsyFlyoverReviewStopPhoto\(stop, t\.getAttribute\('data-flyover-nopage'\), 'No page', photoHooks\);/.test(setup)
    && /removePhotoFromRecord\(id, b\.getAttribute\('data-flyover-nopage-remove'\)\)\.catch/.test(setup),
    'THE ASK: every photo on No page shows on the card as its own thumbnail badged "No page" ("Show each photo on the flyover page even they are not on a page," 2026-10-25); a tap opens it large (Delete / Keep / Move), ✕ removes it');
  assert(/\{ \.\.\.s, \.\.\.tripsyFlyoverFreezePagesOnAdd\(s, fields\) \}/.test(setup) && (setup.match(/updateStop\((id|stopId), \{ photos: \[\.\.\.\(stopNow\(\)\.photos \|\| \[\]\), rec\] \}\)/g) || []).length === 3,
    'every add path (picker photos, picker videos, Drive import) goes through updateStop, which freezes a never-paged destination first');
  const ep2 = extractFn('tripsyFlyoverEditPhotosPage');
  assert(/\$\{page == null \? 'No page' : page\}<\/span>/.test(ep2), 'THE ASK: the Edit photos page badges an unplaced photo "No page"');
  // "When a user selects a photo from the edit photos page, add a button that says 'move' and
  // when the user selects it present a drop down menu with other locations from the trip to
  // move the photo to" (2026-10-25).
  const rv = extractFn('tripsyFlyoverPhotoReviewDialog');
  assert(/moveTargets && moveTargets\.length \?[\s\S]*data-review-move-select[\s\S]*moveTargets\.map\(t => `<option value="\$\{esc\(t\.id\)\}">\$\{esc\(t\.label\)\}<\/option>`\)[\s\S]*data-review-move-go[\s\S]*>↪ Move<\/button>/.test(rv)
    && /if \(to\) done\(\{ move: to \}\);/.test(rv), 'THE ASK: the large view has a Move button that shows a drop-down of the other destinations and resolves the one picked');
  assert(rv.indexOf('data-review-keep style') < rv.indexOf('data-review-move-pick') && rv.indexOf('data-review-move-pick') < rv.indexOf('data-review-move style') && rv.indexOf('data-review-remove style') < rv.indexOf('data-review-keep style'),
    'THE ASK: Move is the far-right button, after Delete and Keep ("Move the move button to the far right," 2026-10-25)');
  // "show carat on the middle left and middle right of the photo to allow the user to navigate
  // to the next photo or back to the last one. If the user selects a carat, treat that as a
  // keep photo press and a move to the next photo or previous photo" (2026-10-25).
  assert(/const caret = \(dir, on\) => on \? `<button data-review-\$\{dir\}[^`]*top:50%; \$\{dir === 'prev' \? 'left' : 'right'\}:12px; transform:translateY\(-50%\)/.test(rv) && /\$\{nav \? caret\('prev', nav\.hasPrev\) \+ caret\('next', nav\.hasNext\) : ''\}/.test(rv)
    && /if \(prevBtn\) prevBtn\.onclick = e => \{ e\.stopPropagation\(\); done\('prev'\); \};/.test(rv) && /e\.key === 'ArrowRight' && nav\.hasNext/.test(rv),
    'THE ASK: the large view has ‹ and › at the middle left and right (and the arrow keys), shown only where there is a photo to go to');
  const rsp2 = (extractFn('tripsyFlyoverReviewStopPhoto') + extractFn('tripsyFlyoverReviewStopPhotoLoop'));
  assert(/const seq = tripsyFlyoverPhotosInPageOrder\(stop\);/.test(rsp2) && /const nav = k >= 0 \? \{ hasPrev: k > 0, hasNext: k < seq\.length - 1 \} : null;/.test(rsp2)
    && /if \(answer === 'prev' && k > 0\) \{ cur = seq\[k - 1\]\.photo\.driveFileId; continue; \}/.test(rsp2) && /if \(answer === 'next' && k >= 0 && k < seq\.length - 1\) \{ cur = seq\[k \+ 1\]\.photo\.driveFileId; continue; \}/.test(rsp2),
    'THE ASK: a caret is a Keep plus a step to the next / previous photo of the destination, in play order — nothing changes until Delete or Move');
  // "When the user presses delete in the photo edit view, delete that photo and move to the
  // next photo for that location if there is one. If not, go back to the flyover page also add a
  // button to the photo edit view to the right of move called exit that returns to the flyover
  // view" (2026-10-25).
  assert(rv.indexOf('data-review-move style') < rv.indexOf('data-review-exit') && /exitButton \? `<button class="btn" data-review-exit[^`]*>Exit<\/button>` : ''/.test(rv) && /if \(exitBtn\) exitBtn\.onclick = e => \{ e\.stopPropagation\(\); done\('exit'\); \};/.test(rv),
    'THE ASK: an Exit button sits to the right of Move and resolves exit');
  const rsp3 = (extractFn('tripsyFlyoverReviewStopPhoto') + extractFn('tripsyFlyoverReviewStopPhotoLoop'));
  assert(/const nextId = k >= 0 && k < seq\.length - 1 \? seq\[k \+ 1\]\.photo\.driveFileId : null;[\s\S]*?try \{ saving = onDelete\(cur\); \}[\s\S]*?\.catch\([^\n]*\n\s*deletedAny = true;\s*if \(!nextId\) return 'exit';\s*cur = nextId;\s*continue;/.test(rsp3)
    && /if \(answer === 'exit'\) return 'exit';/.test(rsp3) && /return deletedAny \? 'deleted' : 'keep';/.test(rsp3),
    'THE ASK: Delete goes on to the next photo, and with none after it back to the fly-over page; a later Keep still reports the delete so the grid redraws');
  // "When I press delete the view goes back to the flyover page briefly … Immediately go to the
  // next photo when I hit delete" (2026-10-25): one overlay for the whole review, the save not awaited.
  assert(/if \(!stay\) ov\.remove\(\);/.test(rv) && /finally \{ tripsyFlyoverCloseReviewOverlay\(\); \}/.test(extractFn('tripsyFlyoverReviewStopPhoto'))
    && !/await onDelete/.test(rsp3) && /const saving|let saving; try \{ saving = onDelete\(cur\); \}/.test(rsp3),
    'THE ASK: Delete keeps the review overlay up and does not wait on the Drive save before the next photo; the overlay is closed on every exit');
  assert(/if \(res === 'exit'\) \{ close\(\); return; \}/.test(extractFn('tripsyFlyoverEditPhotosPage')), 'THE ASK: from Edit photos, Exit (or deleting the last photo) closes the photos page too, back to the fly-over page');
  // "Remove the keep button" (2026-10-25): gone from the photo edit view, kept in the player.
  assert(/\$\{keepButton \? `<button class="btn primary" data-review-keep[^`]*>✓ Keep<\/button>` : ''\}/.test(rv) && /if \(keepBtn\) keepBtn\.onclick/.test(rv)
    && /keepButton: false, stay: true \}\);/.test((extractFn('tripsyFlyoverReviewStopPhoto') + extractFn('tripsyFlyoverReviewStopPhotoLoop'))) && !/keepButton/.test((html.match(/const ans = await tripsyFlyoverPhotoReviewDialog\(url, \{[^}]*\}\);/) || [''])[0]),
    'THE ASK: the photo edit view has no Keep button; the player\'s own view still does');
  assert(!/exitButton/.test((html.match(/const ans = await tripsyFlyoverPhotoReviewDialog\(url, \{[^}]*\}\);/) || [''])[0]), 'the player\'s own review gets no Exit');
  assert(!/moveTargets/.test((html.match(/const ans = await tripsyFlyoverPhotoReviewDialog\(url, \{[^}]*\}\);/) || [''])[0]), 'the player\'s own Keep / Remove view gets no Move');
  const ep3 = extractFn('tripsyFlyoverEditPhotosPage');
  assert(/moveTargets: targets, nav, exitButton: true, keepButton: false, stay: true \}\);/.test((extractFn('tripsyFlyoverReviewStopPhoto') + extractFn('tripsyFlyoverReviewStopPhotoLoop'))) && /if \(answer && answer\.move && onMove\) \{[\s\S]*await onMove\(cur, answer\.move\);[\s\S]*No page there/.test((extractFn('tripsyFlyoverReviewStopPhoto') + extractFn('tripsyFlyoverReviewStopPhotoLoop'))) && /tripsyFlyoverReviewStopPhoto\(/.test(ep3), 'Edit photos passes the targets and moves the photo, saying where it went');
  assert(/onMove: \(photoId, toId\) => movePhotoInRecord\(id, photoId, toId\),\s*moveTargets: \(\) => photoMoveTargets\(id\),/.test(setup)
    && /filter\(s => s\.id !== fromId && !s\.removed && s\.kind !== 'transit'\)/.test(setup)
    && /updateStop\(toId, \{ photos: \[\.\.\.\(to\.photos \|\| \[\]\)\.filter\(p => p\.driveFileId !== photoId\), rec\] \}\);/.test(setup),
    'THE ASK: the drop-down lists every OTHER shown destination (no airport transfers), and the move puts the same photo record on the target\'s photos — on No page, through updateStop');
  // "For each location box on the flyover page, make the first line the location, the dates
  // there, and the lodging in large type. The second line should be the drop down box with the
  // type of transportation and the editable name of the destination, the music option box and
  // the remove box (change name to delete destination)" (2026-10-25).
  const headM = /<div data-flyover-headline style="([^"]*)">([\s\S]*?)<\/div>\s*<!-- Line 2/.exec(setup);
  assert(headM && /font-size:18px/.test(headM[1]) && /<strong style="font-size:20px;">\$\{esc\(s\.label \|\| 'Location'\)\}<\/strong>/.test(headM[2]) && /tripsyFlyoverDatesLabel\(s\)/.test(headM[2]) && /s\.names\.join\(' · '\)/.test(headM[2]),
    'THE ASK: line 1 is the location, its dates and its lodging, in large type');
  assert(headM && headM[2].indexOf("s.names.join(' · ')") < headM[2].indexOf('tripsyFlyoverDatesLabel(s)') && headM[2].indexOf("esc(s.label || 'Location')") < headM[2].indexOf("s.names.join(' · ')"),
    'THE ASK: the title reads location, then lodging, then dates ("Swap the location of the date and lodging in the card title," 2026-10-25)');
  const ctlM = /<div data-flyover-controls [^>]*>([\s\S]*?)<\/div>\s*\$\{noPlace && !s\.removed/.exec(setup);
  const ctl = ctlM ? ctlM[1] : '';
  const at = k => ctl.indexOf(k);
  assert(ctlM && at('${legHtml}') >= 0 && at('${legHtml}') < at('data-flyover-label') && at('data-flyover-label') < at('data-flyover-stop-music') && at('data-flyover-stop-music') < at('data-flyover-remove'),
    'THE ASK: line 2 is the transport drop-down, the editable name, the music button and the delete button, in that order');
  assert(/data-flyover-remove [^>]*>Delete destination<\/button>/.test(ctl) && !/data-flyover-remove [^>]*>Remove<\/button>/.test(ctl), 'THE ASK: the destination\'s Remove button reads "Delete destination"');
  assert(!/data-flyover-label[\s\S]{0,400}<strong style="flex:1/.test(ctl) && !/margin-top:6px; font-size:12px; color:var\(--muted\);">\s*<span>🎵/.test(setup), 'the name is not repeated on line 2 for a viewer, and the old separate music row is gone');
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
  extractFn('tripsyFlyoverDialogPages'), extractFn('tripsyFlyoverTogglePagePhoto'), extractFn('tripsyFlyoverSlideshowSummary'), extractFn('tripsyFlyoverUnplacedPhotos'), extractFn('tripsyFlyoverFreezePagesOnAdd')].join('\n'));
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
  assert(pg.map(x => x.ids.join(',')).join('|') === 'q2,q1|q3,q4,q5',
    'THE ASK: each page plays the photos chosen for it, in order; a photo is on one page only; a removed photo drops off; one on NO page does not play -> ' + pg.map(x => x.ids.join(',')).join('|'));
  assert(pg[0].layout === 'pair' && pg[1].layout === 'collage',
    'how many are on a page decides how it is drawn');
  // ---- "Do not place photos on a page unless a user places it there. When photos are
  // Imported they should say 'No page'" (2026-10-25) ----
  assert(tripsyFlyoverUnplacedPhotos(stop).map(p => p.driveFileId).join() === 'q6', 'THE ASK: a photo on none of the saved pages is No page');
  const neverPaged = tripsyFlyoverPages({ photos: [{ driveFileId: 'seed' }] });
  assert(neverPaged.length === 1 && neverPaged[0].ids.join() === 'seed' && neverPaged[0].auto, 'a destination that has never had pages still plays its one default photo');
  assert(tripsyFlyoverPages({ photos: [{ driveFileId: 'a' }], pages: [] }).length === 0 && tripsyFlyoverUnplacedPhotos({ photos: [{ driveFileId: 'a' }], pages: [] }).length === 1,
    'once a destination has pages (even none left), imports are No page and nothing plays on its own');
  const seedStop = { photos: [{ driveFileId: 'seed' }] };
  const frozen = tripsyFlyoverFreezePagesOnAdd(seedStop, { photos: [{ driveFileId: 'seed' }, { driveFileId: 'new1' }] });
  assert(Array.isArray(frozen.pages) && frozen.pages.length === 1 && frozen.pages[0].ids.join() === 'seed'
    && tripsyFlyoverUnplacedPhotos({ ...seedStop, ...frozen }).map(p => p.driveFileId).join() === 'new1',
    'THE ASK: importing into a never-paged destination keeps its default photo on its page and puts the import on No page');
  assert(tripsyFlyoverFreezePagesOnAdd(seedStop, { photos: [] }).pages === undefined && tripsyFlyoverFreezePagesOnAdd(stop, { photos: [...Q, { driveFileId: 'z' }] }).pages === undefined
    && tripsyFlyoverFreezePagesOnAdd(seedStop, { photos: [{ driveFileId: 'x' }], pages: [] }).pages.length === 0,
    'a removal, a destination that already has pages, and a caller passing its own pages are left alone');
  assert(pg[0].seconds === 5 && pg[1].seconds === 2, 'each page has its own time on screen');
  assert(tripsyFlyoverEnterTransitions(stop, pg).join(',') === 'fade,zoom',
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
  assert(!/tripsyFlyoverSuggestedPhotos\(/.test(setup), 'the suggested-photos grid is no longer offered on the card (Edit photos replaced it, 2026-10-25)');
  assert(/close = \(\) => \{[^}]*if \(onClosed\) onClosed\(added\);/.test(extractFn('tripsyFlyoverSuggestedPhotos')), 'the suggestions grid reports how many it added');
}

// ---- music by genre ----
eval([(html.match(/const TRIPSY_FLYOVER_MUSIC_GENRES = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '),
  (html.match(/const TRIPSY_FLYOVER_MUSIC_SPOKEN_WORDS = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '),
  (html.match(/const TRIPSY_FLYOVER_MUSIC_SPOKEN_PHRASES = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '),
  constLine('TRIPSY_FLYOVER_MUSIC_PREVIEW_SECONDS').replace(/^const /, 'var '), extractFn('tripsyFlyoverMusicPreviewStart'),
  extractFn('tripsyFlyoverMusicLooksSpoken'),
  extractFn('tripsyFlyoverMusicSearchUrl'), extractFn('tripsyFlyoverParseLength'), extractFn('tripsyFlyoverPickArchiveTrack'),
  extractFn('tripsyFlyoverLicenseLabel'), extractFn('tripsyFlyoverMusicLabel'),
  (html.match(/const TRIPSY_FLYOVER_MUSIC_GROUPS = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '), extractFn('tripsyFlyoverMusicIsRegional')].join('\n'));
{
  assert(TRIPSY_FLYOVER_MUSIC_GENRES.length >= 6 && new Set(TRIPSY_FLYOVER_MUSIC_GENRES.map(g => g.key)).size === TRIPSY_FLYOVER_MUSIC_GENRES.length,
    'THE ASK: music is offered across several genres');
  const regions = TRIPSY_FLYOVER_MUSIC_GENRES.filter(g => tripsyFlyoverMusicIsRegional(g)).map(g => g.key);
  assert(['westafrican', 'northafrican', 'arabic', 'persianturkish', 'indian', 'chinese', 'japanese', 'korean', 'southeastasian',
    'brazilian', 'andean', 'mexican', 'cuban', 'tango', 'caribbean', 'spanish', 'greek', 'balkan', 'nordic', 'celtic'].every(k => regions.includes(k))
    && regions.length >= 25,
    'THE ASK: many regional options -- ' + regions.length + ': ' + regions.join(','));
  // "Find more music options. For example, within Asian music there can be Japanese
  // traditional, Japanese folk, Chinese traditional, Chinese folk, southeast Asian traditional,
  // southeast Asian folk, etc." (2026-10-24): each place splits into traditional and folk
  // (and a popular style where one exists), grouped under region FAMILIES.
  {
    const byKey = Object.fromEntries(TRIPSY_FLYOVER_MUSIC_GENRES.map(g => [g.key, g]));
    const pairs = [['japanesetrad', 'japanesefolk'], ['chinesetrad', 'chinesefolk'], ['southeastasiantrad', 'southeastasianfolk'], ['koreantrad', 'koreanfolk'],
      ['indianclassical', 'indianfolk'], ['arabicclassical', 'arabicfolk'], ['hawaiiantrad', 'polynesian'], ['cubantrad', 'brazilianfolk'], ['irishtrad', 'italianfolk']];
    assert(pairs.every(([t, f]) => byKey[t] && byKey[f] && byKey[t].terms !== byKey[f].terms), 'THE ASK: traditional and folk are separate options with their own search words');
    assert(/traditional/.test(byKey.japanesetrad.terms) && /folk/.test(byKey.japanesefolk.terms) && /traditional/.test(byKey.chinesetrad.terms) && /folk/.test(byKey.chinesefolk.terms)
      && /traditional/.test(byKey.southeastasiantrad.terms) && /folk/.test(byKey.southeastasianfolk.terms), 'the Asian examples search for traditional vs folk');
    assert(['japanesetrad', 'japanesefolk', 'chinesetrad', 'chinesefolk', 'southeastasiantrad', 'southeastasianfolk', 'enkajpop', 'kpop', 'thai', 'vietnamese', 'indonesian', 'filipino', 'centralasian', 'himalayan']
      .every(k => byKey[k] && byKey[k].group === 'asia'), 'the Asian options sit in the Asia family');
    assert(regions.length >= 90, 'many more regional options now: ' + regions.length);
    const groupKeys = TRIPSY_FLYOVER_MUSIC_GROUPS.map(g => g.key);
    assert(TRIPSY_FLYOVER_MUSIC_GENRES.every(g => groupKeys.includes(g.group)) && groupKeys.every(k => TRIPSY_FLYOVER_MUSIC_GENRES.some(g => g.group === k)),
      'every option belongs to a listed row and no row is empty');
    assert(['africa', 'mideast', 'asia', 'oceania', 'latin', 'europe', 'northam'].every(k => groupKeys.includes(k)) && groupKeys[0] === 'style', 'the rows are Styles then the seven region families');
    for (const g of TRIPSY_FLYOVER_MUSIC_GENRES) {
      let depth = 0, ok = true, inQuote = false;
      for (const ch of g.terms) { if (ch === '"') inQuote = !inQuote; else if (!inQuote) { if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth < 0) ok = false; } } }
      assert(ok && depth === 0 && !inQuote, 'search words are balanced Lucene: ' + g.key);
    }
    assert(TRIPSY_FLYOVER_MUSIC_GENRES.filter(g => tripsyFlyoverMusicIsRegional(g)).every(g => g.label.trim().length > 2), 'every option is labelled');
    assert(!tripsyFlyoverMusicIsRegional(byKey.jazz) && tripsyFlyoverMusicIsRegional(byKey.japanesefolk), 'a style is not regional; a place is');
  }
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
  assert(TRIPSY_FLYOVER_MUSIC_GENRES.every(g => g.group === 'style' || tripsyFlyoverMusicIsRegional(g)), 'every genre is a style or a region');
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
    'the picker shows one row per group');
  assert(/key: 'style'[^}]*Styles[\s\S]*key: 'asia'[^}]*Asia[\s\S]*key: 'europe'[^}]*Europe/.test(html), 'the rows are labelled Styles, Asia, Europe…');
  assert(/<details data-mu-family="\$\{gr\.key\}"\$\{holdsPick \|\| openFamilies\.has\(gr\.key\) \? ' open' : ''\}/.test(muPicker) && /if \(gr\.key === 'style'\) return/.test(muPicker)
    && /addEventListener\('toggle'/.test(muPicker), 'each region family folds; Styles stay in view; a family stays open while it holds the pick or was unfolded');
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
  assert(player.indexOf('let audio = musicPlan.any ? new Audio() : null;') > 0 && player.indexOf('let audio = musicPlan.any ? new Audio() : null;') < firstAwait
    && player.indexOf('if (audio && musicPlan.start) loadMusic(musicPlan.start, true);') > 0 && player.indexOf('if (audio && musicPlan.start) loadMusic(musicPlan.start, true);') < firstAwait,
    'music starts before the first await, inside the Play tap (iOS only allows that)');
  // ---- music per destination ("Add the ability to change music at different parts of the
  // journey. At each destination have an option to change the music. Try to have music options
  // available for each destination on the journey - for example, music from Singapore. When you
  // change the music, have the music fade in and out so there is no disruption in the music,"
  // 2026-10-24) ----
  eval([extractFn('tripsyFlyoverMusicAtStop'), extractFn('tripsyFlyoverMusicTracks'), extractFn('tripsyFlyoverMusicFamilyAt'), extractFn('tripsyFlyoverMusicSuggest'),
    (html.match(/const TRIPSY_FLYOVER_MUSIC_PLACE_HINTS = \[[\s\S]*?\n\];/) || [''])[0].replace(/^const /, 'var '),
    (html.match(/const TRIPSY_FLYOVER_MUSIC_FAMILY_DEFAULTS = \{[\s\S]*?\n\};/) || [''])[0].replace(/^const /, 'var ')].join('\n'));
  {
    const rec = { music: { source: 'archive', url: 'u0' } };
    const st = [{ id: 'o', kind: 'origin' }, { id: 's1', kind: 'stay', music: { source: 'archive', url: 'u1' } }, { id: 't', kind: 'transit', music: { url: 'uX' } },
      { id: 's2', kind: 'stay' }, { id: 's3', kind: 'stay', removed: true, music: { url: 'uR' } }, { id: 's4', kind: 'stay', music: { source: 'drive', driveFileId: 'd4' } }];
    assert(tripsyFlyoverMusicAtStop(rec, st, 0).url === 'u0' && tripsyFlyoverMusicAtStop(rec, st, 1).url === 'u1' && tripsyFlyoverMusicAtStop(rec, st, 3).url === 'u1'
      && tripsyFlyoverMusicAtStop(rec, st, 4).url === 'u1' && tripsyFlyoverMusicAtStop(rec, st, 5).driveFileId === 'd4',
      'THE ASK: a destination\'s music plays from its arrival until a later destination with music of its own; a transfer or removed stop never changes it');
    assert(tripsyFlyoverMusicAtStop({}, st, 0) === null && tripsyFlyoverMusicAtStop({}, st, 3).url === 'u1', 'no fly-over music: silence until the first destination with music');
    assert(tripsyFlyoverMusicTracks(rec, st).map(m => m.url || m.driveFileId).join(',') === 'u0,u1,d4', 'the distinct tracks, opening first, for prefetching');
    const sg = tripsyFlyoverMusicSuggest({ label: 'Singapore', lat: 1.35, lng: 103.8 });
    assert(sg[0] === 'southeastasian' && sg.includes('southeastasiantrad') && sg.includes('southeastasianfolk'), 'THE ASK: music from Singapore is suggested for a Singapore stop: ' + sg.join(','));
    assert(tripsyFlyoverMusicSuggest({ label: 'Beppu', airport: 'FUK' })[0] === 'japanese' && tripsyFlyoverMusicSuggest({ label: 'Seoul', query: 'ICN airport' })[0] === 'korean'
      && tripsyFlyoverMusicSuggest({ label: 'Los Angeles' }).length > 0, 'places on the live trips get their own region (and a known airport its city)');
    assert(tripsyFlyoverMusicSuggest({ label: 'Nowhere Town', lat: 48.5, lng: 2.3 })[0] === 'classical' && tripsyFlyoverMusicSuggest({ label: 'Xyz', lat: 13.7, lng: 100.5 })[0] === 'southeastasian'
      && tripsyFlyoverMusicSuggest({ label: 'Xyz', lat: 40.7, lng: -74 })[0] === 'americana', 'an unknown name falls back to the part of the world its coordinates are in');
    assert(tripsyFlyoverMusicFamilyAt(21.3, -157.8) === 'oceania' && tripsyFlyoverMusicFamilyAt(-33.9, 151.2) === 'oceania' && tripsyFlyoverMusicFamilyAt(25.2, 55.3) === 'mideast'
      && tripsyFlyoverMusicFamilyAt(-23.5, -46.6) === 'latin' && tripsyFlyoverMusicFamilyAt(-1.3, 36.8) === 'africa' && tripsyFlyoverMusicFamilyAt(NaN, 1) === '', 'the family boxes: Hawaii, Sydney, Dubai, São Paulo, Nairobi');
    assert(tripsyFlyoverMusicSuggest({ label: 'Singapore' }).every(k => TRIPSY_FLYOVER_MUSIC_GENRES.some(g => g.key === k))
      && TRIPSY_FLYOVER_MUSIC_PLACE_HINTS.every(([re, ks]) => ks.every(k => TRIPSY_FLYOVER_MUSIC_GENRES.some(g => g.key === k)))
      && Object.values(TRIPSY_FLYOVER_MUSIC_FAMILY_DEFAULTS).every(ks => ks.every(k => TRIPSY_FLYOVER_MUSIC_GENRES.some(g => g.key === k))), 'every hinted key is a real genre');
    assert(/Music from \$\{esc\(opts\.place\)\} onward/.test(picker) && /data-mu-group="suggested"/.test(picker) && /Use the fly-over music/.test(picker)
      && /openFamilies\.add\(suggested\[0\]\.group\)/.test(picker), 'the picker names the place, leads with its suggested genres (family unfolded) and can hand back to the fly-over music');
    const setup = extractFn('showTripsyFlyover');
    assert(/data-flyover-stop-music/.test(setup) && /tripsyFlyoverMusicPicker\(st\.music \|\| null, \{ place: st\.label[^}]*suggested: tripsyFlyoverMusicSuggest\(st\), stopMode: true \}\)/.test(setup)
      && /updateStop\(id, \{ music: m \}\)/.test(setup) && /updateStop\(id, \{ music: undefined \}\)/.test(setup), 'THE ASK: every destination card has a Music-from-here button; a pick is saved on that stop, Use the fly-over music clears it');
    assert(/tripsyFlyoverMusicTracks\(record, record\.stops\)\) tripsyFlyoverPrefetchMusic\(m\)/.test(setup), 'every track of the journey is prefetched when the setup page opens');
    assert(/music: \{ \.\.\.p\.music \}/.test(extractFn('tripsyFlyoverCarryOver')), 'a destination\'s music survives a rebuild');
    assert(/switchMusic\(musicFor\(b\)\);/.test(player) && player.indexOf('switchMusic(musicFor(b));') > player.indexOf("if (b.kind === 'transit')") && player.indexOf('switchMusic(musicFor(b));') < player.indexOf('if (b === last)'),
      'THE ASK: arriving at a destination switches to its music (after a transfer is passed through, before the last stop\'s landing)');
    assert(/const next = new Audio\(\);/.test(player) && /nf\.to\(1, TRIPSY_FLYOVER_MUSIC_CROSSFADE_MS\);/.test(player) && /prevFader\.to\(0, TRIPSY_FLYOVER_MUSIC_CROSSFADE_MS\)/.test(player)
      && /retiring\.push\(prevAudio\)/.test(player) && /const TRIPSY_FLYOVER_MUSIC_CROSSFADE_MS = 3000;/.test(html),
      'THE ASK: the new track fades in on a second element while the old fades out -- an overlap, never a gap');
    assert(/if \(!canPlayNow \|\| prevAudio\.paused \|\| !prevAudio\.src \|\| !prevFader\.canFade\) \{ single\(\); return; \}/.test(player) && /catch \(e\) \{ ok = false; \}/.test(player),
      'where volume can\'t be ramped (iOS), or a second element is refused, the one element switches source instead');
    assert(/sameTrack\(m, musicNow\)\) return;/.test(player), 'arriving where the same track is already in force changes nothing');
    assert(/const resetMusic = \(\) => \{/.test(player) && /resetMusic\(\);\n\s*play\(run\);/.test(player), 'Replay returns to the opening track');
    assert(/const stopMusic = \(\) => \{ musicEnded = true; stopRetiring\(\);/.test(player), 'closing stops a track still fading out too');
    assert(/musicPlan\.any \? `<button class="tfo-btn" data-tfo-music/.test(player), 'the music button shows when any destination has music, even with no opening track');
  }
  // ---- Keep / Remove review of a photo in the player, and photos sorted into destinations by
  // date and place (both 2026-10-25) ----
  eval([extractFn('tripsyFlyoverRemovePhotoFromStop'), extractFn('tripsyFlyoverRemovePhoto'), extractFn('tripsyReadJpegExif'), extractFn('tripsyFlyoverRoutePhoto'),
    extractFn('tripsyFlyoverDistanceKm'), constLine('TRIPSY_FLYOVER_ROUTE_GPS_KM').replace(/^const /, 'var ')].join('\n'));
  {
    const stop = { id: 's', photos: [{ driveFileId: 'a' }, { driveFileId: 'b' }, { driveFileId: 'c' }], pages: [{ ids: ['a'], count: 1 }, { ids: ['b', 'c'], count: 2 }] };
    const r1 = tripsyFlyoverRemovePhotoFromStop(stop, 'a');
    assert(r1.photos.map(p => p.driveFileId).join() === 'b,c' && r1.pages.length === 1 && r1.pages[0].ids.join() === 'b,c' && stop.photos.length === 3,
      'THE ASK: Remove takes the photo off the destination and its pages (an emptied page goes); the source is untouched');
    const rec = tripsyFlyoverRemovePhoto({ stops: [stop, { id: 't', photos: [{ driveFileId: 'a' }] }] }, 's', 'b');
    assert(rec.stops[0].photos.length === 2 && rec.stops[0].pages[1].ids.join() === 'c' && rec.stops[1].photos.length === 1, 'only the named stop changes');
    assert(/function tripsyFlyoverPhotoReviewDialog\(url, \{ label = '', removeLabel = '🗑 Remove', isVideo = false, moveTargets = null, nav = null, exitButton = false, keepButton = true, stay = false \} = \{\}\)/.test(html) && /data-review-remove/.test(html) && /data-review-keep/.test(html)
      && /object-fit:contain/.test(extractFn('tripsyFlyoverPhotoReviewDialog')), 'THE ASK: the enlarged photo fills the screen with Keep and Remove');
    // .tfo-photo is pointer-events:none (the map takes drags), so the tappable image opts back in.
    assert(/\.tfo-photo \{[^}]*pointer-events: none/.test(html) && /img\.style\.pointerEvents = 'auto';\s*img\.setAttribute\('data-tfo-review'/.test(extractFn('playTripsyFlyover')),
      'a reviewable photo takes the tap itself (the photo layer is click-through for the map)');
    const player = extractFn('playTripsyFlyover');
    assert(/img\.onclick = ev => \{ ev\.stopPropagation\(\); reviewPhoto\(r, s, ids\[i\], img, u\); \};/.test(player) && /if \(typeof isOwner !== 'undefined' && isOwner && s && opts\.onRemovePhoto !== false\)/.test(player),
      'THE ASK: tapping a photo while the fly-over plays opens the review (owner only)');
    assert(/if \(!wasPaused\) togglePause\(\);/.test(player) && /if \(!wasPaused && r\.paused && !r\.cancelled\) togglePause\(\);/.test(player), 'the run pauses for the review and resumes after');
    assert(/removedIds\.add\(id\);/.test(player) && /if \(removedIds\.has\(id\)\) continue;/.test(player) && /tripsyFlyoverRemovePhotoFromStop\(st, id\)/.test(player)
      && /opts\.onRemovePhoto\(s\.id, id\)/.test(player) && /Store\.saveTripsyFlyover\(tripsyFlyoverRemovePhoto\(rec, s\.id, id\)\)/.test(player),
      'a removed photo is taken off the destination (the caller\'s way, else the saved record) and never shown again this run');
    const setup = extractFn('showTripsyFlyover');
    assert(/onRemovePhoto: removePhotoFromRecord/.test(setup) && /onRemovePhoto: async \(sid, pid\) => \{ await removePhotoFromRecord\(sid, pid\); if \(onDropped\) onDropped\(pid\); \}/.test(setup),
      'both Preview buttons on the setup page save the removal to the live record; the dialog\'s preview drops it from the draft too');
    assert(/playPreview\(draft\(\), dropPhoto, setAudio\)/.test(extractFn('tripsyFlyoverSlideshowDialog')), 'the slideshow dialog hands its draft-drop and draft-sound setters to the preview');
    // EXIF: a hand-built little-endian JPEG APP1 with DateTimeOriginal and a GPS position.
    const exifBuf = () => {
      const bytes = [];
      const u8 = v => bytes.push(v & 255), u16 = v => { u8(v); u8(v >> 8); }, u32 = v => { u16(v & 0xFFFF); u16(v >>> 16); };
      const str = s => { for (const ch of s) u8(ch.charCodeAt(0)); u8(0); };
      // TIFF body is built first so offsets are known; all offsets are from the TIFF header.
      // Layout: header(8) IFD0(2+2*12+4=30 @8) ExifIFD(2+12+4=18 @38) date(20 @56) GPS IFD(2+4*12+4=54 @76) lat(24 @130) lng(24 @154)
      const tiff = [];
      const t8 = v => tiff.push(v & 255), t16 = v => { t8(v); t8(v >> 8); }, t32 = v => { t16(v & 0xFFFF); t16(v >>> 16); };
      const tstr = (s, n) => { for (let i = 0; i < n; i++) t8(i < s.length ? s.charCodeAt(i) : 0); };
      t16(0x4949); t16(42); t32(8);
      t16(2); t16(0x8769); t16(4); t32(1); t32(38); t16(0x8825); t16(4); t32(1); t32(76); t32(0);
      t16(1); t16(0x9003); t16(2); t32(20); t32(56); t32(0);
      tstr('2026:10:09 18:30:15', 20);
      t16(4);
      t16(0x0001); t16(2); t32(2); tstr('N', 4);
      t16(0x0002); t16(5); t32(3); t32(130);
      t16(0x0003); t16(2); t32(2); tstr('E', 4);
      t16(0x0004); t16(5); t32(3); t32(154);
      t32(0);
      t32(1); t32(1); t32(17); t32(1); t32(24); t32(1);      // 1°17'24" N
      t32(103); t32(1); t32(51); t32(1); t32(0); t32(1);     // 103°51'00" E
      u16(0xD8FF); // SOI as bytes FF D8
      bytes.length = 0; u8(0xFF); u8(0xD8); u8(0xFF); u8(0xE1); const len = 2 + 6 + tiff.length; u8(len >> 8); u8(len & 255); str('Exif'); u8(0); bytes.push(...tiff); u8(0xFF); u8(0xD9);
      return new Uint8Array(bytes).buffer;
    };
    const ex = tripsyReadJpegExif(exifBuf());
    assert(ex.takenAt === '2026-10-09T18:30:15' && Math.abs(ex.lat - 1.29) < 0.001 && Math.abs(ex.lng - 103.85) < 0.001, 'THE ASK: the capture date and GPS position are read from the photo: ' + JSON.stringify(ex));
    assert(tripsyReadJpegExif(new Uint8Array([1, 2, 3]).buffer).takenAt === null && tripsyReadJpegExif(new ArrayBuffer(0)).lat === null, 'a non-JPEG reads as nothing, never a throw');
    // Routing: a stay's window runs from its start day up to the next stop's start day.
    const stops = [
      { id: 'o', kind: 'origin', lat: 33.94, lng: -118.4, start: '2026-10-05T20:00:00' },
      { id: 'sg', kind: 'stay', lat: 1.3, lng: 103.8, start: '2026-10-07T15:00:00', end: '2026-10-12T11:00:00' },
      { id: 'tr', kind: 'transit', lat: 13.7, lng: 100.5, start: '2026-10-12T12:00:00' },
      { id: 'th', kind: 'stay', lat: 20.3, lng: 100.1, start: '2026-10-12T15:00:00', end: '2026-10-17T11:00:00' },
      { id: 'rm', kind: 'stay', removed: true, lat: 0, lng: 0, start: '2026-10-13T15:00:00' },
      { id: 'r', kind: 'return', lat: 33.94, lng: -118.4, start: '2026-10-17T23:00:00' },
    ];
    const route = info => tripsyFlyoverRoutePhoto(stops, info);
    assert(route({ takenAt: '2026-10-09T10:00:00' }) === 'sg' && route({ takenAt: '2026-10-14T10:00:00' }) === 'th' && route({ takenAt: '2026-10-12T09:00:00' }) === 'th',
      'THE ASK: a photo goes to the destination whose dates cover the day it was taken (a moving day to where you were moving to)');
    assert(route({ takenAt: '2026-10-05T21:00:00' }) === 'o' && route({ takenAt: '2026-10-18T10:00:00' }) === 'r' && route({ takenAt: '2026-10-20T10:00:00' }) === null && route({ takenAt: '2026-10-01T10:00:00' }) === null,
      'the departure and home airports take their own days; a photo before or well after the trip goes nowhere');
    assert(route({ takenAt: null, lat: 1.35, lng: 103.9 }) === 'sg' && route({ takenAt: '2026-10-25T10:00:00', lat: 20.2, lng: 100.0 }) === 'th' && route({ takenAt: null, lat: 48.8, lng: 2.3 }) === null,
      'THE ASK: with no usable date, the location decides -- the nearest destination within ' + TRIPSY_FLYOVER_ROUTE_GPS_KM + ' km');
    assert(route({ takenAt: '2026-10-12T20:00:00', lat: 13.7, lng: 100.5 }) === 'th', 'a transfer airport is never a destination for photos');
    // ---- A changeover day is decided by the GPS fix ("Is there a way to place photos that
    // could be in multiple locations based on date by a geo code," 2026-10-25) ----
    assert(route({ takenAt: '2026-10-12T08:00:00', lat: 1.29, lng: 103.85 }) === 'sg' && route({ takenAt: '2026-10-12T19:00:00', lat: 20.25, lng: 100.08 }) === 'th',
      'THE ASK: on the day you moved from Singapore to Chiang Rai, a photo with a fix goes to whichever of the TWO it was taken nearer to');
    assert(route({ takenAt: '2026-10-12T08:00:00' }) === 'th', 'with no fix a changeover day still goes to where you were moving to');
    assert(route({ takenAt: '2026-10-14T08:00:00', lat: 1.29, lng: 103.85 }) === 'th', 'a day inside one stop\'s window is never re-routed by GPS (a photo of a Singapore postcard in Chiang Rai stays in Chiang Rai)');
    assert(route({ takenAt: '2026-10-17T20:00:00', lat: 33.9, lng: -118.4 }) === 'r' && route({ takenAt: '2026-10-17T09:00:00', lat: 20.3, lng: 100.1 }) === 'th', 'the last changeover, stay → home airport, splits the same way');
    assert(/data-flyover-add-trip-photos/.test(setup) && /tripsyFlyoverPhotoTakenInfo\(file\)/.test(setup) && /tripsyFlyoverRoutePhoto\(record\.stops, info\)/.test(setup)
      && /await addMediaToStop\(s\.id, group, setStatus\)/.test(setup) && /weren’t added/.test(setup), 'THE ASK: the page\'s Add trip photos button files each pick by its date/place through the ordinary add path and names what went where');
    const taken = extractFn('tripsyFlyoverPhotoTakenInfo');
    assert(/file\.slice\(0, 262144\)\.arrayBuffer\(\)/.test(taken) && /file\.lastModified/.test(taken), 'only the head of the file is read for its date; the file\'s own date is the fallback');
  }
  // ---- a big photo pick no longer freezes the page ("I selected a large number of photos
  // from for the flyover and there is still a substantial delay," 2026-10-25) ----
  {
    const prep = extractFn('tripsyFlyoverPreparePending'), img = extractFn('tripsyFlyoverPrepareImage');
    assert(/_tripsyFlyoverPrepChain\.then\(async \(\) => \{/.test(prep) && /_tripsyFlyoverPrepChain = p\.catch\(\(\) => \{\}\);/.test(prep) && /setTimeout\(r, 0\)/.test(prep),
      'THE ASK: photos are prepared ONE AT A TIME, yielding to the page between them');
    assert(/tripsyFlyoverPendingPrepared\.set\(pendingId, p\)/.test(prep) && /const have = tripsyFlyoverPendingPrepared\.get\(pendingId\);\s*if \(have\) return have;/.test(prep), 'each photo is decoded once, the result memoized');
    assert(/createImageBitmap\(file\)/.test(img) && /new Image\(\)/.test(img) && /return \{ full: file, thumb: file \};/.test(img) && /draw\(big, big\.width, big\.height, thumbDim\)/.test(img),
      'one decode gives the upload copy AND a thumbnail made from it; createImageBitmap first, <img> fallback, the original on failure');
    assert(/const TRIPSY_FLYOVER_UPLOAD_PX = 1600;/.test(html) && /const TRIPSY_FLYOVER_THUMB_PX = 320;/.test(html), 'the upload copy is 1600px, the thumbnail 320px');
    const up = extractFn('tripsyFlyoverRunUpload');
    assert(/\(\{ full: small \} = await tripsyFlyoverPreparePending\(pendingId\)\);/.test(up) && !/tripsyResizeImageBlob/.test(up), 'the upload takes the prepared copy instead of resizing the original again');
    assert(/tripsyPhotoObjectUrlCache\.set\(driveFileId, Promise\.resolve\(URL\.createObjectURL\(prepared\.full\)\)\)/.test(up) && /tripsyPhotoThumbUrlCache\.set\(driveFileId, Promise\.resolve\(URL\.createObjectURL\(prepared\.thumb\)\)\)/.test(up),
      'after the upload the Drive id paints from the copies in memory, so the per-upload repaint decodes nothing');
    assert(/tripsyFlyoverPreparePending\(pendingId\)\.catch\(\(\) => \{\}\);/.test(extractFn('tripsyFlyoverQueueUpload')), 'preparation starts at pick time, in pick order');
    const disp = extractFn('tripsyPlacePhotoDisplayUrl');
    assert(/tripsyFlyoverPreparePending\(driveFileId\)\.then\(r => URL\.createObjectURL\(r\.full\)\)/.test(disp) && !/URL\.createObjectURL\(blob\)\);\s*tripsyPhotoObjectUrlCache\.set\(driveFileId, pp\)/.test(disp),
      'a pending photo is never shown from its original bytes');
    const thumbFn = extractFn('tripsyPlacePhotoThumbUrl'), paint = extractFn('tripsyDiaryPaintPhotos');
    assert(/then\(r => URL\.createObjectURL\(r\.thumb\)\)/.test(thumbFn) && /return tripsyPlacePhotoDisplayUrl\(id\);/.test(thumbFn), 'a tile takes the thumbnail for a pending photo, the ordinary picture otherwise');
    assert(/node\.hasAttribute\('data-diary-thumb'\)/.test(paint) && /await Promise\.all\(jobs\)/.test(paint), 'the painter paints thumbnail boxes from thumbnails, and boxes in parallel');
    assert(/data-diary-thumb/.test(extractFn('tripsyFlyoverThumbHtml')) && /data-diary-thumb/.test(extractFn('tripsyFlyoverPageThumbHtml')), 'both fly-over tile builders are thumbnail boxes');
  }
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
  extractFn('tripsyFlyoverSlideshowSummary'), extractFn('tripsyFlyoverUnplacedPhotos'), extractFn('tripsyFlyoverMusicFader')].join('\n').replace(/^const /gm, 'var '));
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
  assert(/input\.accept = TRIPSY_FLYOVER_PICK_ACCEPT\[kind\]/.test(pick) && /photos: 'image\/\*', videos: 'video\/\*', all: 'image\/\*,video\/\*'/.test(html)
    && /input\.multiple = true/.test(pick) && !/capture/.test(pick.replace(/\/\/.*$/gm, '')),
    'THE ASK: one input with no capture, so iOS shows its own Photos Library / camera sheet; photos and videos are picked separately (2026-10-25)');
  assert(/input\.click\(\);\s*\}$/.test(pick.trim()) && !/tw-modal|innerHTML/.test(pick),
    'THE ASK (2026-10-21, "this is inefficient"): no in-app menu in front of the system picker — the tap opens it directly');
  assert(/tripsyFlyoverPickMedia\(sortTripPhotos/.test(extractFn('showTripsyFlyover')) && /tripsyFlyoverStagePendingVideo\(file\)/.test(extractFn('showTripsyFlyover')),
    'the setup page uses the media picker and stages videos for a background upload');
  const up = extractFn('uploadBlobToDriveResumable');
  assert(/uploadType=resumable/.test(up) && /Content-Range/.test(up) && /status !== 308/.test(up), 'videos upload resumably, in pieces');
  assert(/file\.size > TRIPSY_FLYOVER_VIDEO_MAX_BYTES/.test(extractFn('tripsyFlyoverVideoTooBig')) && /const tooBig = tripsyFlyoverVideoTooBig\(file\);\s*if \(tooBig\) throw tooBig;/.test(extractFn('tripsyFlyoverStagePendingVideo')), 'an oversized video is refused with a message, before anything is staged');
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
eval([extractFn('tripsyFlyoverPhotosInPageOrder'), extractFn('tripsyFlyoverUnplacedPhotos')].join('\n'));
{
  const ph = id => ({ driveFileId: id });
  const st = { photos: [ph('a'), ph('b'), ph('c'), ph('d')], pages: [{ ids: ['c'], count: 1 }, { ids: ['a', 'd'], count: 2 }] };
  const o = tripsyFlyoverPhotosInPageOrder(st);
  assert(o.map(x => x.photo.driveFileId + x.page).join(',') === 'c1,a2,d2,bnull',
    'THE ASK: photos come back in the order their pages play, each with its page; one on No page comes last with page null (it is listed, never lost, but does not play)');
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
  assert(/Tap a photo to see it large\. Drag a page onto another to move it there\./.test(setup), 'the card says its photos can be tapped and its pages dragged');
  assert(/tiles\.forEach\(t => t\.onclick = async e => \{\s*if \(!isOwner \|\| e\.target\.closest\('button'\)\) return;\s*if \(Date\.now\(\) < dragState\.suppressTapUntil\) return;[^\n]*\n[\s\S]*?let hitIdx = strips\.findIndex\(n => \{ const r = n\.getBoundingClientRect\(\); return e\.clientX >= r\.left && e\.clientX < r\.right; \}\);[\s\S]*?await tripsyFlyoverReviewStopPhoto\(stop, pg\.photos\[idx\]\.driveFileId, `Page \$\{k \+ 1\}`, photoHooks\);/.test(setup),
    'THE ASK: tapping a photo on a page tile opens THAT photo large, exactly as Edit photos does ("If a user selects a photo directly from the flyover page, treat it as if he had selected that photo from the edit photo page," 2026-10-25); the release that ended a drag is not a tap');
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
eval([extractFn('tripsyFlyoverVideoAudio'), extractFn('tripsyFlyoverSetVideoAudio')].join('\n'));
{
  // Default flipped 2026-10-25: "For each video, by default use the existing flyover sound".
  assert(tripsyFlyoverVideoAudio({ kind: 'video', audio: 'video' }) === 'video' && tripsyFlyoverVideoAudio({ kind: 'video', audio: 'music' }) === 'music'
    && tripsyFlyoverVideoAudio({ kind: 'video' }) === 'music' && tripsyFlyoverVideoAudio(null) === 'music',
    'THE ASK: a video plays under the fly-over music unless set to its own sound');
  const ph = [{ driveFileId: 'a' }, { driveFileId: 'v', kind: 'video' }];
  const set = tripsyFlyoverSetVideoAudio(ph, 'v', 'video');
  assert(set[1].audio === 'video' && set[0].audio === undefined && ph[1].audio === undefined && tripsyFlyoverSetVideoAudio(set, 'v', 'music')[1].audio === 'music',
    'the setter changes one video\'s sound and nothing else, without touching its input');
  const dlg = extractFn('tripsyFlyoverVideoAudioDialog');
  assert(/data-va-pick="video"/.test(dlg) && /data-va-pick="music"/.test(dlg) && /<video data-va-video playsinline controls/.test(dlg) && /▶ Hear the video/.test(dlg)
    && /v\.muted = false;/.test(dlg), 'the hear-the-video dialog still exists for the Slideshow options page');
  const setup = extractFn('showTripsyFlyover');
  assert(!/tripsyFlyoverVideoAudioDialog\(localUrl/.test(setup) && /const rec = await tripsyFlyoverStagePendingVideo\(file\);[\s\S]*rec\.audio = 'music';/.test(setup),
    'nothing is asked before a video uploads; it is saved under the fly-over music');
  assert(/const setVideoAudioInRecord = async \(stopId, photoId, mode\) => \{[\s\S]*tripsyFlyoverSetVideoAudio\(st\.photos, photoId, mode\)[\s\S]*await save\(\);/.test(setup)
    && /const playerHooks = \{ onRemovePhoto: removePhotoFromRecord, onVideoAudio: setVideoAudioInRecord \};/.test(setup)
    && /playTripsyFlyover\(trip, record, \{ previewStopId: id, \.\.\.playerHooks \}\)/.test(setup)
    && /onVideoAudio: async \(sid, pid, mode\) => \{ await setVideoAudioInRecord\(sid, pid, mode\); if \(onAudio\) onAudio\(pid, mode\); \}/.test(setup),
    'every player launch from the fly-over page (Play, card Preview, editor Preview) passes the sound setter; the editor\'s draft takes it too');
  const ss = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/data-ss-vaudio="video"/.test(ss) && /data-ss-vaudio="music"/.test(ss) && /data-ss-vhear/.test(ss) && /photos\[i\] = \{ \.\.\.photos\[i\], audio: val \}/.test(ss),
    'a video page can switch its sound, or play the video to hear it, in Slideshow options (saved with Save)');
  const player = extractFn('playTripsyFlyover');
  assert(/let underMusic = tripsyFlyoverVideoAudio\(rec\) === 'music';/.test(player) && /v\.muted = underMusic;/.test(player)
    && /const duck = underMusic \? Promise\.resolve\(\) : duckMusic\(\);/.test(player),
    'a video set to the music plays silently and the music never fades out for it');
  // THE ASK: the buttons at the foot of the video, only when played from the fly-over page.
  assert(/if \(s && rec && typeof opts\.onVideoAudio === 'function'\) \{/.test(player)
    && /showVideoPage\(r, page, enterTr, s\)/.test(player)
    && /mk\(listening \? '🎵 Back to Flyover Sound' : '🔊 Listen to Video Sound', \(\) => \{ listening = !listening; if \(listening\) videoSoundNow\(\); else musicNow\(\); paint\(\); \}, 'data-tfo-listen'\);/.test(player)
    && /mk\('✓ Use Video Sound', \(\) => \{ underMusic = false; listening = false; videoSoundNow\(\); persist\('video'\); paint\(\); \}, 'data-tfo-use-video'\);/.test(player)
    && /mk\('🎵 Use Flyover Sound', \(\) => \{ underMusic = true; listening = false; musicNow\(\); persist\('music'\); paint\(\); \}, 'data-tfo-use-music'\);/.test(player)
    && /const persist = mode => \{\s*rec\.audio = mode;[\s\S]*opts\.onVideoAudio\(s\.id, rec\.driveFileId, mode\)/.test(player),
    'under the music: Listen (no setting change) + Use Video Sound (saved); with its own sound: Use Flyover Sound (saved)');
  assert(/\.tfo-video-ctl \{ position: absolute; left: 50%; bottom: 18px;/.test(html) && /\.tfo-group:has\(\.tfo-video-ctl\) \.tfo-video-sound \{ bottom: 66px; \}/.test(html),
    'the buttons sit at the bottom of the video, and the iOS tap-for-sound button moves above them');
  assert(/tripsyFlyoverVideoAudio\(p\) === 'music' \? '🎵' : '🔊'/.test(extractFn('tripsyFlyoverThumbHtml')), 'its thumbnail shows which sound it uses');
}

// ---- hiking between locations ("Add an option to hike between locations for the flyover," 2026-10-21) ----
eval([constLine('TRIPSY_FLYOVER_MODES'), extractFn('tripsyFlyoverModeOf')].join('\n').replace(/^const /gm, 'var '));
{
  assert(TRIPSY_FLYOVER_MODES.includes('hike') && /hike: '🚶'/.test(html) && /hike: 'Hike'/.test(html), 'THE ASK: Hike is one of the transports, shown as 🚶 Hike');
  // "Add bus as a form of transportation" (2026-10-24): a transport of its own in the fly-over,
  // ranked with the car (a bus to the airport never outranks the flight), derived from a bus
  // category, and drawn as 🚌 by the menus and the player.
  assert(TRIPSY_FLYOVER_MODES.includes('bus') && /bus: '🚌'/.test(html) && /bus: 'Bus'/.test(html) && /const TRIPSY_FLYOVER_MODE_RANK = \{[^}]*bus: 1/.test(html),
    'THE ASK: Bus is one of the transports, shown as 🚌 Bus, ranked with a drive');
  assert(tripsyFlyoverModeOf({ category: 'bus' }) === 'bus' && tripsyFlyoverModeOf({ category: 'coach' }) === 'bus' && tripsyFlyoverModeOf({ category: 'car' }) === 'car'
    && tripsyFlyoverModeOf({ category: 'airplane' }) === 'plane', 'a bus or coach category derives as a bus; a car is still a car');
  assert(/<select class="field-input" data-flyover-mode-select[^`]*\$\{TRIPSY_FLYOVER_MODES\.map/.test(extractFn('showTripsyFlyover')),
    'the leg drop-down offers it');
  assert(/TRIPSY_FLYOVER_MODES\.map/.test(extractFn('tripsyFlyoverAskMode')), 'and so does the "How did you get there?" question');
  assert(tripsyFlyoverModeOf({ category: 'other' }, 'Hike to the summit') === 'hike' && tripsyFlyoverModeOf({ category: 'car' }, 'Car from A to B') === 'car'
    && tripsyFlyoverModeOf({ category: 'other' }, 'Walkabout tour') === 'car', 'a transport leg the trip names as a hike or walk draws as one (whole words only)');
  assert(/mode === 'hike' \? '2 7'/.test(extractFn('playTripsyFlyover')), 'a hike is drawn as a dotted trail');
  // "The lines between locations on the flyover should always be dashed regardless of the mode
  // of transportation" (2026-10-24): the ONE trail polyline carries a dash for every mode — the
  // hike's finer dots, '7 9' for everything else — and never a solid (null) fallback.
  {
    const play = extractFn('playTripsyFlyover');
    const trail = (play.match(/const trail = L\.polyline\([^\n]*\n/) || [''])[0];
    assert(/dashArray: mode === 'hike' \? '2 7' : '7 9'/.test(trail) && !/dashArray:[^\n]*null/.test(trail),
      'THE ASK: every leg\'s trail is dashed whatever the transport — no mode draws a solid line');
    assert((play.match(/dashArray/g) || []).length === 1, 'there is one trail polyline, so no second drawing can bring a solid line back');
  }
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
  assert(/const save = \(\) => \{[\s\S]{0,400}?record = tripsyFlyoverResolvePendingIds\(record\);\s*const staged = Store\.stageTripsyFlyover\(record\);/.test(setup)
    && /Store\.persistTripsyFlyovers\(\)/.test(setup),
    'a fly-over change is staged in memory before its Drive write queues, so View plays it immediately');
  const dd = { tripsyFlyovers: [{ tripKey: 'a', v: 1 }, { tripKey: 'b', v: 1 }] };
  const store = new Function('driveData', 'const TRIPSY_SESSION_ID = "me"; return ({ _stagedFlyovers: new Map(), _staleFlyoverKeys: new Set(), ' + html.match(/  stageTripsyFlyover\(record, \{ force = false \} = \{\}\) \{[\s\S]*?\n  \},/)[0] + '})')(dd);
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
  assert(/const r = await addMedia\(files, setStatus\);[\s\S]*photos\.push\(\{ \.\.\.rec \}\);/.test(dlg) && !/tripsyFlyoverPlaceAddedPhotos\(/.test(dlg) && /added on No page — tap them onto a page/.test(dlg),
    'THE ASK: added records join the draft on No page; the editor places nothing on a page by itself (2026-10-25)');
  assert(/if \(!pages\.length\) pages\.push\(blank\(\)\);/.test(dlg) && !/unplaced0/.test(dlg) && /const addPageAtEnd = \(\) => \{\s*const pg = blank\(\);\s*pages = \[\.\.\.pages, pg\];/.test(dlg) && />\$\{here \? `✓ \$\{order\}` : k != null \? `Page \$\{k \+ 1\}` : 'No page'\}<\/span>/.test(dlg),
    'THE ASK: opening the editor or adding a page puts no photo on it, and an unplaced photo is badged No page');
  const setup = extractFn('showTripsyFlyover');
  assert(/const addMediaToStop = async \(id, files, setStatusFn\) => \{/.test(setup)
    && /const onPicked = async files => \{\s*setStatus\([^;]*\);\s*const r = await addMediaToStop\(id, files, setStatus\);/.test(setup)
    && /if \(own\) own\.onclick = \(\) => askSource\(id, \(\) => tripsyFlyoverPickMedia\(onPicked, \{ kind: 'all'/.test(setup) && !/data-flyover-add-video/.test(html)
    && /addMedia: isOwner \? \(files, setStatusFn\) => addMediaToStop\(id, files, setStatusFn\) : null,/.test(setup),
    'ONE add path: the card\'s button and the editor\'s button both run addMediaToStop (stage + background upload for photos AND videos)');
  // ---- Videos upload in the BACKGROUND too ("can we just automatically route all videos
  // through drive and do that in the background so I can still use the app?", 2026-10-25) ----
  {
    assert(/if \(rec\.posterId\) tripsyFlyoverQueueUpload\(trip\.key, rec\.posterId\);\s*tripsyFlyoverQueueUpload\(trip\.key, rec\.driveFileId\);\s*queued\+\+;/.test(setup) && !/await tripsyFlyoverUploadVideo\(/.test(setup),
      'a picked video is staged and queued like a photo (its poster frame as a pending photo of its own); nothing uploads in the foreground');
    const stage = extractFn('tripsyFlyoverStagePendingVideo');
    assert(/const pendingId = tripsyFlyoverStagePendingPhoto\(file\);\s*const posterId = info\.poster \? tripsyFlyoverStagePendingPhoto\(info\.poster\) : null;/.test(stage) && /kind: 'video'/.test(stage),
      'the staged record carries the video under a pending id and its poster under another');
    const run = extractFn('tripsyFlyoverRunUpload');
    assert(/if \(tripsyFlyoverFileIsVideo\(file\)\) \{[\s\S]*uploadBlobToDriveResumable\(file, `flyover-video-\$\{Date\.now\(\)\}`, file\.type \|\| 'video\/mp4', f => \{[\s\S]*tripsyFlyoverUploadProgress\.set\(pendingId, f\);[\s\S]*tripsyFlyoverUploadedIds\.set\(pendingId, driveFileId\);\s*tripsyFlyoverPendingBlobs\.delete\(pendingId\);/.test(run),
      'the background job uploads a video resumably with progress and lets its bytes go once it has landed');
    assert(/if \(tripsyFlyoverFileIsVideo\(file\)\) \{ const v = Promise\.resolve\(\{ full: file, thumb: file \}\);/.test(extractFn('tripsyFlyoverPreparePending')), 'a video is never resized as a photo');
    assert(/if \(e\.detail\.progress == null && !tripsyFlyoverFailedUploads\.has\(e\.detail\.pendingId\)\) uploadLanded = true;/.test(setup), 'a progress tick repaints the badge but never writes to Drive');
    eval('var tripsyFlyoverUploadedIds = new Map(); ' + extractFn('tripsyFlyoverResolvePendingIds'));
    const rec = { stops: [{ id: 's', photos: [{ driveFileId: 'pending-v', kind: 'video', posterId: 'pending-p' }, { driveFileId: 'x' }], pages: [{ ids: ['pending-v'] }] }] };
    const out = tripsyFlyoverResolvePendingIds(rec, new Map([['pending-v', 'V'], ['pending-p', 'P']]));
    assert(out.stops[0].photos[0].driveFileId === 'V' && out.stops[0].photos[0].posterId === 'P' && out.stops[0].pages[0].ids[0] === 'V' && out.stops[0].photos[1].driveFileId === 'x',
      'resolving pending ids swaps a video\'s poster too');
    assert(/const prog = vid && pending && !failed && tripsyFlyoverUploadProgress\.has\(p\.driveFileId\)/.test(extractFn('tripsyFlyoverThumbHtml')), 'a pending video\'s tile shows its upload percentage');
  }
  // ---- A big pick no longer freezes the page (2026-10-25): landings are coalesced, and the
  // picker says it is waiting while iOS exports the selection ----
  {
    const run = extractFn('tripsyFlyoverRunUpload');
    assert(/tripsyFlyoverScheduleResolvedSave\(tripKey\);/.test(run) && !/await Store\.saveTripsyFlyover/.test(run),
      'a landed upload schedules ONE batched save of the record instead of writing Drive per photo');
    const sched = extractFn('tripsyFlyoverScheduleResolvedSave');
    assert(/clearTimeout\(prev\)/.test(sched) && /TRIPSY_FLYOVER_UPLOAD_SAVE_DEBOUNCE_MS/.test(sched) && /tripsyFlyoverResolvePendingIds\(rec\)/.test(sched),
      'the batched save is debounced per trip and resolves the record as it is THEN');
    assert(/uploadFlush = setTimeout\(\(\) => \{[\s\S]*?record = tripsyFlyoverResolvePendingIds\(record\);[\s\S]*?if \(uploadLanded\) \{ uploadLanded = false; save\(\); \}[\s\S]*?render\(\);[\s\S]*?\}, 400\);/.test(setup),
      'the setup page repaints and saves ONCE per batch of landings, not per photo');
    const pick = extractFn('tripsyFlyoverPickMedia');
    assert(/\{ onWaiting, onCancel, kind = 'all' \} = \{\}/.test(pick) && /onWaiting\(TRIPSY_FLYOVER_PICK_WAITING\)/.test(pick) && /input\.oncancel = /.test(pick),
      'the picker reports that it is waiting for Photos, and clears on cancel');
    assert((setup.match(/kind: 'all', onWaiting: setStatus, onCancel: \(\) => setStatus\(''\) \}/g) || []).length === 2
      && /\{ kind: 'all', onWaiting: setStatus, onCancel: \(\) => setStatus\(''\) \}/.test(extractFn('tripsyFlyoverSlideshowDialog')),
      'all three picker buttons (card, trip photos, editor) take photos AND videos in one pick and show the waiting status');
  }
  assert(/return \{ added, done, queued, skipped, problems \};/.test(setup), 'addMediaToStop reports the records it added, and how many it skipped as already there');
  // ---- Overlapping batches never duplicate (2026-10-25): every added file carries a byte
  // fingerprint, and a file whose fingerprint the record already holds is skipped ----
  {
    eval(extractFn('tripsyFlyoverKnownSources'));
    const rec = { stops: [{ id: 'a', photos: [{ driveFileId: 'x', src: 'h:1:10' }, { driveFileId: 'y' }] }, { id: 'b', photos: [{ driveFileId: 'v', kind: 'video', src: 'h:2:20' }] }] };
    const k = tripsyFlyoverKnownSources(rec);
    assert(k.size === 2 && k.has('h:1:10') && k.has('h:2:20') && tripsyFlyoverKnownSources(null).size === 0, 'known sources = every stamped photo and video on the record, any stop');
    const fp = extractFn('tripsyFlyoverFileFingerprint');
    assert(/file\.slice\(0, 65536\)\.arrayBuffer\(\)/.test(fp) && /crypto\.subtle\.digest\('SHA-256', head\)/.test(fp) && /return `h:\$\{hex\}:\$\{file\.size\}`;/.test(fp) && /return `n:\$\{file\.name \|\| ''\}:\$\{file\.size\}`;/.test(fp),
      'the fingerprint is a hash of the first 64 KB + size, with a name|size fallback');
    assert(/const known = tripsyFlyoverKnownSources\(record\);[\s\S]*const bf = await Promise\.all\(batch\.map\(k => tripsyFlyoverFileFingerprint\(files\[k\]\)\)\);[\s\S]*if \(\(fps\[k\] && known\.has\(fps\[k\]\)\) \|\| tripsyFlyoverCaptureTwin\(knownCaptures, caps\[k\]\.taken, caps\[k\]\.px\)\) \{ skipped\+\+; continue; \}[\s\S]*\.\.\.\(fps\[k\] \? \{ src: fps\[k\] \} : \{\}\)/.test(setup)
      && /if \(fps\[k\]\) rec\.src = fps\[k\];/.test(setup) && /if \(skipped\) problems\.push\(`\$\{skipped\} already on this fly-over — skipped\.`\);/.test(setup),
      'THE ASK: a photo or video already on the fly-over is skipped and counted, new ones are stamped');
  }
  // ---- The intake runs in batches and leaves a receipt (2026-10-25: "when i picked 87 it
  // seemed to freeze again. Can it automatically break the import into batches?") ----
  {
    assert(/const TRIPSY_FLYOVER_INTAKE_BATCH = 10;/.test(html)
      && /for \(let b = 0; b < photoIdx\.length; b \+= TRIPSY_FLYOVER_INTAKE_BATCH\) \{/.test(setup)
      && /await new Promise\(r => setTimeout\(r, 0\)\);\s*\}\s*if \(closed && queued\) save\(\);/.test(setup)
      && /status\(`Adding photos… \$\{Math\.min\(b \+ batch\.length, photoIdx\.length\)\} of \$\{photoIdx\.length\} taken in/.test(setup),
      'THE ASK: photos are taken in ten at a time, the page yields between batches, and the status counts them in');
    eval([extractFn('tripsyFlyoverIntakeReceiptText'), 'var tripsyFlyoverPhotoIsPending = id => /^pending-/.test(id); var tripsyFlyoverFailedUploads = new Set(["pending-f"]);'].join('\n'));
    const rec = { stops: [{ photos: [{ driveFileId: 'd1' }, { driveFileId: 'pending-a' }, { driveFileId: 'pending-f' }] }] };
    assert(tripsyFlyoverIntakeReceiptText(null, rec) === '' && /nothing has arrived from Photos yet/.test(tripsyFlyoverIntakeReceiptText({ openedAt: 1 }, rec))
      && /closed with nothing picked/.test(tripsyFlyoverIntakeReceiptText({ openedAt: 1, cancelledAt: 2 }, rec)),
      'the receipt says when the picker opened and whether anything ever arrived');
    const got = tripsyFlyoverIntakeReceiptText({ openedAt: 1, receivedAt: 2, count: 87, kind: 'photos', staged: 80, skipped: 7 }, rec);
    assert(/87 photos received/.test(got) && /80 taken in/.test(got) && /7 already here/.test(got) && /1 still uploading/.test(got) && /1 failed/.test(got),
      'once received it counts: taken in, already here, still uploading, failed');
    assert(/all uploaded\./.test(tripsyFlyoverIntakeReceiptText({ openedAt: 1, receivedAt: 2, count: 3, staged: 3 }, { stops: [{ photos: [{ driveFileId: 'd1' }] }] })), 'and "all uploaded" once nothing is pending');
    assert(/2 in no destination’s dates/.test(tripsyFlyoverIntakeReceiptText({ openedAt: 1, receivedAt: 2, count: 5, kind: 'drive', staged: 3, unmatched: 2 }, { stops: [] })) && /files from Drive received/.test(tripsyFlyoverIntakeReceiptText({ openedAt: 1, receivedAt: 2, count: 5, kind: 'drive', staged: 3 }, { stops: [] })),
      'a Drive import\'s receipt names the files from Drive and the ones that fit no destination');
    const pick = extractFn('tripsyFlyoverPickMedia');
    assert(/tripsyFlyoverIntakeNote\(\{ openedAt: Date\.now\(\), kind, receivedAt: 0/.test(pick) && /cancelledAt: Date\.now\(\)/.test(pick)
      && /tripsyFlyoverIntakeNote\(\{ receivedAt: Date\.now\(\), count: n, photos: photoIdx\.length/.test(setup) && /data-flyover-intake/.test(html),
      'the picker logs opened / cancelled, the intake logs received and staged, and the page shows the line');
  }
  // ---- Import from a Drive folder (2026-10-25: "copy the photos into a temporary drive folder
  // and then import the photos into the app in the background from the drive folder") ----
  {
    eval([extractFn('tripsyFlyoverDriveSrc'), extractFn('tripsyFlyoverDriveMetaInfo'), extractFn('tripsyFlyoverDriveVideoRecord'), extractFn('tripsyFlyoverDrivePhotoRecord'), extractFn('tripsyFlyoverPhotoInPlace'), extractFn('tripsyFlyoverRecordDriveIds'), extractFn('tripsyFlyoverDriveNewFiles'), extractFn('tripsyFlyoverKnownSources'), extractFn('tripsyFlyoverDriveFolderUrl'), extractFn('tripsyFlyoverPreviewUrlAt'),
      extractFn('tripsyFlyoverPxKey'), extractFn('tripsyFlyoverCaptureFields'), extractFn('tripsyFlyoverKnownCaptures'), extractFn('tripsyFlyoverCaptureTwin'), extractFn('tripsyFlyoverNoteCapture')].join('\n'));
    // ---- The "Upload new photos" Shortcut ("Is there a way i can have the app upload all new
    // photos taken since the date of the last photo uploaded?" … "build the shortcut, but put a
    // reminder on the screen to keep it open until a completion message, and if it does not
    // complete, can a dialog appear with instructions on how to complete," 2026-10-27) ----
    {
      var esc = typeof esc === 'function' ? esc : (v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
      eval([constLine('TRIPSY_FLYOVER_SHORTCUT_NAME'), constLine('TRIPSY_FLYOVER_SHORTCUT_GRACE_MS'), constLine('DRIVE_FOLDER_NAME'), constLine('TRIPSY_FLYOVER_FOUND_MARKER')].map(s => s.replace(/^const /, 'var ')).concat(['tripsyFlyoverLastCaptureTime', 'tripsyFlyoverShortcutSince', 'tripsyFlyoverShortcutSinceDefault', 'tripsyFlyoverShortcutSinceText', 'tripsyFlyoverShortcutInput', 'tripsyFlyoverShortcutUrl', 'tripsyFlyoverShortcutLooksIncomplete', 'tripsyFlyoverShortcutRecipeHtml'].map(extractFn)).join('\n'));
      const recS = { stops: [{ photos: [{ driveFileId: 'a', taken: '2026-10-21T09:00:00' }, { driveFileId: 'b', taken: '2026-10-23T18:30:15' }, { driveFileId: 'c' }] }, { photos: [{ driveFileId: 'd', taken: '2026-10-22T08:00:00' }] }] };
      assert(tripsyFlyoverLastCaptureTime(recS) === '2026-10-23T18:30:15' && tripsyFlyoverLastCaptureTime({ stops: [] }) === '', 'the newest capture second on the record, across every destination');
      assert(tripsyFlyoverShortcutSince(recS, '2026-10-06') === '2026-10-23 18:30:15' && tripsyFlyoverShortcutSince({ stops: [] }, '2026-10-06') === '2026-10-06 00:00:00', 'THE ASK: "since" is the last imported photo\'s capture time, else the trip\'s first day');
      const recPng = { stops: [{ photos: [{ driveFileId: 'a', taken: '2026-10-21T09:00:00' }, { driveFileId: 's', taken: '2026-10-28T20:36:27', mime: 'image/png' }] }] };
      assert(tripsyFlyoverLastCaptureTime(recPng) === '2026-10-21T09:00:00', 'a PNG (screenshot) never sets the newest-capture mark');
      // "It didn't reset the date" (2026-10-29): a typed since only stands while it is later than the record's newest capture.
      assert(tripsyFlyoverShortcutSinceDefault(recS, '2026-10-06', '2026-10-27 18:00:00') === '2026-10-27 18:00:00' && tripsyFlyoverShortcutSinceDefault(recS, '2026-10-06', '2026-10-20 18:00:00') === '2026-10-23 18:30:15' && tripsyFlyoverShortcutSinceDefault(recS, '2026-10-06', '') === '2026-10-23 18:30:15' && tripsyFlyoverShortcutSinceDefault({ stops: [] }, '2026-10-06', '2026-10-27T18:00:00') === '2026-10-27 18:00:00',
        'the dialog pre-fills the later of the typed since and the newest capture, so an import moves it on');
      // "This process is just not working … we need another solution" (2026-10-28): the Shortcut
      // uploads STRAIGHT to Drive, so the input carries the folder's id and a Drive access token.
      // "Got 0 photos" / "Says found 0 photos" (2026-10-29): a bare "2026-10-28 13:50:48" read as UTC, and prose "12:05:25 AM" read as PM; the since carries its own offset.
      assert(tripsyFlyoverShortcutSinceText('2026-10-29 00:05:25', 540) === '2026-10-29T00:05:25+09:00' && tripsyFlyoverShortcutSinceText('2026-10-28 13:50:48', -420) === '2026-10-28T13:50:48-07:00' && tripsyFlyoverShortcutSinceText('2026-12-01T12:05', 330) === '2026-12-01T12:05:00+05:30' && tripsyFlyoverShortcutSinceText('2026-12-01 12:05:00', 0) === '2026-12-01T12:05:00+00:00' && tripsyFlyoverShortcutSinceText('junk') === 'junk' && tripsyFlyoverShortcutSinceText('') === '',
        'the since-moment goes to the Shortcut as ISO 8601 with an explicit offset -- no form Get Dates can reinterpret');
      // "I tried that already" (2026-10-29): the Shortcut's own move never takes, so the page moves root uploads into the inbox itself.
      eval([extractFn('tripsyFlyoverRootUploadName')].join('\n'));
      assert(tripsyFlyoverRootUploadName(' IMG_4114', 'image/jpeg') === 'IMG_4114.jpg' && tripsyFlyoverRootUploadName('IMG_0340', 'image/heic') === 'IMG_0340.heic' && tripsyFlyoverRootUploadName('IMG_1.JPG', 'image/jpeg') === 'IMG_1.JPG' && tripsyFlyoverRootUploadName('', 'video/quicktime') === 'photo.mov' && tripsyFlyoverRootUploadName('Untitled', 'application/x-odd') === 'Untitled',
        'a root upload is renamed cleanly: leading space trimmed, an extension added from its type when missing');
      {
        const adopt = extractFn('tripsyFlyoverAdoptRootUploads');
        assert(/'root' in parents and trashed=false and createdTime > '\$\{from\}' and createdTime < '\$\{to\}' and \(mimeType contains 'image\/' or mimeType contains 'video\/'\)/.test(adopt) && /new Date\(t0 - 60000\)/.test(adopt) && /t0 \+ TRIPSY_FLYOVER_ROOT_ADOPT_MS/.test(adopt) && /addParents=\$\{encodeURIComponent\(folderId\)\}&removeParents=root/.test(adopt),
          'the sweep takes only images/videos in root created in the launch window, and moves each into the inbox');
        const setupR = extractFn('showTripsyFlyover');
        assert(/if \(record\.shortcutLaunchedAt\) \{\s*try \{ await tripsyFlyoverAdoptRootUploads\(record\.inboxFolderId, record\.shortcutLaunchedAt\); \}[\s\S]*?\}\s*const files = await tripsyFlyoverListInbox\(record\.inboxFolderId\);/.test(setupR),
          'every watcher tick with a launch pending sweeps root BEFORE listing the inbox, so the uploads are counted the same tick');
      }
      assert(/^2026-10-23T18:30:15[+-]\d\d:\d\d$/.test(tripsyFlyoverShortcutSinceText('2026-10-23 18:30:15')), 'with no offset given, the device\'s own offset for that moment is used');
      assert(/^2026-10-23T18:30:15[+-]\d\d:\d\d\|FOLDER1\|ya29\.tok$/.test(tripsyFlyoverShortcutInput('2026-10-23 18:30:15', 'FOLDER1', 'ya29.tok')) && tripsyFlyoverShortcutInput('x', 'a|b', 'c|d') === 'x|ab|cd' && tripsyFlyoverShortcutInput('', '', '') === '||',
        'THE ASK: one text input: date | folder id | token (the separator never appears in either)');
      const tokSrc = extractFn('tripsyFlyoverShortcutToken');
      assert(/await authWorkerGetAccessToken\(\)/.test(tokSrc) && /driveAccessToken = viaWorker\.accessToken;/.test(tokSrc) && /return driveAccessToken \|\| '';/.test(tokSrc),
        'the token is renewed through the auth Worker when it can be (a fresh hour), else the page\'s current one; no credential lives in the Shortcut');
      assert(tripsyFlyoverShortcutUrl('2026-10-23 18:30:15|F') === 'shortcuts://run-shortcut?name=Travel%20Tracker%20Upload&input=text&text=2026-10-23%2018%3A30%3A15%7CF', 'the shortcuts:// link runs the named shortcut with that text');
      const L = 1000000;
      assert(!tripsyFlyoverShortcutLooksIncomplete(L, L + 60000, 0, NaN) && tripsyFlyoverShortcutLooksIncomplete(L, L + 90000, 0, NaN), 'nothing in the folder is "incomplete" only once the grace period has passed');
      assert(tripsyFlyoverShortcutLooksIncomplete(L, L + 90000, 3, L - 5000) && !tripsyFlyoverShortcutLooksIncomplete(L, L + 90000, 3, L + 5000) && !tripsyFlyoverShortcutLooksIncomplete(NaN, L + 90000, 0, NaN),
        'files older than the launch do not count as arrivals; a file that landed after it does; no launch, no nudge');
      const recipe = tripsyFlyoverShortcutRecipeHtml();
      assert((recipe.match(/<li/g) || []).length === 13 && /Split Text/.test(recipe) && /Item at Index<\/em> <code>2<\/code>/.test(recipe) && /Find Photos/.test(recipe) && /Date Taken is after/.test(recipe) && /Media Type is Image/.test(recipe) && /Repeat with Each/.test(recipe)
        && recipe.includes('https://www.googleapis.com/upload/drive/v3/files?uploadType=media') && /Method <em>POST<\/em>/.test(recipe) && /<code>Bearer <\/code>/.test(recipe) && /Request Body <em>File<\/em>/.test(recipe)
        && /Get Dictionary Value/.test(recipe) && recipe.includes('https://www.googleapis.com/drive/v3/files/') && /\?addParents=/.test(recipe) && /&amp;removeParents=root/.test(recipe) && /Method <em>PATCH<\/em>/.test(recipe) && /key <code>name<\/code>/.test(recipe)
        && /Done — \[Count\] photos uploaded/.test(recipe) && /Allow Sharing Large Amounts of Data/.test(recipe)
        && !/Save File/.test(recipe) && !/Ask Where to Save/.test(recipe) && !/travel-tracker-found/.test(recipe) && !/share sheet/i.test(recipe),
        'the recipe builds the direct-upload shortcut: split the input, find photos after the date, per photo a media upload then a PATCH that names and moves it, a Done alert -- no Save File, no share sheet, no count file');
      // "I didn't see the Singapore GP folder in the save list" (2026-10-27): the inbox folder sits
      // inside the app's REAL Drive folder (DRIVE_FOLDER_NAME), which the recipe and the nudge dialog
      // had been naming by hand -- and the folder was then RENAMED to match ("change the name of
      // everything including the folder to Travel Tracker"), by the app itself on its next open.
      assert(DRIVE_FOLDER_NAME === 'Travel Tracker' && constLine('DRIVE_FOLDER_LEGACY_NAME').includes("'Travel Reservation Tracking'"),
        'the folder is "Travel Tracker"; the old name survives only as the legacy constant');
      const fo = extractFn('findOrCreateDriveFolderUncached');
      assert(/folderName === DRIVE_FOLDER_NAME/.test(fo) && /findDriveFolderIdByName\(DRIVE_FOLDER_LEGACY_NAME\)/.test(fo) && /method: 'PATCH'/.test(fo) && /name: DRIVE_FOLDER_NAME/.test(fo) && /return legacyId;/.test(fo)
        && fo.indexOf('findDriveFolderIdByName(DRIVE_FOLDER_LEGACY_NAME)') < fo.indexOf("method: 'POST'"),
        'a folder still under the old name is renamed in place and reused -- never a second folder created beside it');
      assert(/const hit = \(searchJson\.files \|\| \[\]\)\.find\(f => f\.name === folderName\) \|\| null;/.test(extractFn('findDriveFolderIdByName')),
        'the name match is re-checked exactly on the client, so a loose search answer under the OLD name cannot pass for the new one and skip the rename');
      assert(/catch \(e\) \{ console\.error\('Pasted-photo recompression failed[^\n]*\n\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*try \{ await findOrCreateDriveFolder\(DRIVE_FOLDER_NAME\); \}/.test(extractFn('runBackgroundSyncs')),
        'runBackgroundSyncs looks the folder up once per session, so the rename actually runs on an ordinary open (nothing else looks it up -- the fly-over page remembers its inbox id)');
      const recipeSrc = extractFn('tripsyFlyoverShortcutRecipeHtml');
      assert(!/Travel Tracker ›/.test(recipeSrc) && !/Travel Reservation Tracking/.test(recipeSrc), 'the recipe never hand-types the Drive folder name');
      assert(!/Travel Tracker ›/.test(extractFn('tripsyFlyoverShortcutIncompleteDialog')) && /\$\{esc\(DRIVE_FOLDER_NAME\)\} › \$\{esc\(folderName\)\}/.test(extractFn('tripsyFlyoverShortcutIncompleteDialog')) && !/asks where to save/.test(extractFn('tripsyFlyoverShortcutIncompleteDialog')),
        'the not-finished dialog names the folder by the constant and no longer talks about a save picker');
      // "If there are no photos, we should just have a message that says 'No new photos to upload.'
      // And then say the date and time of the last photo uploaded … and then have a close button"
      // (2026-10-28): the page cannot see the Shortcut's count, so a run that saved nothing reads
      // as that plain news; the didn't-finish steps sit behind a <details>.
      eval(extractFn('tripsyFlyoverCaptureTimeLabel'));
      assert(tripsyFlyoverCaptureTimeLabel('2026-10-26T22:48:15') === 'Mon, Oct 26 at 10:48 PM' && tripsyFlyoverCaptureTimeLabel('2026-10-26 09:05:00') === 'Mon, Oct 26 at 9:05 AM' && tripsyFlyoverCaptureTimeLabel('') === '' && tripsyFlyoverCaptureTimeLabel('junk') === '',
        'a capture second reads as a day and clock time; nothing for none');
      const nudgeSrc = extractFn('tripsyFlyoverShortcutIncompleteDialog');
      assert(/No new photos to upload<\/h2>/.test(nudgeSrc) && /'The last photo uploaded was taken'\} <strong>\$\{esc\(lastLabel\)\}<\/strong>/.test(nudgeSrc) && /carries a capture time, so the last upload’s date isn’t known/.test(nudgeSrc)
        && /<details[^>]*><summary[^>]*>The shortcut didn’t finish\? What to do<\/summary>/.test(nudgeSrc) && /data-sn-close>Close</.test(nudgeSrc) && !/data-sn-cancel/.test(nudgeSrc)
        && /\[data-sn-close\]'\)\.onclick = \(\) => \{ close\(\); onClose\(\); \};/.test(nudgeSrc),
        'THE ASK: "No new photos to upload", the last photo\'s capture time (or that none is known), the steps folded away, and Close ends the hand-off');
      assert(/lastTaken: tripsyFlyoverLastCaptureTime\(record\),\s*onRunAgain:[^\n]*\n\s*onKeepWaiting: \(\) => \{\},\s*onClose: cancelHandOff,/.test(extractFn('showTripsyFlyover')),
        'the page passes the newest capture time and wires Close to the shared cancel');
      // "Is it possible to check photos to see if there are photos taken after the last date?"
      // (2026-10-28): the Shortcut saves travel-tracker-found.txt (its Count) beside the photos;
      // the watcher reads it, trashes it, and acts: 0 -> "No new photos" at once, N -> expected.
      eval([constLine('TRIPSY_FLYOVER_FOUND_MARKER')].map(x => x.replace(/^const /, 'var ')).concat(['tripsyFlyoverFoundMarker', 'tripsyFlyoverParseFoundCount'].map(extractFn)).join('\n'));
      assert(TRIPSY_FLYOVER_FOUND_MARKER === 'travel-tracker-found.txt', 'the marker file has a fixed name the recipe tells the owner to type');
      const mk = tripsyFlyoverFoundMarker([{ id: 'p1', name: 'IMG_1.jpg' }, { id: 'm1', name: 'Travel-Tracker-Found.txt', modifiedTime: '2026-10-28T08:00:00Z' }, { id: 'm2', name: 'travel-tracker-found.txt', modifiedTime: '2026-10-28T09:00:00Z' }]);
      assert(mk && mk.id === 'm2' && tripsyFlyoverFoundMarker([{ id: 'p1', name: 'IMG_1.jpg' }]) === null && tripsyFlyoverFoundMarker(null) === null, 'the newest file of that name (case-insensitive) is the report; none without it');
      assert(tripsyFlyoverParseFoundCount('0') === 0 && tripsyFlyoverParseFoundCount(' 12\n') === 12 && tripsyFlyoverParseFoundCount('Found 3 photos') === 3 && tripsyFlyoverParseFoundCount('') === null && tripsyFlyoverParseFoundCount('-1') === null, 'the count is the first whole number in the file; nothing or a negative is no report');
      const tick = extractFn('showTripsyFlyover');
      assert(/const marker = tripsyFlyoverFoundMarker\(files\);\s*if \(marker && inboxWatch\.markerId !== marker\.id\) \{/.test(tick) && /tripsyFlyoverTrashDriveFile\(marker\.id\)\.catch/.test(tick) && /if \(found !== null\) inboxWatch\.expected = found;/.test(tick)
        && /if \(found === 0\) \{[\s\S]*?cancelHandOff\(\);[\s\S]*?found: 0,[\s\S]*?return;\s*\}/.test(tick)
        && /if \(inboxWatch\.expected > 0 && fresh >= inboxWatch\.expected && inboxWatch\.phase !== 'complete' && !r\.announce\) r = \{ \.\.\.r, announce: true \};/.test(tick)
        && /else if \(!\(inboxWatch\.expected > 0\) && record\.shortcutLaunchedAt/.test(tick) && /expected: 0, markerId: ''/.test(tick),
        'THE ASK: the watcher reads the report once and trashes it; 0 ends the hand-off and says No new photos at once; N completes the moment N have arrived and silences the didn\'t-finish guess');
      eval(extractFn('tripsyFlyoverDriveStatusHtml'));
      assert(/3 of 12 arrived/.test(tripsyFlyoverDriveStatusHtml('uploading', 3, '', true, 12)) && /All 12 photos the shortcut found have reached/.test(tripsyFlyoverDriveStatusHtml('complete', 12, '', true, 12)) && /Nothing new has reached the Drive folder for 2 minutes/.test(tripsyFlyoverDriveStatusHtml('complete', 5, '', true, 12)) && !/arrived/.test(tripsyFlyoverDriveStatusHtml('uploading', 3, '', true)),
        'with a reported count the slot counts arrivals against it; without one it reads as before');
      assert(/found === 0;/.test(extractFn('tripsyFlyoverShortcutIncompleteDialog')) && /The shortcut found no photos taken after the last one uploaded/.test(extractFn('tripsyFlyoverShortcutIncompleteDialog')), 'a reported 0 is said outright in the dialog');
      const dlg = extractFn('tripsyFlyoverShortcutDialog'), nudge = extractFn('tripsyFlyoverShortcutIncompleteDialog');
      assert(/Keep the Shortcuts app in front until it shows “Done — N photos uploaded\.”/.test(dlg) && /data-sc-run disabled/.test(dlg) && /setReady: ok =>/.test(dlg) && /data-sc-copy/.test(dlg) && /inputFor \? inputFor\(sinceNow\(\)\) : ''/.test(dlg) && /if \(c\) c\.textContent = inputTextNow\(\);/.test(dlg),
        'THE ASK: the reminder to keep Shortcuts open is on the launch dialog; Run waits for the folder and token; the input text (built by the page) can be copied and refreshes once ready');
      // The "since" moment is editable (the first run found 431 photos from the trip's first day).
      eval([extractFn('tripsyFlyoverShortcutSinceToField'), extractFn('tripsyFlyoverShortcutSinceFromField')].join('\n'));
      assert(tripsyFlyoverShortcutSinceToField('2026-10-23 18:30:15') === '2026-10-23T18:30' && tripsyFlyoverShortcutSinceToField('') === '', 'the shortcut text maps onto the datetime field');
      assert(tripsyFlyoverShortcutSinceFromField('2026-10-26T09:05') === '2026-10-26 09:05:00' && tripsyFlyoverShortcutSinceFromField('2026-10-26T09:05:30') === '2026-10-26 09:05:30' && tripsyFlyoverShortcutSinceFromField('junk') === '', 'and the field maps back, seconds defaulting to 00');
      assert(/<input type="datetime-local" data-sc-since/.test(dlg) && /onclick = \(\) => \{ const s = sinceNow\(\); onRun\(s\); close\(\); \};/.test(dlg) && /\[data-sc-since\]'\)\.oninput = /.test(dlg),
        'the dialog has a Photos-taken-after field; Run passes its value and the input text follows it');
      assert(/launchShortcut = \(sinceOverride\) => \{[\s\S]*if \(sinceOverride\) shortcutSinceOverride = sinceOverride;/.test(extractFn('showTripsyFlyover')) && /const shortcutSinceDefault = \(\) => tripsyFlyoverShortcutSinceDefault\(record, firstDay, shortcutSinceOverride\);/.test(extractFn('showTripsyFlyover')) && /tripsyFlyoverShortcutDialog\(\{ since: shortcutSinceDefault\(\), folderName,/.test(extractFn('showTripsyFlyover')),
        'a typed since is used for the launch and kept for Run it again; the dialog pre-fills through the later-of rule');
      assert(/No new photos to upload/.test(nudge) && (nudge.match(/<li>/g) || []).length === 5 && /data-sn-run/.test(nudge) && /data-sn-wait/.test(nudge) && /data-sn-close/.test(nudge), 'the nothing-arrived dialog keeps the five steps to complete (folded), Run it again / Keep waiting, and Close');
      const setup3 = extractFn('showTripsyFlyover');
      assert(/data-flyover-shortcut/.test(setup3) && /launchShortcut = \(sinceOverride\) => \{\s*if \(closed \|\| !inboxFolderKnown \|\| !shortcutToken\) return;[\s\S]*?try \{ window\.location\.href = tripsyFlyoverShortcutUrl\(shortcutInputText\(sinceOverride\)\); \}/.test(setup3) && /record = \{ \.\.\.record, inboxFolderId: inboxFolderKnown, inboxDest: 'auto', inboxPendingAt: now, shortcutLaunchedAt: now \};\s*save\(\); render\(\);/.test(setup3),
        'Run opens the link inside the tap and starts the ordinary Drive hand-off, stamped for the watchdog');
      assert(/tripsyFlyoverShortcutInput\(since \|\| shortcutSinceDefault\(\), inboxFolderKnown, shortcutToken\)/.test(setup3) && /tripsyFlyoverShortcutToken\(\)\.then\(t => \{ shortcutToken = t; shortcutTokenAt = Date\.now\(\); return t; \}\)/.test(setup3) && /shortcutPrepare\(\)\.then\(ok => \{ if \(!closed\) dlg\.setReady\(ok\); \}/.test(setup3),
        'the launch text carries the folder id and a token fetched while the dialog is up; Run is enabled only once both are in hand');
      assert(/relaunchShortcut = \(\) => \{\s*if \(inboxFolderKnown && shortcutToken && Date\.now\(\) - shortcutTokenAt < 40 \* 60000\) \{ launchShortcut\(\); return; \}\s*shortcutPrepare\(\)\.then/.test(setup3) && (setup3.match(/onRunAgain: \(\) => \{ if \(relaunchShortcut\) relaunchShortcut\(\); \}/g) || []).length === 2 && !/onRunAgain: \(\) => \{ if \(launchShortcut\) launchShortcut\(\); \}/.test(setup3),
        'Run it again reuses a token under 40 minutes old inside the tap, else renews it first -- a lapsed token would make every upload fail silently');
      // "I am getting this - which i seem to be getting a lot" (2026-10-27): the once-per-launch
      // memory was a page-local flag, so every reopen of the page asked again about the same
      // launch. It is stamped on the record now (shortcutNudgedFor = the launch it was shown for).
      assert(/else if \(!\(inboxWatch\.expected > 0\) && record\.shortcutLaunchedAt && record\.shortcutNudgedFor !== record\.shortcutLaunchedAt && tripsyFlyoverShortcutLooksIncomplete\(Date\.parse\(record\.shortcutLaunchedAt\), Date\.now\(\), fresh, newestMs\)\) \{\s*record = \{ \.\.\.record, shortcutNudgedFor: record\.shortcutLaunchedAt \};\s*save\(\);\s*tripsyFlyoverShortcutIncompleteDialog\(/.test(setup3) && !/shortcutNudged\b/.test(setup3) && /if \(record\.shortcutLaunchedAt\) record = \{ \.\.\.record, shortcutLaunchedAt: '' \};/.test(setup3),
        'the watcher nudges once per launch, remembered on the record so a reopened page never re-asks; an import clears the launch');
      eval(extractFn('tripsyFlyoverDriveStatusHtml'));
      const st = tripsyFlyoverDriveStatusHtml('waiting', 0, 'https://x', true);
      assert(/data-flyover-shortcut-note/.test(st) && /Keep Shortcuts in front until it says Done/.test(st) && !/data-flyover-shortcut-note/.test(tripsyFlyoverDriveStatusHtml('waiting', 0, 'https://x')), 'the status slot repeats the reminder while a Shortcut launch is watched');
      assert(/if \(prevRecord\.shortcutLaunchedAt\) rec\.shortcutLaunchedAt = prevRecord\.shortcutLaunchedAt; if \(prevRecord\.shortcutNudgedFor\) rec\.shortcutNudgedFor = prevRecord\.shortcutNudgedFor;/.test(html), 'a rebuild keeps a pending launch, and the nudge already shown for it');
      assert(/const staged = Store\.stageTripsyFlyover\(record\);\s*if \(!staged\) \{ adoptLiveRecord\(\); return Promise\.resolve\(false\); \}\s*record = staged;/.test(extractFn('showTripsyFlyover')) && /if \(Store\.takeStaleFlyover\(trip\.key\)\) adoptLiveRecord\(\);/.test(extractFn('showTripsyFlyover')),
        'the page adopts the stamped record it staged, and reloads the live one (with a toast) when its copy was refused as stale');
      assert(/const TRIPSY_FLYOVER_RESTORE_FILENAME = 'tripsy-flyover-restore\.json';/.test(html) && /Store\.stageTripsyFlyover\(r, \{ force: true \}\);/.test(extractFn('drainTripsyFlyoverRestore')) && /if \(!ok\) throw new Error/.test(extractFn('drainTripsyFlyoverRestore')) && /await drainTripsyFlyoverRestore\(\);/.test(html),
        'a Claude session can put a record back through the restore relay, drained in syncTripsyRelays, kept on a failed save');
      // "I am still getting the same shortcut message after i canceled it" (2026-10-27): the
      // fly-over save had no conflict retry -- another writer's revision made persistDriveData
      // reload the remote copy, which silently dropped the staged Cancel. Executed against a fake
      // persistDriveData that conflicts once and reloads an older copy.
      {
        const method = (sig) => { const s = html.indexOf(sig); let d = 0; for (let j = s + sig.length - 1; ; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) return html.slice(s, j + 1); } } };
        // driveData is one module-level variable shared by Store and persistDriveData in the
        // app (a conflict reload REASSIGNS it), so the fake lives in the same scope.
        const { Store, log, setConflicts, setLive } = new Function(
          'const log = []; let conflicts = 1; const tripsyNotifyAuthExpired = () => {};\n'
          + "let driveData = { tripsyFlyovers: [{ tripKey: 'sg', inboxPendingAt: 'LAUNCH', shortcutLaunchedAt: 'LAUNCH' }] };\n"
          + 'async function persistDriveData(opts) {\n'
          + "  if (conflicts-- > 0) { log.push('conflict silent=' + !!(opts && opts.silentConflict)); driveData = { tripsyFlyovers: [{ tripKey: 'sg', inboxPendingAt: 'LAUNCH', shortcutLaunchedAt: 'LAUNCH', other: 'newer' }] }; const e = new Error('CONFLICT_RELOADED'); e.conflict = true; throw e; }\n"
          + "  log.push('wrote ' + JSON.stringify(driveData.tripsyFlyovers.map(r => [r.inboxPendingAt, r.shortcutLaunchedAt, r.other])));\n"
          + '}\n'
          + 'const TRIPSY_SESSION_ID = "me"; const Store = {' + method('  stageTripsyFlyover(record, { force = false } = {}) {') + ',\n_stagedFlyovers: new Map(), _staleFlyoverKeys: new Set(),\n' + method('  async persistTripsyFlyovers() {') + ',\n' + method('  takeStaleFlyover(tripKey) {') + '}; return { Store, log, setConflicts: n => { conflicts = n; }, setLive: r => { driveData.tripsyFlyovers = [r]; } };')();
        (async () => {
          Store.stageTripsyFlyover({ tripKey: 'sg', inboxPendingAt: '', shortcutLaunchedAt: '' });
          const ok = await Store.persistTripsyFlyovers();
          assert(ok && log[0] === 'conflict silent=true' && log[1] === 'wrote [["","",null]]' && Store._stagedFlyovers.size === 1,
            'THE FIX: a conflicting fly-over save reloads silently, re-stages this session\'s record onto the fresh copy and writes it -- the Cancel lands');
          // The second lost Cancel (same day): a save queued BEHIND a successful one had its record
          // staged while that one ran; clearing the memory on success left it nothing to re-apply
          // when it conflicted itself. The memory is kept, so the later save still re-stages.
          Store.stageTripsyFlyover({ tripKey: 'sg', inboxPendingAt: 'L2', shortcutLaunchedAt: 'L2', shortcutNudgedFor: '' });
          const okA = await Store.persistTripsyFlyovers();          // the nudge save, succeeds
          Store.stageTripsyFlyover({ tripKey: 'sg', inboxPendingAt: '', shortcutLaunchedAt: '' });
          setConflicts(1);                                          // the Cancel save conflicts
          const okB = await Store.persistTripsyFlyovers();
          assert(okA && okB && log[log.length - 1] === 'wrote [["","",null]]',
            'a save queued behind a successful one still re-applies ITS record on a conflict -- the memory is never cleared on success');
          // 2026-10-28: a fly-over page left open on another device since Oct 26 wrote its
          // two-day-old record over the live one (18 photos and every capture time gone). A
          // copy whose stamp is OLDER than a record another session saved is refused; this
          // session's own saves (same savedBy) never make the page stale; force bypasses.
          Store.stageTripsyFlyover({ tripKey: 'sg', v: 'mine' });
          const mine = Store._stagedFlyovers.get('sg');
          assert(mine.savedBy === 'me' && !!mine.updatedAt, 'every stage stamps updatedAt and this session\'s savedBy');
          // another device saves later
          await new Promise(r => setTimeout(r, 5));
          const other = { tripKey: 'sg', v: 'theirs', updatedAt: new Date(Date.now() + 1000).toISOString(), savedBy: 'other-device' };
          setConflicts(1);
          Store.stageTripsyFlyover({ ...mine, v: 'mine-2' });            // the page's next change, stamped from its own copy
          // simulate the conflict reload handing back the other device's newer record
          const okC = await (async () => { const p = Store.persistTripsyFlyovers(); return p; })();
          assert(okC === true, 'no stale copy was involved yet, so the retry wrote this session\'s record');
          const staleCopy = { tripKey: 'sg', v: 'stale', updatedAt: '2026-10-26T13:20:31.613Z' };
          // the other device's record arrives as the live one (a conflict reload)
          setLive(other);
          const refused = Store.stageTripsyFlyover(staleCopy);
          assert(refused === false && Store._staleFlyoverKeys.has('sg') && Store.takeStaleFlyover('sg') && !Store.takeStaleFlyover('sg'),
            'THE FIX: a copy older than another device\'s save is refused, noted once for the page, and nothing is staged');
          assert(Store.stageTripsyFlyover({ ...other, v: 'theirs-edited' }) !== false, 'a copy carrying the live record\'s own stamp (loaded after their save) stages fine');
          assert(Store.stageTripsyFlyover(staleCopy, { force: true }) !== false, 'force (the restore relay) overrules a newer live record');
        })();
      }
    }
    // ---- Capture-time dedupe ("If i just over-select photos to upload manually, will the
    // de-dupe logic automatically skip those?", 2026-10-27) ----
    {
      assert(tripsyFlyoverPxKey(4032, 3024) === '3024x4032' && tripsyFlyoverPxKey(3024, 4032) === '3024x4032' && tripsyFlyoverPxKey(0, 10) === '' && tripsyFlyoverPxKey(undefined, undefined) === '', 'the size key puts the smaller side first, so a rotation reads the same; unknown -> empty');
      const cf = tripsyFlyoverCaptureFields({ takenAt: '2026-10-21T09:00:00', source: 'exif', width: 4032, height: 3024 });
      assert(cf.taken === '2026-10-21T09:00:00' && cf.px === '3024x4032', 'EXIF time + size become the record\'s taken / px');
      assert(Object.keys(tripsyFlyoverCaptureFields({ takenAt: '2026-10-21T09:00:00', source: 'file' })).length === 0 && Object.keys(tripsyFlyoverCaptureFields(null)).length === 0, 'a file date (the upload moment) is never a capture time');
      const dr = tripsyFlyoverDrivePhotoRecord({ id: 'q', mimeType: 'image/heif', imageMediaMetadata: { time: '2026:10:21 09:00:00', width: 4032, height: 3024 } });
      assert(dr.taken === '2026-10-21T09:00:00' && dr.px === '3024x4032', 'a Drive-imported photo records them from Drive\'s listing');
      const kc = tripsyFlyoverKnownCaptures({ stops: [{ photos: [{ driveFileId: 'a', taken: '2026-10-21T09:00:00', px: '3024x4032' }, { driveFileId: 'b', taken: '2026-10-21T09:00:05' }, { driveFileId: 'c' }] }] });
      assert(tripsyFlyoverCaptureTwin(kc, '2026-10-21T09:00:00', '3024x4032') && tripsyFlyoverCaptureTwin(kc, '2026-10-21T09:00:00', '') && !tripsyFlyoverCaptureTwin(kc, '2026-10-21T09:00:00', '2000x3000'),
        'THE ASK: the same second is a twin -- unless both sides know their size and it differs (a burst)');
      assert(tripsyFlyoverCaptureTwin(kc, '2026-10-21T09:00:05', '3024x4032') && !tripsyFlyoverCaptureTwin(kc, '2026-10-21T09:00:06', '3024x4032') && !tripsyFlyoverCaptureTwin(kc, '', '3024x4032') && !tripsyFlyoverCaptureTwin(null, '2026-10-21T09:00:05', ''),
        'a known photo of unknown size matches any size at its second; no time, no map -> never a twin');
      tripsyFlyoverNoteCapture(kc, '2026-10-22T10:00:00', '1x2');
      assert(tripsyFlyoverCaptureTwin(kc, '2026-10-22T10:00:00', '1x2'), 'a photo taken in during a batch is known to the rest of the batch');
      const setup2 = extractFn('showTripsyFlyover');
      assert(/\|\| tripsyFlyoverCaptureTwin\(knownCaptures, rec\.taken, rec\.px\)\) \{ known\.add\(src\); dupes\+\+;[\s\S]*tripsyFlyoverNoteCapture\(knownCaptures, rec\.taken, rec\.px\);/.test(setup2)
        && /const bc = await Promise\.all\(batch\.map\(k => tripsyFlyoverPhotoTakenInfo\(files\[k\]\)\.then\(tripsyFlyoverCaptureFields, \(\) => \(\{\}\)\)\)\);[\s\S]*\|\| tripsyFlyoverCaptureTwin\(knownCaptures, caps\[k\]\.taken, caps\[k\]\.px\)\) \{ skipped\+\+; continue; \}[\s\S]*\.\.\.caps\[k\] \};/.test(setup2),
        'both routes -- the Drive import and the picker -- skip a capture twin and record taken / px on what they add');
      assert(/imageMediaMetadata\(time,location,width,height\)/.test(extractFn('tripsyFlyoverListInbox')) && /const pw = numOf\(exif, 0xA002\), ph = numOf\(exif, 0xA003\);/.test(extractFn('tripsyReadJpegExif')) && /info\.width = Number\(im\.width\)/.test(extractFn('tripsyFlyoverDriveMetaInfo')),
        'the pixel size comes from Drive\'s listing on one route and the EXIF PixelX/YDimension tags on the other');
    }
    // ---- A delete repaints at once, the save behind it ("When i delete a photo from the flyover
    // page there is a delay," 2026-10-27) ----
    {
      const setupSrc = extractFn('showTripsyFlyover');
      const rm = setupSrc.slice(setupSrc.indexOf('const removePhotoFromRecord = async'), setupSrc.indexOf('const setVideoAudioInRecord'));
      assert(/updateStop\(stopId, \{ photos: next\.photos[^\n]*\n\s*if \(!closed\) render\(\);\s*const ok = await save\(\);\s*if \(!ok\) throw new Error\('save failed'\);/.test(rm), 'THE ASK: the tile goes the moment the photo is off the record; the Drive write runs behind, and a failed one throws for the caller');
      const mv = setupSrc.slice(setupSrc.indexOf('const movePhotoInRecord = async'), setupSrc.indexOf('const photoMoveTargets'));
      const va = setupSrc.slice(setupSrc.indexOf('const setVideoAudioInRecord = async'), setupSrc.indexOf('const playerHooks'));
      assert(/if \(!closed\) render\(\);\s*await save\(\);/.test(mv) && /if \(!closed\) render\(\);\s*await save\(\);/.test(va), 'a move and a video-sound change repaint before their save too');
    }
    // ---- Photos referenced IN PLACE ("How do we prevent this from happening again? The whole
    // point is to allow background processing," 2026-10-27): the import is metadata only. ----
    {
      const ph = tripsyFlyoverDrivePhotoRecord({ id: 'ph1', mimeType: 'image/heif', md5Checksum: 'abc123' });
      assert(ph.driveFileId === 'ph1' && ph.inPlace === true && ph.mime === 'image/heif' && ph.src === 'drive:ph1' && ph.md5 === 'md5:abc123', 'THE ASK: an inbox photo is referenced by its own Drive id, with Drive\'s checksum as its content identity');
      assert(tripsyFlyoverPhotoInPlace(ph) && !tripsyFlyoverPhotoInPlace({ driveFileId: 'x' }) && !tripsyFlyoverPhotoInPlace({ driveFileId: 'pending-1', inPlace: true }), 'in-place is the flag on a real Drive id, never a pending one');
      assert(tripsyFlyoverKnownSources({ stops: [{ photos: [ph] }] }).has('md5:abc123'), 'a re-upload of the same bytes is known by checksum');
      const ids = tripsyFlyoverRecordDriveIds({ stops: [{ photos: [ph, { driveFileId: 'v1', kind: 'video', posterId: 'po1' }, { driveFileId: 'pending-z' }, { driveFileId: 'builtin:lax' }] }] });
      assert(ids.has('ph1') && ids.has('v1') && ids.has('po1') && !ids.has('pending-z') && !ids.has('builtin:lax') && ids.size === 3, 'the retire moves every Drive file the record refers to, never a pending or built-in id');
      assert(tripsyFlyoverPreviewUrlAt('https://lh3.googleusercontent.com/drive-storage/abc=s220', 1600) === 'https://lh3.googleusercontent.com/drive-storage/abc=s1600' && tripsyFlyoverPreviewUrlAt('https://x/y=s220-c', 1600) === 'https://x/y=s1600' && tripsyFlyoverPreviewUrlAt('', 1600) === '', 'Drive\'s preview link is re-sized by its trailing =s suffix');
      const disp = extractFn('tripsyPlacePhotoDisplayUrl'), ip = extractFn('tripsyFlyoverDrivePhotoUrl');
      assert(/if \(tripsyFlyoverInPlaceIds\.has\(driveFileId\)\) \{/.test(disp) && /tripsyGetCachedPhotoBlob\(driveFileId\)/.test(ip) && /fields=thumbnailLink,hasThumbnail/.test(ip) && /return link;/.test(ip) && /const blob = await downloadDriveFileBlob\(driveFileId\);/.test(ip),
        'an in-place photo shows from Drive\'s server-made preview (cached on disk; the bare URL if its bytes can\'t be read; the original only when there is no preview)');
      assert(/if \(rec && typeof tripsyFlyoverInPlaceIds !== 'undefined'\) for \(const s of \(rec\.stops \|\| \[\]\)\) for \(const p of \(s\.photos \|\| \[\]\)\) if \(tripsyFlyoverPhotoInPlace\(p\)\) tripsyFlyoverInPlaceIds\.add\(p\.driveFileId\);/.test(html), 'Store.getTripsyFlyover -- the one reader -- registers in-place photos for the display path');
      assert(/md5Checksum/.test(extractFn('tripsyFlyoverListInbox')), 'the inbox listing asks Drive for each file\'s checksum');
    }
    const a = tripsyFlyoverDriveMetaInfo({ id: 'a', imageMediaMetadata: { time: '2026:10:09 18:30:15', location: { latitude: 1.29, longitude: 103.85 } }, createdTime: '2026-10-25T01:00:00Z' });
    assert(a.takenAt === '2026-10-09T18:30:15' && a.lat === 1.29 && a.lng === 103.85 && a.source === 'exif', 'THE ASK: Drive\'s own listing gives the capture time and GPS, so photos route with no download');
    const b = tripsyFlyoverDriveMetaInfo({ id: 'b', createdTime: '2026-10-25T01:00:00Z' });
    assert(b.takenAt && b.source === 'file' && b.lat === null, 'no EXIF in the listing -> the upload time, marked as such');
    const v = tripsyFlyoverDriveVideoRecord({ id: 'vid1', mimeType: 'video/quicktime', videoMediaMetadata: { durationMillis: '80500', width: '1920', height: '1080' } });
    assert(v.driveFileId === 'vid1' && v.kind === 'video' && v.audio === 'music' && v.duration === 81 && v.width === 1920 && v.src === 'drive:vid1', 'a video is referenced in place on Drive, under the music by default');
    const rec = { stops: [{ photos: [{ driveFileId: 'x', src: 'drive:p1' }] }] };
    const fresh = tripsyFlyoverDriveNewFiles([
      { id: 'p2', mimeType: 'image/jpeg', imageMediaMetadata: { time: '2026:10:10 09:00:00' } },
      { id: 'p1', mimeType: 'image/jpeg', imageMediaMetadata: { time: '2026:10:08 09:00:00' } },
      { id: 'p3', mimeType: 'image/heic', createdTime: '2026-10-09T00:00:00Z' },
      { id: 'doc', mimeType: 'application/pdf' },
    ], rec);
    assert(fresh.map(f => f.id).join() === 'p3,p2', 'only new photos / videos, oldest capture first; a PDF in the folder is ignored');
    assert(tripsyFlyoverDriveFolderUrl('abc 1') === 'https://drive.google.com/drive/folders/abc%201', 'the folder link opens in Drive');
    const setup = extractFn('showTripsyFlyover');
    assert(!/data-flyover-drive-import|data-flyover-card-drive-import|tripsyFlyoverDriveImportDialog/.test(html) && /const runDriveImport = async \(files, dest, folderId\) => \{/.test(setup)
      && /const src = tripsyFlyoverDriveSrc\(f\.id\);\s*if \(known\.has\(src\)\) continue;/.test(setup)
      && /const stopId = tripsyFlyoverDriveImportDest\(record\.stops, f, dest\);/.test(setup)
      && /rec = tripsyFlyoverDrivePhotoRecord\(f\);\s*if \(\(rec\.md5 && known\.has\(rec\.md5\)\) \|\| tripsyFlyoverCaptureTwin\(knownCaptures, rec\.taken, rec\.px\)\) \{ known\.add\(src\); dupes\+\+; tripsyFlyoverIntakeNote\(\{ skipped: dupes \}\); tripsyFlyoverTrashDriveFile\(f\.id\); continue; \}[\s\S]*tripsyFlyoverInPlaceIds\.add\(f\.id\);/.test(setup)
      && !/downloadDriveFileBlob\(f\.id\)|tripsyFlyoverQueueUpload\(trip\.key, pendingId\)/.test(setup.slice(setup.indexOf('const runDriveImport'), setup.indexOf('const editBtn')))
      && /if \(taken === 1 \|\| taken % 10 === 0\) \{ save\(\); render\(\); \}/.test(setup),
      'the import is metadata only: resume-safe by src, routed by date or to a chosen destination, each photo referenced in place (a checksum twin trashed), nothing downloaded or uploaded');
    assert(/if \(prevRecord && prevRecord\.inboxFolderId\) rec\.inboxFolderId = prevRecord\.inboxFolderId;/.test(html), 'a rebuild keeps the inbox folder');
    // ---- Capture date first, whichever button started the hand-off ("Will the drive uploaded
    // photos load in the correct day on the flyover page?", 2026-10-25 -- the live hand-off came
    // from one destination's card) ----
    eval([constLine('TRIPSY_FLYOVER_ROUTE_GPS_KM').replace(/^const /, 'var '), extractFn('tripsyFlyoverRoutePhoto'), extractFn('tripsyFlyoverDriveImportDest')].join('\n'));
    const dStops = [{ id: 'sg', kind: 'stay', lat: 1.3, lng: 103.8, start: '2026-10-08', end: '2026-10-12' }, { id: 'dn', kind: 'stay', lat: 16.0, lng: 108.2, start: '2026-10-17', end: '2026-10-22' }];
    assert(tripsyFlyoverDriveImportDest(dStops, { imageMediaMetadata: { time: '2026:10:09 10:00:00' }, createdTime: '2026-10-25T01:00:00Z' }, 'dn') === 'sg', 'a photo with an EXIF date goes to ITS day\'s destination even when the hand-off was started from another card');
    assert(tripsyFlyoverDriveImportDest(dStops, { mimeType: 'video/quicktime', createdTime: '2026-10-25T01:00:00Z' }, 'dn') === 'dn', 'a video (no EXIF in Drive) falls back to the card\'s destination, never to the upload day');
    assert(tripsyFlyoverDriveImportDest(dStops, { mimeType: 'video/quicktime', createdTime: '2026-10-18T01:00:00Z' }, 'auto') === null, 'with no card and no EXIF nothing is guessed from the upload time');
    assert(tripsyFlyoverDriveImportDest(dStops, { imageMediaMetadata: { time: '2026:09:01 10:00:00' } }, 'dn') === 'dn' && tripsyFlyoverDriveImportDest(dStops, { imageMediaMetadata: { time: '2026:09:01 10:00:00' } }, 'auto') === null, 'a dated photo fitting no destination takes the card\'s, else is left out');
    // The folder is temporary: videos moved out, folder trashed, only once everything landed.
    assert(/if \(!closed && !failed && !unmatched && taken && folderId\) \{[\s\S]*await save\(\);\s*await tripsyFlyoverRetireInbox\(folderId, tripsyFlyoverRecordDriveIds\(record\)\);[\s\S]*record = \{ \.\.\.record, inboxFolderId: '', inboxDest: '', inboxPendingAt: '' \};/.test(setup)
      && !/tripsyFlyoverWaitForUploads/.test(setup),
      'THE ASK: after a clean import the folder is retired at once -- there is no upload left to wait for');
    const retire = extractFn('tripsyFlyoverRetireInbox');
    assert(/const inFolder = await tripsyFlyoverListInbox\(folderId\);\s*for \(const f of inFolder\) \{\s*if \(!keep\.has\(f\.id\)\) continue;/.test(retire) && /addParents=\$\{encodeURIComponent\(home\)\}&removeParents=\$\{encodeURIComponent\(folderId\)\}/.test(retire) && /JSON\.stringify\(\{ trashed: true \}\)/.test(retire),
      'every referenced file still in the folder is MOVED into the app folder first (the fly-over shows them by id; trashing a folder trashes its contents), then the inbox is trashed, not permanently deleted');
    eval(extractFn('tripsyFlyoverWaitForUploads') + '\nvar tripsyFlyoverUploadedIds = new Map([["pending-a", "d1"]]);');
    // ---- Each imported photo leaves the Drive folder on its own ("Remember to delete the photos
    // from drive once they have been uploaded to the app," 2026-10-25) ----
    eval(extractFn('tripsyFlyoverInboxFilesToTrash'));
    const waiting = new Map([['pending-a', 'inboxA'], ['pending-b', 'inboxB'], ['pending-c', 'inboxC']]);
    const uploaded = new Map([['pending-a', 'dA'], ['pending-b', 'dB']]);
    const recSaved = { stops: [{ photos: [{ driveFileId: 'dA' }, { driveFileId: 'pending-b' }, { driveFileId: 'pending-c' }] }] };
    const go = tripsyFlyoverInboxFilesToTrash(recSaved, waiting, uploaded);
    assert(go.length === 1 && go[0].inboxId === 'inboxA', 'an inbox file is trashed only once its photo has landed AND the saved record carries the Drive id — not while still pending (b), not while still uploading (c)');
    assert(tripsyFlyoverInboxFilesToTrash({ stops: [{ photos: [{ driveFileId: 'v1', posterId: 'pending-a' }] }] }, new Map([['pending-a', 'inboxA']]), uploaded).length === 0, 'a poster still pending in the record holds its file too');
    assert(/dupes\+\+; tripsyFlyoverIntakeNote\(\{ skipped: dupes \}\); tripsyFlyoverTrashDriveFile\(f\.id\); continue;/.test(setup),
      'the import trashes a duplicate\'s inbox copy at once');
    assert(/if \(resolved !== rec\) await Store\.saveTripsyFlyover\(resolved\);[\s\S]*if \(tripsyFlyoverTrashAfterUpload\.size\) await tripsyFlyoverTrashImportedInboxFiles\(resolved\);/.test(extractFn('tripsyFlyoverScheduleResolvedSave')),
      'the trash runs after the resolved record is saved, never before');
    const trashFn = extractFn('tripsyFlyoverTrashDriveFile');
    assert(/JSON\.stringify\(\{ trashed: true \}\)/.test(trashFn) && /catch \(e\)[\s\S]*return false;/.test(trashFn), 'a file goes to Drive\'s trash, not a permanent delete, and a failure is swallowed (the folder retire or the next import covers it)');
    const known2 = tripsyFlyoverKnownSources({ stops: [{ photos: [{ driveFileId: 'x', src: 'h:1', driveSrc: 'drive:p9' }] }] });
    assert(known2.has('h:1') && known2.has('drive:p9'), 'known sources include a Drive photo\'s content fingerprint AND its Drive id, so a re-uploaded copy is still one photo');
    assert(/if \(out\.full !== file && tripsyFlyoverPendingBlobs\.get\(pendingId\) === file\) tripsyFlyoverPendingBlobs\.set\(pendingId, out\.full\);/.test(html), 'a prepared photo releases its original bytes');
    // ---- No Drive button by default: the pick itself is routed ("Do not show the import from
    // drive button by default. Instead, when the user selects add photos, automatically route
    // that to drive if the number of photos is large or there is a video … display a button on
    // the flyover view that says 'Finish Upload'," 2026-10-25) ----
    const src = extractFn('tripsyFlyoverAddSourceDialog');
    assert(/data-src-photos/.test(src) && /data-src-drive/.test(src) && /onclick = \(\) => \{ close\(\); onPhotos\(\); \};/.test(src) && /onclick = \(\) => \{ close\(\); onDrive\(\); \};/.test(src),
      'the source question offers A few photos / Many or a video, each handler run synchronously in its tap');
    assert(/if \(own\) own\.onclick = \(\) => askSource\(id, \(\) => tripsyFlyoverPickMedia\(onPicked/.test(setup) && /tripPhotosBtn\.onclick = \(\) => askSource\('auto', \(\) => tripsyFlyoverPickMedia\(sortTripPhotos/.test(setup),
      'both add buttons ask first; the card remembers its destination, the page-level button files by date');
    eval(extractFn('tripsyFlyoverLastPickCrashed'));
    assert(tripsyFlyoverLastPickCrashed({ openedAt: 1 }) && !tripsyFlyoverLastPickCrashed({ openedAt: 1, receivedAt: 2 }) && !tripsyFlyoverLastPickCrashed({ openedAt: 1, cancelledAt: 2 }) && !tripsyFlyoverLastPickCrashed({ openedAt: 1, kind: 'drive' }) && !tripsyFlyoverLastPickCrashed(null),
      'a pick that never came back (no files, no cancel) is a crash; a cancel, an arrival or a Drive import is not');
    assert(/if \(tripsyFlyoverLastPickCrashed\(tripsyFlyoverIntakeLoad\(\)\)\) \{[\s\S]*handOffToDrive\(dest, openPicker\);\s*return;/.test(setup), 'after a crashed pick the next one goes through Drive without asking');
    assert(/record = \{ \.\.\.record, inboxFolderId: folderId, inboxDest: dest \|\| 'auto', inboxPendingAt: new Date\(\)\.toISOString\(\) \};\s*save\(\); render\(\);/.test(setup) && /\$\{record\.inboxPendingAt \? `<span data-flyover-drive-status/.test(setup),
      'the hand-off remembers the destination and the page shows the Drive status slot until the import clears it');
    assert(/runFinishUpload = async \(\) => \{[\s\S]*const fresh = tripsyFlyoverDriveNewFiles\(files, record\);[\s\S]*runDriveImport\(fresh, record\.inboxDest \|\| 'auto', folderId\);\s*\};\s*wireDriveStatus\(\);/.test(setup) && !/data-flyover-finish-upload|finishBtn/.test(html),
      'the import is run from the status slot\'s button; there is no Finish Upload button ("Drop the finish upload button," 2026-10-25)');
    // ---- The upload-complete notification ("Is there a way the app can display a notification
    // when the upload is complete to drive?", 2026-10-25): Drive gives no signal, so the page
    // watches the folder and infers completion from a count that has settled. ----
    var esc = typeof esc === 'function' ? esc : (v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]));
    eval([constLine('TRIPSY_FLYOVER_INBOX_POLL_MS'), constLine('TRIPSY_FLYOVER_INBOX_SETTLE_MS')].map(s => s.replace(/^const /, 'var ')).concat(['tripsyFlyoverInboxWatchStep', 'tripsyFlyoverDrivePhase', 'tripsyFlyoverDriveStatusHtml'].map(extractFn)).join('\n'));
    assert(TRIPSY_FLYOVER_INBOX_POLL_MS >= 5000 && TRIPSY_FLYOVER_INBOX_SETTLE_MS >= TRIPSY_FLYOVER_INBOX_POLL_MS, 'the folder is polled no more than every few seconds, and a settle window spans at least one poll');
    let w = tripsyFlyoverInboxWatchStep(null, 0, 1000, 30000);
    assert(!w.announce && w.state.count === 0, 'an empty folder announces nothing');
    w = tripsyFlyoverInboxWatchStep(w.state, 0, 100000, 30000);
    assert(!w.announce, 'an empty folder never settles into an announcement, however long it stays empty');
    w = tripsyFlyoverInboxWatchStep(w.state, 5, 101000, 30000);
    assert(!w.announce && w.state.since === 101000, 'files arriving reset the settle clock');
    w = tripsyFlyoverInboxWatchStep(w.state, 8, 116000, 30000);
    assert(!w.announce && w.state.since === 116000, 'a count still growing is not complete');
    w = tripsyFlyoverInboxWatchStep(w.state, 8, 131000, 30000);
    assert(!w.announce, 'the same count seen for less than the settle window is not yet announced');
    w = tripsyFlyoverInboxWatchStep(w.state, 8, 146000, 30000);
    assert(w.announce && w.state.announced === 8, 'the same count for the whole settle window is announced once');
    w = tripsyFlyoverInboxWatchStep(w.state, 8, 400000, 30000);
    assert(!w.announce, 'an announced count is not announced again');
    w = tripsyFlyoverInboxWatchStep(w.state, 12, 401000, 30000);
    w = tripsyFlyoverInboxWatchStep(w.state, 12, 431000, 30000);
    assert(w.announce && w.state.announced === 12, 'a later batch that grows the count settles and is announced again');
    // ---- No live count: a flashing "Uploading Photos to Drive" until the count settles, then the
    // prompt in its place ("Don't have a live count. Until the drive upload is complete display a
    // flashing message 'Uploading Photos to Drive'. When that is done, change that message to the
    // completion prompt," 2026-10-25) ----
    // ---- Files that landed long ago are complete at once ("Why does the flashing uploading
    // photos message display whenever I select the flyover page," 2026-10-25) ----
    const hoursAgo = 1000000 - 3 * 3600 * 1000;
    let o = tripsyFlyoverInboxWatchStep(null, 54, 1000000, 30000, hoursAgo);
    assert(o.announce && o.state.announced === 54, 'THE ASK: on opening the page, files that all reached Drive long ago go straight to the completion prompt, no flashing');
    o = tripsyFlyoverInboxWatchStep(o.state, 54, 1015000, 30000, hoursAgo);
    assert(!o.announce, '…and are announced only once');
    o = tripsyFlyoverInboxWatchStep(null, 54, 1000000, 30000, 1000000 - 5000);
    assert(!o.announce && o.changed, 'a file that landed seconds ago still flashes until the count holds still');
    o = tripsyFlyoverInboxWatchStep(o.state, 55, 1015000, 30000, 1015000 - 2000);
    o = tripsyFlyoverInboxWatchStep(o.state, 55, 1046000, 30000, 1015000 - 2000);
    assert(o.announce, 'a still-arriving batch announces once it settles, as before');
    assert(!tripsyFlyoverInboxWatchStep(null, 0, 1000000, 30000, hoursAgo).announce && !tripsyFlyoverInboxWatchStep(null, 3, 1000000, 30000, NaN).announce, 'an empty folder, or files with no arrival time, never skip the wait');
    assert(/const times = freshFiles\.map\(f => Date\.parse\(f\.createdTime \|\| ''\)\)\.filter\(isFinite\);\s*if \(marker\) times\.push\([^\n]*\n\s*const newestMs = times\.filter\(isFinite\)\.length \? Math\.max\(\.\.\.times\.filter\(isFinite\)\) : NaN;\s*let r = tripsyFlyoverInboxWatchStep\(inboxWatch\.state, fresh, Date\.now\(\), TRIPSY_FLYOVER_INBOX_SETTLE_MS, newestMs\);/.test(setup),
      'the watcher passes the newest new file\'s arrival time');
    assert(tripsyFlyoverDrivePhase('uploading', { announce: false, changed: true }, 3) === 'uploading' && tripsyFlyoverDrivePhase('uploading', { announce: true, changed: false }, 3) === 'complete'
      && tripsyFlyoverDrivePhase('complete', { announce: false, changed: false }, 3) === 'complete' && tripsyFlyoverDrivePhase('later', { announce: false, changed: false }, 3) === 'later'
      && tripsyFlyoverDrivePhase('later', { announce: false, changed: true }, 4) === 'uploading' && tripsyFlyoverDrivePhase(undefined, { announce: false, changed: false }, 3) === 'uploading'
      && tripsyFlyoverDrivePhase('waiting', { announce: false, changed: true }, 1) === 'uploading',
      'the message phase: uploading until announced, complete on the announcement, Later holds, a count that grows again goes back to uploading');
    // "Why is the app still flashing uploading photos?" (2026-10-26): an EMPTY folder waits quietly.
    assert(tripsyFlyoverDrivePhase('uploading', { announce: false, changed: false }, 0) === 'waiting' && tripsyFlyoverDrivePhase(undefined, { announce: false, changed: true }, 0) === 'waiting', 'THE ASK: nothing in the folder is waiting, never uploading');
    const wait = tripsyFlyoverDriveStatusHtml('waiting', 0, 'https://drive.google.com/drive/folders/x');
    assert(!/tripsy-menu-flash/.test(wait) && /Waiting for photos in the Drive folder/.test(wait) && /data-drive-open-folder/.test(wait) && /data-drive-cancel/.test(wait), 'THE ASK: the waiting message does not flash, and offers Open folder and Cancel');
    assert(/inboxWatch = \{ timer: null, state: null, phase: 'waiting'/.test(setup) && /inboxWatch\.phase = tripsyFlyoverDrivePhase\(inboxWatch\.phase, r, fresh\);/.test(setup)
      && /if \(cancel\) cancel\.onclick = cancelHandOff;/.test(setup) && /onClose: cancelHandOff,/.test(setup)
      && /const cancelHandOff = \(\) => \{\s*const cleared = \{ inboxDest: '', inboxPendingAt: '', shortcutLaunchedAt: '' \};\s*if \(closed\) \{\s*const live = Store\.getTripsyFlyover\(trip\.key\);\s*if \(live && live\.inboxPendingAt\) Store\.saveTripsyFlyover\(\{ \.\.\.live, \.\.\.cleared \}\);\s*return;\s*\}\s*record = \{ \.\.\.record, \.\.\.cleared \}; save\(\); stopInboxWatch\(\); render\(\);/.test(setup),
      'the watcher starts waiting, passes the count to the phase, and ONE Cancel (status slot and dialog alike) ends the hand-off -- on the Store\'s copy if the page was already closed under the dialog');
    // "if the upload is still happening, the app shouldn't say the upload is complete" and
    // "Nothing happens when I hit the import now button" (2026-10-26).
    assert(TRIPSY_FLYOVER_INBOX_SETTLE_MS === 120000, 'THE ASK: two quiet minutes before the folder counts as complete (photos landed 30-60 s apart on a slow connection)');
    const imp = tripsyFlyoverDriveStatusHtml('importing', 0);
    assert(/data-flyover-drive-phase="importing"/.test(imp) && /Importing from Drive/.test(imp) && !/data-drive-import-now/.test(imp) && /driveImportRunning \? tripsyFlyoverDriveStatusHtml\('importing', 0\)/.test(setup) && /driveImportRunning = true;\s*stopInboxWatch\(\);[^\n]*\n[^\n]*shortcutLaunchedAt[^\n]*\n\s*paintDriveStatus\(\);/.test(setup),
      'THE ASK: while an import runs the slot says so with no button, repainted the moment the import starts');
    const up = tripsyFlyoverDriveStatusHtml('uploading', 0), done = tripsyFlyoverDriveStatusHtml('complete', 54), lat = tripsyFlyoverDriveStatusHtml('later', 54);
    assert(/class="tripsy-menu-flash"/.test(up) && /Uploading Photos to Drive/.test(up) && !/\d/.test(up.replace(/<[^>]*>/g, '')), 'the uploading message flashes and carries no count');
    assert(/Nothing new has reached the Drive folder for 2 minutes — 54 new files\./.test(done) && /data-drive-import-now/.test(done) && !/data-drive-later/.test(done) && !/tripsy-menu-flash/.test(done), 'the completion message replaces it, with an Import now button and no Later (the import starts by itself)');
    assert(/tripsy-menu-flash/.test(lat) && !/data-drive-later|'later'/.test(html), 'there is no Later phase any more (2026-10-27: a settled folder imports itself)');
    assert(/inboxWatch\.phase = tripsyFlyoverDrivePhase\(inboxWatch\.phase, r, fresh\);\s*paintDriveStatus\(\);\s*if \(inboxWatch\.phase === 'complete' && runFinishUpload && !driveImportRunning && freshFiles\.some\(f => !autoImportTried\.has\(f\.id\)\)\) runFinishUpload\(\);/.test(setup) && /for \(const f of files\) autoImportTried\.add\(f\.id\);/.test(setup),
      'THE ASK: a settled folder is imported automatically, and files an auto-run already tried are not tried again until a new one arrives');
    assert(!/tripsyFlyoverFinishUploadLabel|announceInboxReady|tripsyConfirmDialog\(`Drive upload looks complete/.test(html), 'the live-count label and the completion dialog are gone');
    assert(/const files = await tripsyFlyoverListInbox\(record\.inboxFolderId\);[\s\S]*const freshFiles = tripsyFlyoverDriveNewFiles\(files, record\);\s*const fresh = freshFiles\.length;[\s\S]*?let r = tripsyFlyoverInboxWatchStep\(inboxWatch\.state, fresh, Date\.now\(\), TRIPSY_FLYOVER_INBOX_SETTLE_MS, newestMs\);[\s\S]*inboxWatch\.phase = tripsyFlyoverDrivePhase\(inboxWatch\.phase, r, fresh\);\s*paintDriveStatus\(\);/.test(setup),
      'each tick lists the inbox, counts what is new, moves the phase and repaints the message slot');
    assert(/<span data-flyover-drive-status[^>]*>\$\{driveStatusHtml\(\)\}<\/span>/.test(setup) && /if \(go\) go\.onclick = \(\) => \{ if \(!closed && runFinishUpload && !driveImportRunning\) runFinishUpload\(\); \};/.test(setup) && !/data-drive-later/.test(setup),
      'the slot renders in the header; Import now runs the import; there is no Later');
    assert(/inboxWatch\.timer = setTimeout\(inboxWatchTick, TRIPSY_FLYOVER_INBOX_POLL_MS\);/.test(setup) && /document\.visibilityState !== 'hidden'/.test(setup), 'the watcher polls on a timer and skips the list while the page is hidden');
    assert(/const onInboxVisibility = \(\) => \{ if \(document\.visibilityState === 'visible' && inboxWatch && !inboxWatch\.busy\) inboxWatchTick\(\); \};\s*document\.addEventListener\('visibilitychange', onInboxVisibility\);/.test(setup), 'returning to the app checks the folder at once');
    assert(/const close = \(\) => \{ closed = true;[^\n]*stopInboxWatch\(\); document\.removeEventListener\('visibilitychange', onInboxVisibility\);/.test(setup), 'closing the page stops the watcher and drops its listener');
    assert(/save\(\); render\(\);\s*setStatus\(''\);\s*startInboxWatch\(\);/.test(setup) && /askMissingModes\(\);\s*startInboxWatch\(\);/.test(setup), 'the watcher starts on a hand-off and on opening a page with one pending');
    assert(/driveImportRunning = true;\s*stopInboxWatch\(\);/.test(setup) && /inboxPendingAt: '' \};\s*inboxFolderKnown = '';\s*save\(\);\s*stopInboxWatch\(\);/.test(setup), 'an import stops the watcher, and clearing the hand-off ends it');
    assert(/if \(inboxWatch \|\| closed \|\| !isOwner \|\| !record \|\| !record\.inboxPendingAt \|\| !record\.inboxFolderId\) return;/.test(setup), 'only the owner, with a pending hand-off, watches — and never twice');
    assert(/if \(prevRecord && prevRecord\.inboxPendingAt\) \{ rec\.inboxPendingAt = prevRecord\.inboxPendingAt; rec\.inboxDest = prevRecord\.inboxDest \|\| 'auto';/.test(html), 'a rebuild keeps a pending hand-off');
    const hand = extractFn('tripsyFlyoverDriveHandoffDialog');
    assert(/data-drive-open/.test(hand) && /Photos and Videos/.test(hand) && /imports them by itself once the upload is complete/.test(hand) && !/Finish Upload/.test(hand) && /data-handoff-picker/.test(hand), 'the hand-off dialog links the folder, gives the Drive app steps, says the page imports by itself when complete, and offers the Photos picker instead');
    // "When I select upload photos through Google Drive, can the app open the drive folder for
    // me instead of making me press the link" (2026-10-26) -- and it lands in the Google Drive
    // APP on the iPad (screenshot, same day), so it stays.
    const hod = setup.slice(setup.indexOf('const handOffToDrive = async'), setup.indexOf('tripsyFlyoverDriveHandoffDialog(', setup.indexOf('const handOffToDrive = async')));
    assert(hod.indexOf('window.open(') > 0 && hod.indexOf('window.open(') < hod.indexOf('await '), 'THE ASK: the Drive route opens a window BEFORE its first await, inside the tap (a later open is blocked)');
    assert(/if \(inboxFolderKnown\) \{ tab = window\.open\(tripsyFlyoverDriveFolderUrl\(inboxFolderKnown\), '_blank'\); if \(tab\) \{ tab\.opener = null; openedDirect = inboxFolderKnown; \} \}/.test(hod) && !/'_blank', 'noopener'/.test(hod) && /else \{ tab = window\.open\('', '_blank'\);/.test(hod) && /tab\.location\.href = tripsyFlyoverDriveFolderUrl\(folderId\)/.test(hod),
      'a known folder opens straight away; otherwise a blank tab opens now and is pointed at the folder once it exists');
    assert(/if \(tab && !openedDirect\) \{ try \{ tab\.close\(\); \}/.test(hod), 'a blank tab is closed again when the folder cannot be reached');
    assert(/inboxPrefetch = tripsyFlyoverInboxFolder\(trip, record, \{ create: false \}\)/.test(setup) && /if \(!create\) return null;/.test(extractFn('tripsyFlyoverInboxFolder')),
      'the folder is looked up (never created) while the source question is up, so the Drive answer can open it in the same tap');
    assert(/\{ onPickerInstead: openPicker, opened \}\)/.test(setup) && /opened \? 'The folder has been opened for you in the Drive app' : 'Open the folder'/.test(hand), 'the hand-off dialog says the folder was opened, keeping the link as a fallback');
    // The first 30-item upload reached the Drive app and never landed (2026-10-26): the steps
    // say to stay in the Drive app until its upload bar finishes, and give Photos → Share → Drive.
    // The 30-item pick that never landed had been dismissed at the Drive app's confirmation
    // screen; the 3- and 1-photo tests landed within seconds with NO progress bar (screenshots,
    // 2026-10-26), so the steps name the Upload button and a time rule, not a bar.
    assert(/tap Upload in the top-right corner of the next screen<\/strong> — nothing is sent until you do/.test(hand) && !/upload bar/.test(hand) && /don’t swipe it away in the app switcher/.test(hand), 'the steps say to tap Upload on the confirmation screen, give the Drive app a minute, and never swipe it away -- and promise no progress bar');
  }

  // ---- A failed background upload NAMES its reason on the card ("The app says the upload
  // failed," 2026-10-26: seven Drive-imported photos sat with ⚠️ badges and no way to tell why
  // from the iPad), and an un-resizable photo goes up resumably past 4 MB ----
  {
    eval(extractFn('tripsyFlyoverUploadFailureReason'));
    assert(tripsyFlyoverUploadFailureReason(new Error('Drive upload failed (403)'), { type: 'image/jpeg', size: 300000 }) === 'Drive upload failed (403)', 'a resized copy reports just the error');
    assert(/^Load failed \(the photo could not be resized — image\/heic, 3418 KB sent as is\)$/.test(tripsyFlyoverUploadFailureReason(new Error('Load failed'), { type: 'image/heic', size: 3500000 })), 'THE ASK: an original that could not be resized says so, with its type and size');
    assert(tripsyFlyoverUploadFailureReason(null, null) === 'unknown error' && tripsyFlyoverUploadFailureReason({ message: 'x'.repeat(400) }, null).length === 160, 'no error and a long message are bounded');
    const run = extractFn('tripsyFlyoverRunUpload');
    assert(/tripsyFlyoverFailedUploadReasons\.set\(pendingId, tripsyFlyoverUploadFailureReason\(e, small\)\)/.test(run) && /tripsyFlyoverFailedUploadReasons\.set\(pendingId, tripsyFlyoverUploadFailureReason\(e, null\)\)/.test(run) && /tripsyFlyoverFailedUploadReasons\.delete\(pendingId\);/.test(extractFn('tripsyFlyoverQueueUpload')), 'photo and video failures record a reason; a retry clears it');
    assert(/const mime = small\.type && \/\^image\\\/\/i\.test\(small\.type\) \? small\.type : 'image\/jpeg';/.test(run) && /small\.size > 4 \* 1024 \* 1024\s*\? await uploadBlobToDriveResumable\(small, name, mime, \(\) => \{\}\)\s*: await uploadBlobToDrive\(small, name, mime\)/.test(run), 'the prepared copy keeps its real type, and an original past 4 MB takes the resumable upload (the multipart body is capped at 5 MB)');
    assert(/failed\$\{\(\(\) => \{ const why = failedIds\.map\(fid => tripsyFlyoverFailedUploadReasons\.get\(fid\)\)\.find\(Boolean\); return why \? `: \$\{esc\(why\)\}` : ''; \}\)\(\)\}\./.test(extractFn('showTripsyFlyover')), 'THE ASK: the card\'s "N uploads failed" line carries the first recorded reason');
  }

  // ---- Storm tracking was removed ("Remove tracking for the typhoon from flyover," 2026-10-25) ----
  assert(!/TRIPSY_FLYOVER_STORM|showStorms|clearStorms|tfo-storm|data-flyover-storms|tripsyFlyoverLegStorms/.test(html), 'THE ASK: no storm is plotted on the fly-over and the setup page carries no storm note');
}
