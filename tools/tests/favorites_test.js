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
// ONE eval: separate eval() calls each get their own scope, so a const declared in the
// first is invisible to a function defined in the second. The city derivation now goes
// through the app's SHARED extractor (the one the weather pipeline uses), so that and its
// tables have to come along rather than being re-implemented here.
// The extractor leans on a whole cluster of address tables (country names/aliases, street
// suffixes, state cities…). Rather than chase each one, take the file's contiguous slice
// from the first of them through the end of the function itself.
const sliceStart = Math.min(...['TRIPSY_CITY_STATES','TRIPSY_STATE_CITIES','TRIPSY_COUNTRY_NAMES','TRIPSY_COUNTRY_ALIASES','TRIPSY_STREET_SUFFI']
  .map(n => html.indexOf('const ' + n + ' =')).filter(i => i >= 0));
const extractorEnd = html.indexOf(extractFn('tripsyPrimaryCityFromAddress')) + extractFn('tripsyPrimaryCityFromAddress').length;
// TV_STRIP_LOC is declared a MILLION characters later in the file (it is a Travel View
// constant); in the browser that is fine, since nothing runs until every declaration has,
// but a slice has to fetch it separately.
eval([
  (html.match(/const TV_STRIP_LOC = new Set\(\[[\s\S]*?\]\);/) || [''])[0],
  html.slice(sliceStart, extractorEnd),
  extractFn('tripsyFavoriteKey'),
  extractFn('tripsyFavoriteCityFor'),
  extractFn('tripsyLodgingCityAt'),
].join('\n'));
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const ev = address => ({ tripsyRaw: { address } });
const trip = { location: 'United Kingdom' };

// ---- city derivation, on shapes taken from the live trip data ----
assert(tripsyFavoriteCityFor(ev('33 Albemarle St, London W1S 4BP, UK'), trip) === 'London',
  'a UK address drops the country and strips the postcode -> ' + tripsyFavoriteCityFor(ev('33 Albemarle St, London W1S 4BP, UK'), trip));
assert(tripsyFavoriteCityFor(ev('22 Bishopsgate, London'), trip) === 'London', 'a two-part address takes the last part');
assert(tripsyFavoriteCityFor(ev('RH England, The Gallery, Mayfair, London, UK'), trip) === 'London',
  'a long address still lands on the city');
assert(tripsyFavoriteCityFor(ev('ABBA Arena, Pudding Mill Lane, London, United Kingdom, E15 2PJ'), trip) === 'London',
  'a trailing postcode PART is dropped, not kept as the city -> ' + tripsyFavoriteCityFor(ev('ABBA Arena, Pudding Mill Lane, London, United Kingdom, E15 2PJ'), trip));
assert(tripsyFavoriteCityFor(ev('123 Main St, Austin, TX 78701, USA'), trip) === 'Austin',
  'a US address files under the CITY, not the state left behind by the ZIP -> ' + tripsyFavoriteCityFor(ev('123 Main St, Austin, TX 78701, USA'), trip));
// A comma-less address is a VENUE name, not a city ("Soho Farmhouse", "Edinburgh
// International Festival"), so it defers to where you were sleeping that night. This is
// the whole point of "always use the city": the venue is already the favorite's title.
assert(tripsyFavoriteCityFor(ev('Soho Farmhouse'), trip, 'Chipping Norton') === 'Chipping Norton',
  'a venue name files under the lodging city -> ' + tripsyFavoriteCityFor(ev('Soho Farmhouse'), trip, 'Chipping Norton'));
assert(tripsyFavoriteCityFor(ev('Soho Farmhouse'), trip) === 'United Kingdom',
  'and falls back to the trip location when there was no lodging');
// A route arrives at an airport code, which is not a city either -- same fallback.
assert(tripsyFavoriteCityFor(ev('LAX → LHR'), trip, 'London') === 'London',
  'a flight files under the city you slept in, not "LHR" -> ' + tripsyFavoriteCityFor(ev('LAX → LHR'), trip, 'London'));
assert(tripsyFavoriteCityFor(ev('Browns Hotel → Victoria & Albert Museum'), trip, 'London') === 'London',
  'as does a car leg');
// A real city survives regardless of the fallback being available.
assert(tripsyFavoriteCityFor(ev('33 Albemarle St, London W1S 4BP, UK'), trip, 'Edinburgh') === 'London',
  'a genuine address still wins over the lodging fallback');
assert(tripsyFavoriteCityFor(ev(''), trip, 'Edinburgh') === 'Edinburgh', 'no address at all uses the lodging city');

// ---- lodging lookup: where you were sleeping at a given moment ----
const stay = (name, address, start, end) => ({ start, end, tripsyRaw: { resource: 'hosting', name, address } });
const tripWithStays = { location: 'United Kingdom', events: [
  stay("Brown's", '33 Albemarle St, London W1S 4BP, UK', '2026-08-07T16:00:00', '2026-08-13T10:00:00'),
  stay('Balmoral', '1 Princes St, Edinburgh EH2 2EQ, UK', '2026-08-13T15:00:00', '2026-08-19T10:00:00'),
] };
assert(tripsyLodgingCityAt(tripWithStays, '2026-08-08T19:00:00') === 'London', 'inside the first stay -> London');
assert(tripsyLodgingCityAt(tripWithStays, '2026-08-15T19:00:00') === 'Edinburgh', 'inside the second -> Edinburgh');
// Outside every stay -- the trip's opening and closing travel legs -- the NEAREST stay in
// time is used, so an outbound flight files under the city it was heading to.
assert(tripsyLodgingCityAt(tripWithStays, '2026-08-02T19:00:00') === 'London', 'before any stay -> the first one');
assert(tripsyLodgingCityAt(tripWithStays, '2026-08-25T19:00:00') === 'Edinburgh', 'after every stay -> the last one');
assert(tripsyLodgingCityAt({ location: 'x', events: [] }, '2026-08-08T19:00:00') === '',
  'a trip with no lodging at all still yields nothing, so the caller falls back');
