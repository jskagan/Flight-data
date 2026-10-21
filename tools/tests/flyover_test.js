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
  assert(/const ms = Math\.round\(page\.seconds \* 1000\);[\s\S]*return wait\(r, Math\.max\(0, ms - tMs\)\);/.test(player), 'each page holds for its own seconds, pause-aware');
  assert(/g\.dataset\.layout = layout;\s*g\.dataset\.tr = enterTr;/.test(player), 'the page\'s layout and entering transition drive its CSS');
  assert(/ov\.classList\.toggle\('tfo-paused', run\.paused\)/.test(player) && /\.tfo-paused \* \{ animation-play-state: paused !important; \}/.test(html), 'pause also freezes the pan-and-zoom animation');
  assert(/if \(preview\) stops = stops\.filter\(s => s\.id === opts\.previewStopId\);/.test(player), 'Preview plays just that destination');
  for (const k of ['slide', 'zoom', 'none']) assert(html.includes(`.tfo-group[data-tr="${k}"]`), `the ${k} transition has its CSS`);
  for (const k of ['pair', 'grid', 'collage']) assert(html.includes(`.tfo-group[data-layout="${k}"]`), `the ${k} layout has its CSS`);
  const setup = extractFn('showTripsyFlyover');
  assert(/data-flyover-slideshow/.test(setup) && /data-flyover-preview/.test(setup) && /tripsyFlyoverSlideshowSummary\(s\)/.test(setup),
    'each destination shows how its photos play, with Slideshow options and Preview buttons');
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
  assert(/tripsyFlyoverAddTiles\(L, map\)/.test(extractFn('playTripsyFlyover')), 'the player adds its tiles through the fallback helper');
}

