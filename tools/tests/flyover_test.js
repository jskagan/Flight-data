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
const sliceStart = Math.min(...['TRIPSY_CITY_STATES','TRIPSY_STATE_CITIES','TRIPSY_COUNTRY_NAMES','TRIPSY_COUNTRY_ALIASES','TRIPSY_STREET_SUFFI']
  .map(n => html.indexOf('const ' + n + ' =')).filter(i => i >= 0));
const extractorEnd = html.indexOf(extractFn('tripsyPrimaryCityFromAddress')) + extractFn('tripsyPrimaryCityFromAddress').length;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function isTripsyEventEffectivelyHidden(ev) { return !!ev.hidden; }
eval([
  (html.match(/const TV_STRIP_LOC = new Set\(\[[\s\S]*?\]\);/) || [''])[0],
  html.slice(sliceStart, extractorEnd),
  constLine('TRIPSY_FLYOVER_MODE_RANK'), constLine('TRIPSY_FLYOVER_MERGE_KM'),
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
assert(sk.map(s => s.kind).join(',') === 'origin,stay,return' && sk[1].mode === 'plane',
  'a date-only stay still gets its origin, one stay for duplicate records, and a flight in -> ' + sk.map(s => s.kind + ':' + s.label + ':' + s.mode).join(' | '));
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
assert(/btn\.dataset\.mode === 'view'[\s\S]{0,300}playTripsyFlyover\(trip, record\)/.test(html), 'View plays the fly-over straight away');
assert(/container\.querySelectorAll\("\[data-tripsy-flyover\]"\)[\s\S]{0,700}showTripsyFlyover\(btn\.dataset\.key\)/.test(html), 'Start/Finish/Edit open the setup page');
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
eval([extractFn('tripsyFlyoverItineraryPhotoFor'), extractFn('tripsyFlyoverSeedItineraryPhotos')].join('\n'));
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
assert(/autoPhotoSeeded: !!p\.autoPhotoSeeded/.test(extractFn('tripsyFlyoverCarryOver')), 'a rebuild carries the offered flag, so a deleted photo stays deleted');
assert(/tripsyFlyoverSeedItineraryPhotos\(record, trip, tripsyTodayDayKey\(\), driveData\.tripsyPlacePhotoCache\)/.test(extractFn('showTripsyFlyover')), 'the setup page seeds on open and after a build');

// ---- per-destination slideshow: layout, transition, timing (2026-10-20) ----
eval([constLine('TRIPSY_FLYOVER_PHOTO_MS'), constLine('TRIPSY_FLYOVER_SECONDS_MIN'), constLine('TRIPSY_FLYOVER_SECONDS_MAX'),
  (html.match(/const TRIPSY_FLYOVER_LAYOUTS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0],
  extractFn('tripsyFlyoverSlideshowConfig'), extractFn('tripsyFlyoverPhotoGroups')].join('\n'));
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
  assert(/const cfg = tripsyFlyoverSlideshowConfig\(s\);\s*for \(const group of tripsyFlyoverPhotoGroups\(photos, cfg\.layout\)\)/.test(player), 'each destination plays with its OWN settings');
  assert(/const ms = Math\.round\(cfg\.seconds \* 1000\);[\s\S]*const ok = await wait\(r, ms\);/.test(player), 'each screen holds for the chosen seconds, pause-aware');
  assert(/g\.dataset\.layout = cfg\.layout;\s*g\.dataset\.tr = cfg\.transition;/.test(player), 'the layout and transition drive the screen\'s CSS');
  assert(/ov\.classList\.toggle\('tfo-paused', run\.paused\)/.test(player) && /\.tfo-paused \* \{ animation-play-state: paused !important; \}/.test(html), 'pause also freezes the pan-and-zoom animation');
  assert(/if \(preview\) stops = stops\.filter\(s => s\.id === opts\.previewStopId\);/.test(player), 'Preview plays just that destination');
  for (const k of ['slide', 'zoom', 'none']) assert(html.includes(`.tfo-group[data-tr="${k}"]`), `the ${k} transition has its CSS`);
  for (const k of ['pair', 'grid', 'collage']) assert(html.includes(`.tfo-group[data-layout="${k}"]`), `the ${k} layout has its CSS`);
  const setup = extractFn('showTripsyFlyover');
  assert(/data-flyover-layout/.test(setup) && /data-flyover-transition/.test(setup) && /data-flyover-seconds/.test(setup) && /data-flyover-preview/.test(setup),
    'the setup page offers layout, transition, seconds and a Preview per destination');
  assert(/updateStop\(id, \{ slideshow: \{ \.\.\.tripsyFlyoverSlideshowConfig\(stop\(\)\), \.\.\.fields \} \}\);/.test(setup), 'a change saves onto that one stop');
}

// ---- map tiles: keyless, with a fallback (2026-10-20: "I get a message saying api key
// required when I try to play the trip" -- CARTO's free tiles now draw that onto every tile) ----
{
  assert(!/cartocdn/.test(html), 'CARTO tiles are gone entirely');
  const srcBlock = (html.match(/const TRIPSY_FLYOVER_TILE_SOURCES = \[[\s\S]*?\n\];/) || [''])[0];
  assert(/tile\.openstreetmap\.org/.test(srcBlock) && /arcgisonline\.com/.test(srcBlock) && !/key|token/i.test(srcBlock.replace(/rel="noopener"/g, '')),
    'OpenStreetMap first, Esri second, neither carrying a key');
  eval([srcBlock, constLine('TRIPSY_FLYOVER_TILE_FAIL_LIMIT'), extractFn('tripsyFlyoverAddTiles')].join('\n'));
  const added = [];
  const fakeL = { tileLayer: (url) => { const h = {}; const layer = { url, on: (ev, fn) => { h[ev] = fn; return layer; }, addTo: () => { added.push(layer); return layer; }, fire: ev => h[ev] && h[ev]() }; return layer; } };
  const removed = [];
  const fakeMap = { removeLayer: l => removed.push(l.url) };
  const first = tripsyFlyoverAddTiles(fakeL, fakeMap);
  for (let i = 0; i < 3; i++) first.fire('tileerror');
  assert(added.length === 1, 'a few failed tiles alone don\'t switch sources');
  first.fire('tileerror');
  assert(added.length === 2 && /arcgisonline/.test(added[1].url) && removed[0] === first.url, 'a run of failures before any tile loads switches to the fallback source');
  for (let i = 0; i < 10; i++) added[1].fire('tileerror');
  assert(added.length === 2, 'the last source is kept rather than leaving the map blank');
  added.length = 0;
  const ok = tripsyFlyoverAddTiles(fakeL, fakeMap);
  ok.fire('tileload');
  for (let i = 0; i < 10; i++) ok.fire('tileerror');
  assert(added.length === 1, 'once tiles have loaded, later stray errors never swap the map out');
  assert(/tripsyFlyoverAddTiles\(L, map\);/.test(extractFn('playTripsyFlyover')), 'the player adds its tiles through the fallback helper');
}
