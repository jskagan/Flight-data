// "On October 12 the itinerary has the hotel stay listed before the
// transportation to the hotel. That is not supposed to happen" (2026-09-27).
// A hotel's stored check-in time is the property's NOMINAL check-in hour
// (3:00 PM), which can predate the very flights/car that get you there --
// the real day read: prior hotel's Check-out 12:00, flight 12:25, [Check-in
// 3:00 PM <- WRONG], flight 5:00, car-to-the-hotel 6:20. The fix already
// existed for the My Trips timeline (placeTripsyLodgingNextToTransfers, a
// post-sort MOVE keyed on the transfer's endpoint naming the lodging) but
// was deliberately timeline-only; it now also runs in buildTripsyPrintDayData
// (itinerary print/preview/summary/partial, diary, narrative prompts, attire
// day list) and in Travel View, so no surface disagrees about the order.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  const start = m.index;
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
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the pass runs on EVERY ordering surface ----
{
  const build = extractFn('buildTripsyPrintDayData');
  assert(/placeTripsyLodgingNextToTransfers\(insertTripsyLayovers\(chronologicalEvents\)\)/.test(build),
    'THE FIX: buildTripsyPrintDayData applies the lodging-next-to-its-transfer move (after layovers, same as the timeline)');
  assert((html.match(/placeTripsyLodgingNextToTransfers\(/g) || []).length >= 4,
    'the pass runs on the My Trips timeline, the print day data, and Travel View (plus its own definition)');
  assert(!/Timeline-only, like insertTripsyFlightArrivals/.test(html),
    'the old "timeline-only" claim is gone from the pass\'s comment');
}

// ---- executed: the real Oct 12 shape, through the exact print pipeline ----
{
  // Extract the whole pipeline. tripsyPrimaryCityFromAddress is the real one,
  // so city matching behaves exactly as in the app.
  // tripsyPrimaryCityFromAddress leans on a cluster of address tables; take
  // the file's contiguous slice from the first table through the function
  // itself, the same way favorites_test.js does.
  const cityTableNames = ['TRIPSY_CITY_STATES', 'TRIPSY_STATE_CITIES', 'TRIPSY_COUNTRY_NAMES', 'TRIPSY_COUNTRY_ALIASES', 'TRIPSY_STREET_SUFFI'];
  const sliceStart = Math.min(...cityTableNames.map(n => html.indexOf('const ' + n + ' =')).filter(i => i >= 0));
  const cityFnSrc = extractFn('tripsyPrimaryCityFromAddress');
  // TV_STRIP_LOC is declared much later in the file (a Travel View constant);
  // fine in the browser, but a slice has to fetch it separately.
  eval((html.match(/const TV_STRIP_LOC = new Set\(\[[\s\S]*?\]\);/) || [''])[0].replace(/^const /, 'var '));
  eval(html.slice(sliceStart, html.indexOf(cityFnSrc) + cityFnSrc.length)
    .replace(/^function tripsyPrimaryCityFromAddress/m, 'var tripsyPrimaryCityFromAddress = function'));
  const names = ['parseTripLocalParts', 'tripsyDayKey', 'tripsyIsFlightEvent', 'expandMultiDayTripsyEvents',
    'tripsyLodgingCityLower', 'tripsyDescMatchesCity',
    'tripsyLodgingTransportOrder', 'tripsyMultiDayEventOrder', 'tripsyTimelineSortComparator',
    'tripsyDescMatchesLodgingName', 'tripsyTransferSideForLodging', 'placeTripsyLodgingNextToTransfers'];
  for (const n of names) {
    const src = extractFn(n);
    if (!src) { assert(false, `could not extract ${n}`); }
    eval(src.replace(/^(async )?function /, `var ${n} = $1function `));
  }
  // insertTripsyLayovers depends on the airport-pairing machinery; the pass
  // only needs to SEE its output shape, so give it a pairless run (the glue
  // skip is asserted separately below).
  var tripsyFindLayoverPairs = () => new Map();
  eval(extractFn('insertTripsyLayovers').replace(/^function /, 'var insertTripsyLayovers = function '));

  // Synthetic mirror of the real day (names changed; same structure).
  const trans = (id, num, depDesc, arrDesc, dep, arr, category = 'airplane') => ({
    id: `transportation-${id}`, type: category === 'airplane' ? 'flight' : 'transportation',
    summary: `${category === 'airplane' ? 'Flight' : 'Car'} from ${depDesc} to ${arrDesc}`,
    start: dep, end: arr,
    tripsyRaw: { resource: 'transportation', id, category, transportNumber: num,
      departureDescription: depDesc, departureAt: dep, arrivalDescription: arrDesc, arrivalAt: arr },
  });
  const events = [
    { id: 'hosting-1', type: 'hotel', summary: 'City Grand Hotel',
      start: '2026-10-08T15:00:00', end: '2026-10-12T12:00:00',
      tripsyRaw: { resource: 'hosting', id: 1, name: 'City Grand Hotel', address: '1 Marina Way, Singapore' } },
    trans(2, 'XX404', 'SIN', 'BKK', '2026-10-12T12:25:00', '2026-10-12T13:45:00'),
    { id: 'hosting-3', type: 'hotel', summary: 'Riverside Tented Lodge Golden Valley',
      start: '2026-10-12T15:00:00', end: '2026-10-17T12:00:00',
      tripsyRaw: { resource: 'hosting', id: 3, name: 'Riverside Tented Lodge Golden Valley',
        address: '499 Moo 1, Chiang Saen District, 57150, Chiang Rai, Thailand' } },
    trans(4, 'XX136', 'BKK', 'CEI', '2026-10-12T17:00:00', '2026-10-12T18:20:00'),
    trans(5, 'XX136', 'Chiang Rai Airport (arriving Flight XX136)', 'Riverside Tented Lodge',
      '2026-10-12T18:20:00', '2026-10-12T19:20:00', 'car'),
  ];

  // The exact statement buildTripsyPrintDayData now runs.
  const chronological = expandMultiDayTripsyEvents(events).sort(tripsyTimelineSortComparator);
  const sorted = placeTripsyLodgingNextToTransfers(insertTripsyLayovers(chronological));
  const day12 = sorted.filter(e => tripsyDayKey(e.start) === '2026-10-12').map(e => e.id);
  assert(day12.join(',') === 'hosting-1-checkout,transportation-2,transportation-4,transportation-5,hosting-3-checkin',
    `THE FIX: Oct 12 reads checkout -> flight -> flight -> car -> Check-in, never the 3:00 PM nominal Check-in above the transport that gets you there (got: ${day12.join(',')})`);

  // Without the transfer car (nothing names the lodging, and the flights'
  // airport codes can't match its city), the order stays purely by time --
  // the pass never invents a move it has no evidence for.
  const noCar = events.filter(e => e.id !== 'transportation-5');
  const sortedNoCar = placeTripsyLodgingNextToTransfers(
    insertTripsyLayovers(expandMultiDayTripsyEvents(noCar).sort(tripsyTimelineSortComparator)));
  const day12NoCar = sortedNoCar.filter(e => tripsyDayKey(e.start) === '2026-10-12').map(e => e.id);
  assert(day12NoCar.join(',') === 'hosting-1-checkout,transportation-2,hosting-3-checkin,transportation-4',
    'with no evidence tying a transport to the lodging, time order is kept unchanged');

  // The FIRST matching transfer wins: a later "back to the lodge" return car
  // (dinner run) must not drag the Check-in to the end of the evening.
  const withReturn = [...events,
    trans(6, '', 'Riverside Tented Lodge', 'Old Town Restaurant', '2026-10-12T20:00:00', '2026-10-12T20:30:00', 'car'),
    trans(7, '', 'Old Town Restaurant', 'Riverside Tented Lodge', '2026-10-12T22:00:00', '2026-10-12T22:30:00', 'car')];
  const sortedReturn = placeTripsyLodgingNextToTransfers(
    insertTripsyLayovers(expandMultiDayTripsyEvents(withReturn).sort(tripsyTimelineSortComparator)));
  const ids = sortedReturn.filter(e => tripsyDayKey(e.start) === '2026-10-12').map(e => e.id);
  assert(ids.indexOf('hosting-3-checkin') === ids.indexOf('transportation-5') + 1,
    'the Check-in lands directly after the FIRST transfer arriving at the lodging, not after a later dinner-return car');

  // Layover glue: a Check-in inserted after its transfer must never land
  // between a layover row and the leg it was glued to.
  const glued = [
    trans(2, 'XX404', 'SIN', 'BKK', '2026-10-12T12:25:00', '2026-10-12T13:45:00'),
    { id: 'layover-x', _layover: true, start: '2026-10-12T13:45:00' },
    trans(5, '', 'BKK Airport', 'Riverside Tented Lodge', '2026-10-12T14:00:00', '2026-10-12T15:00:00', 'car'),
    { id: 'hosting-3-checkin', type: 'hotel', summary: 'Riverside Tented Lodge Golden Valley Check-in',
      start: '2026-10-12T15:00:00', _splitHalf: 'begin',
      tripsyRaw: { resource: 'hosting', id: 3, name: 'Riverside Tented Lodge Golden Valley', address: 'Chiang Rai, Thailand' } },
  ];
  const g = placeTripsyLodgingNextToTransfers(glued).map(e => e.id);
  assert(g.join(',') === 'transportation-2,layover-x,transportation-5,hosting-3-checkin',
    'layover glue is respected (and an already-correct order is left exactly as it was)');
}