assert(tripsyLodgingCityAt(tripWithStays, 'not a date') === '', 'an unparseable time is safe');
assert(tripsyLodgingCityAt(null, '2026-08-08T19:00:00') === '', 'a missing trip is safe');

// ---- key ----
assert(tripsyFavoriteKey('T1', 'activity-1') === 'T1::activity-1', 'the key pairs trip and event');

// ---- the star in Travel View ----
assert(/<div class="tv-timerow">\$\{favBtn\}\$\{rightHtml\}<\/div>/.test(html),
  'the star renders to the LEFT of the time');
assert(/const favBtn = isOwner/.test(html), 'and only for the owner, who alone can write');
assert(/favOn \? '★' : '☆'/.test(html), 'filled when starred, hollow when not');
const handler = html.slice(html.indexOf("const favBtn = e.target.closest('[data-tv-fav]')"), html.indexOf("const favBtn = e.target.closest('[data-tv-fav]')") + 1400);
assert(/e\.stopPropagation\(\)/.test(handler), 'tapping it does not also open the event detail');
assert(/favBtn\.classList\.toggle\('tv-fav-on'\)/.test(handler), 'it paints immediately');
assert(/\.then\(actual => \{[\s\S]*?favBtn\.classList\.toggle\('tv-fav-on', actual\)/.test(handler),
  'and corrects itself if the write disagrees');
assert(/title: \(fraw\.name \|\| fev\.summary \|\| 'Event'\)\.replace\(\/ Check-\(in\|out\)\$\/, ''\)/.test(handler),
  'a hotel check-in row stars the hotel, not "Hotel Check-in"');
assert(/city: tripsyFavoriteCityFor\(fev, trip, tripsyLodgingCityAt\(trip, fev\.start\)\)/.test(handler),
  'the city is derived per EVENT, with the night\'s lodging city as the fallback');
assert(/date: tripsyDayKey\(fev\.start\)/.test(handler), 'and the visit date is recorded');

// ---- the Utilities page ----
assert(/data-view="utilitiesfavorites">Favorites</.test(html), 'Utilities carries a Favorites item');
assert(/view === "utilitiesfavorites"\) await renderUtilitiesFavorites\(\)/.test(html), 'which dispatches to the page');
assert(/isUtilitiesView = [^\n]*utilitiesfavorites/.test(html), 'and keeps the submenu open on it');
const pageFn = extractFn('renderUtilitiesFavorites');
assert(/byCity/.test(pageFn) && /f\.city \|\| 'Other'/.test(pageFn), 'the page groups by city');
assert(/b\[1\]\.length - a\[1\]\.length \|\| a\[0\]\.localeCompare\(b\[0\]\)/.test(pageFn),
  'cities ordered by how many favorites they hold, then alphabetically');
assert(/data-fav-remove/.test(pageFn), 'each row can be removed');
assert(/No favorites yet/.test(pageFn), 'and an empty list explains how to add one');

// ---- storage ----
const store = html.slice(html.indexOf('  listFavorites() {'), html.indexOf('  async getTripsyAttireGuide(tripKey) {'));
assert(/const existing = driveData\.tripsyFavorites\.some\(f => f\.key === fav\.key\)/.test(store), 'toggling is keyed');
assert(/return !existing;/.test(store), 'and returns the new state');
assert(/\{ \.\.\.fav, addedAt: new Date\(\)\.toISOString\(\) \}/.test(store),
  'a favorite stores a SNAPSHOT, so it outlives the event being edited or deleted');

// ---- the favorite's own page ----
const favPage = extractFn('renderUtilitiesFavorites');
assert(/tripsyFavoriteOpenKey/.test(favPage), 'selecting a favorite opens its own page');
assert(/data-fav-open/.test(favPage) && /data-fav-back/.test(favPage), 'with a way in and a way back');
assert(/row\('City', f\.city\)/.test(favPage) && /row\('Address', f\.address\)/.test(favPage)
    && /row\('Visited', tripsyFavoriteDateLabel\(f\.date\)\)/.test(favPage) && /row\('Trip', f\.tripName\)/.test(favPage),
  'the page shows city, address, visit date and trip');
assert(/data-fav-notes/.test(favPage), 'and a notes box');
assert(/addEventListener\('blur', async \(\) => \{[\s\S]*?saveFavoriteNotes/.test(favPage),
  'notes save on blur, like the diary');
assert(/if \(\(f\.notes \|\| ''\) === notesEl\.value\) return;/.test(favPage), 'an unchanged note spends no write');
assert(/isOwner\s*\n?\s*\? `<textarea class="fav-notes"/.test(favPage), 'the owner types; a viewer reads');
// The LIST now carries the date and trip, and is ordered newest visit first.
assert(/tripsyFavoriteDateLabel\(f\.date\), f\.tripName/.test(favPage), 'each row shows date and trip name');
assert(/String\(b\.date \|\| ''\)\.localeCompare\(String\(a\.date \|\| ''\)\)/.test(favPage),
  'most recent visit first within a city');
// A favorite deleted while its page is open must not strand the page.
assert(/if \(!f\) \{ tripsyFavoriteOpenKey = null; return renderUtilitiesFavorites\(\); \}/.test(favPage),
  'a missing favorite falls back to the list rather than throwing');
// Dates are formatted through the UTC helper, or the day shifts by the viewer's timezone.
assert(/tripPartsToUtcDate/.test(extractFn('tripsyFavoriteDateLabel')), 'the date label is timezone-safe');
