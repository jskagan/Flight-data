// "when there is a transportation event involving a car to or from a hotel
// or a car to and from an airport. In the itinerary, use a picture of a
// sprinter van that is black instead of whatever image is generated or
// found by the itinerary" (2026-09-27). tripsyIsVanTransferLeg detects
// such a leg (car category + airport named on an end, or a trip lodging on
// exactly one end via the same tripsyTransferSideForLodging the ordering
// pass uses), and tripsyTransportationCardHtml swaps its PHOTO subject to
// the fixed TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT pseudo-company -- one shared
// cache entry across every transfer on every trip, riding the existing
// per-company machinery (vision check, 🔄🗂🔍📋🚫 controls, pinning) with
// van-specific queries, a strict "black Sprinter-style van or nothing"
// check, and NO wrong-photo fallback (the icon beats a wrong picture).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) return null;
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

// ---- the sentinel and its plumbing exist ----
assert(/const TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT = 'Black Sprinter Van';/.test(html),
  'the fixed van photo subject constant exists');
assert(/if \(company === TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT\) return \[\.\.\.TRIPSY_VAN_TRANSFER_PHOTO_QUERIES\];/.test(html),
  'query variants special-case the sentinel (no company logo/livery wording, no generic car fallback)');
assert(/company === TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT\s*\n?\s*\? 'This photo will illustrate a private car transfer/.test(html)
  && /black \(or very dark\) Mercedes Sprinter-style passenger van/.test(html),
  'the vision check gets a strict van-specific prompt for the sentinel');
assert(/if \(!pick\) pick = company === TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT \? null : fallback;/.test(html),
  'THE RULE: nothing passing the van check shows the ICON, never a wrong photo ("instead of whatever image is generated or found")');

// ---- the card builder routes matched legs to the sentinel ----
{
  const card = html.slice(html.indexOf('const tripsyTransportationCardHtml = async'), html.indexOf('const tripsyDetailedCardHtml'));
  assert(/const photoCompany = tripsyIsVanTransferLeg\(ev, vanTransferLodgings\) \? TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT : company;/.test(card),
    'a matched car transfer leg swaps its PHOTO subject to the sentinel');
  assert(/tripsyTransportationPhotoCacheKey\(photoCompany, category\)/.test(card)
    && /fetchTripsyTransportationPhoto\(photoCompany, category\)/.test(card),
    'cache key and fetch both use the swapped subject -- one shared entry across every transfer on every trip');
  assert(/data-tripsy-transport-company="\$\{esc\(photoCompany\)\}"/.test(card),
    'the manual 🔄🗂🔍📋🚫 controls are keyed to the sentinel too, so a paste/pick PINS the van picture globally');
  assert(/tripsyGatherTransportationPhotoCandidates\(apiKey, photoCompany, category\)/.test(card)
    && /photoCompany && !\(await tripsyTransportationPhotoAcceptable\(photoCompany, blob\)\)/.test(card),
    'the place-collision swap walks van candidates under the van check for matched legs');
  assert(/const companyMetaLine = hasRoute && company &&/.test(card),
    'the card TEXT (company meta line) keeps the real operator -- only the photo subject is swapped');
  assert(/const vanTransferLodgings = \(trip\.events \|\| \[\]\)\.filter\(e => e\.tripsyRaw && e\.tripsyRaw\.resource === 'hosting'\);/.test(html),
    'lodgings come from the RAW trip events, once per build (a transfer can land on a different day from its check-in row)');
}