// ---- options when photos are added: "some may be one per page and others several in a
// page, and how to transition" (2026-10-20) ----
eval([constLine('TRIPSY_FLYOVER_PHOTO_MS'), constLine('TRIPSY_FLYOVER_SECONDS_MIN'), constLine('TRIPSY_FLYOVER_SECONDS_MAX'),
  (html.match(/const TRIPSY_FLYOVER_LAYOUTS = \[[\s\S]*?\];/) || [''])[0],
  (html.match(/const TRIPSY_FLYOVER_TRANSITIONS = \[[\s\S]*?\];/) || [''])[0],
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
  assert(/veilEl\.classList\.add\('tfo-show'\)/.test(player) && /const endSlideshow = async r => \{\s*veilEl\.classList\.remove\('tfo-show'\)/.test(player)
    && /\.tfo-group \{[^}]*background: #0b1020/.test(html), 'a dark backdrop stays up for the whole slideshow and every page is opaque');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
  assert(/How many pictures on page/.test(dlg) && /data-ss-count/.test(dlg) && /data-ss-photo/.test(dlg) && /Transition to page \$\{cur \+ 2\}/.test(dlg)
    && /data-ss-seconds/.test(dlg) && /data-ss-next/.test(dlg) && /data-ss-prev/.test(dlg) && /data-ss-preview/.test(dlg),
    'THE ASK: page by page -- how many pictures, which ones, the transition to the next page and the time on screen');
  assert(/done\(\{ pages: cleaned\(\), photos \}\)/.test(dlg) && /data-ss-cancel[\s\S]*done\(null\)/.test(dlg), 'Save returns the pages, Cancel changes nothing');
  assert(/slideshow: \{ \.\.\.p\.slideshow \}/.test(extractFn('tripsyFlyoverCarryOver')) && /pages: p\.pages\.map/.test(extractFn('tripsyFlyoverCarryOver')),
    'rebuilding the destinations keeps each one\'s pages and settings');
  const setup = extractFn('showTripsyFlyover');
  assert(/if \(!closed\) \{ render\(\); openSlideshowOptions\(id, `\$\{done\} item/.test(setup), 'THE ASK: adding your own photos opens the options box straight away');
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
  const iosArchive = tripsyFlyoverMusicFader(fakeAudio(false), { AudioCtx: function () {} });
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
    // iOS + a local copy: routed through a gain node once the context runs
    const b = fakeAudio(false); b.src = 'blob:abc';
    let connected = 0;
    const gainNode = { gain: { value: 1 }, connect() { connected++; } };
    function Ctx() { this.state = 'suspended'; this.destination = {}; }
    Ctx.prototype.resume = function () { this.state = 'running'; return Promise.resolve(); };
    Ctx.prototype.createMediaElementSource = () => ({ connect() { connected++; } });
    Ctx.prototype.createGain = () => gainNode;
    const g = tripsyFlyoverMusicFader(b, { AudioCtx: Ctx });
    g.begin(100);
    assert(b.muted, 'iOS: the song starts muted while the audio context starts');
    await new Promise(res => setTimeout(res, 10));
    assert(g.mode === 'gain' && connected === 2 && !b.muted, 'then it is routed through a gain node and unmuted');
    await new Promise(res => setTimeout(res, 200));
    assert(Math.abs(gainNode.gain.value - 0.7) < 0.01, 'and fades in by gain');
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
  assert(/tripsyFlyoverMusicUrlCache\.set\(music\.url/.test(extractFn('tripsyFlyoverPrefetchMusic')), 'a found song is copied locally when it can be, so iOS can fade it');
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
  assert(/const ordered = tripsyFlyoverPhotosInPageOrder\(s\);/.test(setup) && /ordered\.map\(\(\{ photo: p, page \}\)/.test(setup) && />Page \$\{page\}<\/span>/.test(setup)
    && /<div class="btn" style="padding:3px; position:relative; cursor:default;">\s*\$\{tripsyFlyoverThumbHtml\(p, 84, 64, 'border-radius:5px;'\)\}/.test(setup),
    'the setup page lists each destination\'s photos in play order, drawn like the page dialog\'s grid (framed, "Page N" badge)');
  assert(/data-flyover-photo-remove="\$\{esc\(p\.driveFileId\)\}"/.test(setup) && /ph\.driveFileId !== fid/.test(setup),
    'removing a photo goes by its id, not its position (the order on screen is no longer the stored order)');
  assert(/photos: tripsyFlyoverPhotosInPageOrder\(\{ \.\.\.st, pages: r\.pages, photos: r\.photos \}\)\.map\(x => x\.photo\)/.test(setup),
    'Save stores the photos in the new page order');
  assert(/const photos = tripsyFlyoverPhotosInPageOrder\(stop\)\.map/.test(extractFn('tripsyFlyoverSlideshowDialog')), 'the page dialog\'s grid opens in play order too');
}

// ---- Save buttons on the fly-over page ("There should be save buttons on the flyover page,"
// 2026-10-21) ----
{
  const setup = extractFn('showTripsyFlyover');
  assert(/class="tripsy-close-x tripsy-save-check" data-flyover-save[^>]*>✓<\/button>` : ''\}\s*<button class="tripsy-close-x" data-flyover-close/.test(setup),
    'THE ASK: a green ✓ Save sits beside the ✕ at the top');
  assert(/<div class="tfo-ss-footer"[^>]*>\s*<button class="btn" data-flyover-close>Close<\/button>\s*<button class="btn" data-flyover-save[^>]*>Save<\/button>/.test(setup),
    'and Close / Save sit in a pinned footer at the bottom');
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
  assert(/el\.onpointerdown/.test(dlg) && /el\.onpointermove/.test(dlg) && /el\.onpointerup = \(\) => end\(false\)/.test(dlg) && /holdMs \? 'manipulation' : 'none'/.test(dlg),
    'drag runs on pointer events (a finger on iPad works like a mouse) and the page strip doesn\'t scroll while dragging');
  assert(/tripsyFlyoverMovePage\(pages, from, to, cur\)/.test(dlg) && /suppressTapUntil = Date\.now\(\) \+ 400/.test(dlg),
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
  assert(/if \(drag && drag\.el === el && drag\.held\) e\.preventDefault\(\);/.test(dlg) && /\{ passive: false \}/.test(dlg), 'once held, the finger drags instead of scrolling');
  assert(/data-ss-photo\]'\)\.forEach\(b => b\.onclick = \(\) => \{\s*if \(Date\.now\(\) < suppressTapUntil\) return;/.test(dlg), 'the release that ends a drag is not also a tap');
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
    && /tfo-ss-ins-before/.test(dlg), 'the grid drops in between at an edge, shown as a green bar, and swaps in the middle');
}

// ---- an in-between move shows ONLY a vertical dashed line ("just show a vertical dashed line
// between the pages it will be moved between," 2026-10-21) ----
{
  assert(/\.tfo-ss-ins-before::before, \.tfo-ss-ins-after::after \{[^}]*border-left: 3px dashed #3AA76D/.test(html) && !/\.tfo-ss-ins-before::before[^}]*background:/.test(html),
    'THE ASK: the in-between marker is a vertical dashed line in the gap, nothing else');
  const dlg = extractFn('tripsyFlyoverSlideshowDialog');
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
}
{
  const play = extractFn('playTripsyFlyover');
  assert(/const via = b\.mode === 'plane' \? \(b\.via \|\| \[\]\) : \[\];/.test(play), 'only a flight leg is drawn through its layovers');
  assert(/L\.latLngBounds\(\[\[a\.lat, a\.lng\], \.\.\.via\.map/.test(play), 'the leg is framed WITH its layovers (no zoom into them)');
  const loop = play.slice(play.indexOf('for (const v of via)'), play.indexOf('from = v;'));
  assert(/animateLeg\(r, from, v, 'plane'\)/.test(loop) && /tfo-via-label/.test(loop) && !/flyTo|showPage|showCard|arrive\(/.test(loop),
    'at a layover: fly there, show the city name, no zoom, no card, no photos');
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
  assert(/const save = \(\) => \{\s*Store\.stageTripsyFlyover\(record\);/.test(setup)
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
  assert(iClose > iEndMap && /arrive\(r, b, stayNo\(b\), !\(closeWithPhotos && b === last\)\)/.test(play)
    && play.indexOf("'The end'") > iClose,
    'the last destination\'s pictures play after the closing map, before "The end"');
  assert(!/detectRetina: true/.test(extractFn('tripsyFlyoverAddTiles')) && /zoomSnap: 1 \}/.test(play),
    'tiles are fetched at the zoom shown (no retina offset, which left gaps) and only whole zoom levels are used');
  assert(/showDestLabel\(s\);[\s\S]*?untilTilesLoaded\(r, 1500\)/.test(play),
    'arriving names the destination beside its dot and lets the tiles land before photos cover the map');
  const iLeg = play.indexOf('const legBounds'), iClear = play.indexOf('clearDestLabel();', iLeg);
  assert(iClear > iLeg && iClear < play.indexOf('map.flyToBounds(legBounds', iLeg)
    && /clearDestLabel\(\);\s*if \(!\(await untilMoveEnd\(r, \(\) => map\.flyToBounds\(all/.test(play),
    'the destination name is taken away before the map pulls back out (next leg, and the closing map)');
  assert(/\.tfo-dest-label\.tfo-grow span \{[^}]*scale\(1\.35\)/.test(html), 'and it grows as the map zooms in');
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
