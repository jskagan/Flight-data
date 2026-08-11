const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- wiring assertions against the file itself ----
assert(/if \(isOwner\) pruneDriveDataInMemory\(null\);/.test(html),
  'sign-in runs the trip-blind pass, owner only');
assert(/if \(isOwner\) pruneDriveDataInMemory\(tripsyDecryptedTrips\);/.test(html),
  'trips load runs the trip-aware pass, owner only');
// The prune must NOT persist -- it rides on the next write that happens anyway.
const src = extractFn('pruneDriveDataInMemory');
assert(!/persistDriveData/.test(src), 'the prune itself never writes to Drive');

// ---- behaviour, executed ----
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
global.tripsyTripsAreOffline = false;
const mk = () => ({
  trips: [{ name: 'relic' }],
  tripsyKnownFlights: { 1: {} },
  tripsyEmailIntake: [
    { id: 'a', parsedAt: 'x', body: 'parsed body goes' },
    { id: 'b', body: 'unparsed body stays' },
    { id: 'c', parsedAt: 'x' }, // no body at all
  ],
  tripsyPlacePhotoCache: {
    big: { photoName: 'p', triedPhotoNames: Array.from({ length: 103 }, (_, i) => 't' + i) },
    small: { photoName: 'p', triedPhotoNames: ['t1', 't2'] },
    bare: { photoName: 'p' },
  },
  tripsyWeatherCache: { ['1,2::' + day(-30)]: {}, ['1,2::' + day(-1)]: {}, ['1,2::' + day(3)]: {}, 'malformed': {} },
  tripsyWeatherHourly: { ['1,2::' + day(-30)]: {} },
  tripsyNarrativeCache: {
    'tripsy-1::intro': 'kept', 'tripsy-1::day::2020-01-01': 'kept', 'tripsy-GONE::intro': 'dropped',
  },
});
const run = (trips) => {
  global.driveData = mk();
  eval(src.replace(/^function pruneDriveDataInMemory/, 'global.__prune = function'));
  global.__prune(trips);
  return global.driveData;
};

let d = run(null);
assert(!('trips' in d), 'the readerless trips relic is deleted');
assert(!('tripsyKnownFlights' in d), 'so is tripsyKnownFlights');
assert(!('body' in d.tripsyEmailIntake[0]), 'a parsed email loses its body');
assert(d.tripsyEmailIntake[0].id === 'a' && d.tripsyEmailIntake[0].parsedAt, 'but keeps its id (the dedup key) and parsedAt');
assert(d.tripsyEmailIntake[1].body === 'unparsed body stays', 'an UNPARSED body is untouched -- the routine still needs it');
assert(d.tripsyEmailIntake[2].id === 'c', 'a bodyless parsed entry is fine');
assert(d.tripsyPlacePhotoCache.big.triedPhotoNames.length === 20, 'a runaway triedPhotoNames is capped at 20');
assert(d.tripsyPlacePhotoCache.big.triedPhotoNames[19] === 't102', 'keeping the most RECENT, not the oldest');
assert(d.tripsyPlacePhotoCache.small.triedPhotoNames.length === 2, 'a short list is untouched');
assert('bare' in d.tripsyPlacePhotoCache, 'an entry with no list at all survives');
assert(!(('1,2::' + day(-30)) in d.tripsyWeatherCache), 'weather >14 days past is dropped');
assert(('1,2::' + day(-1)) in d.tripsyWeatherCache && ('1,2::' + day(3)) in d.tripsyWeatherCache,
  'recent past and future weather stay');
assert('malformed' in d.tripsyWeatherCache, 'a malformed key is left alone rather than guessed at');
assert(!(('1,2::' + day(-30)) in d.tripsyWeatherHourly), 'hourly cache pruned by the same rule');
// trip-blind pass: narrative untouched
assert('tripsy-GONE::intro' in d.tripsyNarrativeCache,
  'with NO trips loaded, narrative rows are never judged');

// trip-aware pass
d = run([{ key: 'tripsy-1' }]);
assert(!('tripsy-GONE::intro' in d.tripsyNarrativeCache), 'a row for a vanished trip is dropped');
assert(d.tripsyNarrativeCache['tripsy-1::intro'] === 'kept'
  && d.tripsyNarrativeCache['tripsy-1::day::2020-01-01'] === 'kept',
  'rows for a live trip are kept, intro and day alike');
// empty trips array = no judgement (a failed load must not wipe every cache)
d = run([]);
assert('tripsy-GONE::intro' in d.tripsyNarrativeCache, 'an EMPTY trips list judges nothing');
// offline cache = no judgement either
global.tripsyTripsAreOffline = true;
d = run([{ key: 'tripsy-1' }]);
assert('tripsy-GONE::intro' in d.tripsyNarrativeCache, 'an offline (stale) trips cache judges nothing');
global.tripsyTripsAreOffline = false;
// a null driveData is a no-op, not a crash
global.driveData = null;
global.__prune(null);
assert(true, 'null driveData is survived');