// ---- executed: the detector ----
{
  // tripsyTransferSideForLodging's city fallback leans on the real address
  // extractor -- take the file's contiguous table-through-function slice,
  // the same way lodgingorder_test.js does.
  const cityTableNames = ['TRIPSY_CITY_STATES', 'TRIPSY_STATE_CITIES', 'TRIPSY_COUNTRY_NAMES', 'TRIPSY_COUNTRY_ALIASES', 'TRIPSY_STREET_SUFFI'];
  const sliceStart = Math.min(...cityTableNames.map(n => html.indexOf('const ' + n + ' =')).filter(i => i >= 0));
  const cityFnSrc = extractFn('tripsyPrimaryCityFromAddress');
  eval((html.match(/const TV_STRIP_LOC = new Set\(\[[\s\S]*?\]\);/) || [''])[0].replace(/^const /, 'var '));
  eval(html.slice(sliceStart, html.indexOf(cityFnSrc) + cityFnSrc.length)
    .replace(/^function tripsyPrimaryCityFromAddress/m, 'var tripsyPrimaryCityFromAddress = function'));
  for (const n of ['tripsyLodgingCityLower', 'tripsyDescMatchesCity', 'tripsyDescMatchesLodgingName',
    'tripsyTransferSideForLodging', 'tripsyIsVanTransferLeg']) {
    const src = extractFn(n);
    if (!src) { assert(false, `could not extract ${n}`); continue; }
    eval(src.replace(/^(async )?function /, `var ${n} = $1function `));
  }

  const lodge = { id: 'hosting-3', type: 'hotel', summary: 'Riverside Tented Lodge Golden Valley',
    tripsyRaw: { resource: 'hosting', id: 3, name: 'Riverside Tented Lodge Golden Valley',
      address: '499 Moo 1, Chiang Saen District, 57150, Chiang Rai, Thailand' } };
  const car = (dep, arr, extra = {}) => ({
    id: 'transportation-9', type: 'transportation', summary: `Car from ${dep} to ${arr}`,
    tripsyRaw: { resource: 'transportation', category: 'car', departureDescription: dep, arrivalDescription: arr },
    ...extra,
  });

  assert(tripsyIsVanTransferLeg(car('Singapore Changi Airport', 'Old Town Restaurant'), []) === true,
    'a car FROM an airport matches with no lodging evidence at all (the airport word alone)');
  assert(tripsyIsVanTransferLeg(car('Old Town Restaurant', 'Chiang Rai Airport (for Flight FD3210)'), []) === true,
    'a car TO an airport matches too');
  assert(tripsyIsVanTransferLeg(car('Riverside Tented Lodge', 'Old Town Restaurant'), [lodge]) === true,
    'a car FROM the hotel matches by lodging NAME, judged by the same tripsyTransferSideForLodging the ordering pass uses');
  assert(tripsyIsVanTransferLeg(car('Old Town Jazz Club', 'Riverside Tented Lodge Golden Valley Thailand'), [lodge]) === true,
    'a car TO the hotel matches (either-direction name containment)');
  assert(tripsyIsVanTransferLeg(car('Old Town Restaurant', 'Harbor Jazz Club'), [lodge]) === false,
    'a car between two venues naming neither hotel nor airport is NOT a van transfer -- it keeps the ordinary photo path');
  const flight = { id: 't-1', type: 'flight', summary: 'Flight from LAX Airport to LHR',
    tripsyRaw: { resource: 'transportation', category: 'airplane', departureDescription: 'LAX Airport', arrivalDescription: 'LHR' } };
  assert(tripsyIsVanTransferLeg(flight, [lodge]) === false,
    'a FLIGHT never matches, airport word or not -- the rule is about cars');
  const train = { id: 't-2', type: 'transportation', summary: 'Train from St Pancras to Gare du Nord',
    tripsyRaw: { resource: 'transportation', category: 'train', departureDescription: 'St Pancras Airport Link', arrivalDescription: 'Gare du Nord' } };
  assert(tripsyIsVanTransferLeg(train, [lodge]) === false, 'a train never matches either');
  const uncategorized = { id: 't-3', type: 'transportation', summary: 'Car from Changi Airport to the hotel',
    tripsyRaw: { resource: 'transportation', departureDescription: '', arrivalDescription: '' } };
  assert(tripsyIsVanTransferLeg(uncategorized, []) === true,
    'an uncategorized leg falls back to the "Car ..." summary title shape (and the airport word in the summary counts)');
  const shuttle = { id: 't-4', type: 'transportation', summary: 'Shuttle from Changi Airport',
    tripsyRaw: { resource: 'transportation', departureDescription: 'Changi Airport', arrivalDescription: '' } };
  assert(tripsyIsVanTransferLeg(shuttle, []) === false,
    'an uncategorized non-"Car" summary does not match -- the category (or title) must say car');
  assert(tripsyIsVanTransferLeg({ id: 'a-1', type: 'other', summary: 'Airport Lounge Tour', tripsyRaw: { resource: 'activity' } }, []) === false,
    'a non-transportation event never matches');
}

// ---- executed: the query variants ----
{
  eval((html.match(/const TRIPSY_TRANSPORTATION_CATEGORY_GENERIC_QUERIES = \{[\s\S]*?\};/) || [''])[0].replace(/^const /, 'var '));
  eval((html.match(/const TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT = .*;/) || [''])[0].replace(/^const /, 'var '));
  eval((html.match(/const TRIPSY_VAN_TRANSFER_PHOTO_QUERIES = \[[\s\S]*?\];/) || [''])[0].replace(/^const /, 'var '));
  eval(extractFn('tripsyTransportationPhotoQueryVariants').replace(/^function /, 'var tripsyTransportationPhotoQueryVariants = function '));

  const vanQueries = tripsyTransportationPhotoQueryVariants(TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT, 'car');
  assert(vanQueries.every(q => /sprinter|van/i.test(q)),
    'every sentinel query is about the van itself: ' + vanQueries.join(' | '));
  assert(!vanQueries.some(q => /logo|livery|road trip/i.test(q)),
    'no logo/livery/generic-category query for the sentinel -- an off-subject pool would burn checks or show a non-van');
  const real = tripsyTransportationPhotoQueryVariants('Blacklane', 'car');
  assert(real[0] === 'Blacklane logo' && real.includes('car road trip'),
    'a real company keeps the pre-existing variant order untouched');
}
