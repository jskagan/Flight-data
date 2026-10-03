// "When there is a flight into a different country first created in an itinerary,
// can you research any entry or visa requirements for that country and, if there
// are any, put a button on the flight event that says 'Entry Requirements'"
// (2026-10-03), then "Instead of having the app automatically research entry
// requirements, put a button on the title bar of any trip with an international
// destination" (same day). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
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

const lib = new Function(
  'const TRIPSY_ENTRY_TRAVELER_NATIONALITY = "United States";\n'
  + 'function tripsyDayKey(iso){ return iso ? String(iso).slice(0,10) : ""; }\n'
  + ['tripsyEntryNormalizeRecord', 'tripsyEntryRecordsFromRelay', 'tripsyIsFlightRaw', 'tripsyEntryRouteKey', 'tripsyEntryRecordShowsButton', 'tripsyEntryTripRoutes', 'tripsyEntryTripShowsButton', 'tripsyEntryParseResult', 'tripsyEntryPromptText', 'tripsyEntryRequirementsHtml'].map(extractFn).join('\n')
  + '\nfunction esc(s){return String(s==null?"":s).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]));}'
  + '\nreturn { tripsyEntryRecordsFromRelay, tripsyIsFlightRaw, tripsyEntryRouteKey, tripsyEntryRecordShowsButton, tripsyEntryTripRoutes, tripsyEntryTripShowsButton, tripsyEntryParseResult, tripsyEntryPromptText, tripsyEntryRequirementsHtml };')();

// ---- which flights a trip's button researches ----
{
  const fl = (id, dep, arr, at, extra = {}) => ({ id: 'transportation-' + id, hidden: false, tripsyRaw: { resource: 'transportation', id, category: 'airplane', departureDescription: dep, arrivalDescription: arr, departureAt: at, ...extra } });
  const trip = { key: 't1', start: '2030-05-01', end: '2030-05-12', events: [
    fl(1, 'Home City (AAA)', 'Abroad City (BBB)', '2030-05-01T10:00:00'),
    fl(2, 'Home City (AAA)', 'Abroad City (BBB)', '2030-05-09T10:00:00'),   // same route -> one call
    fl(3, 'Abroad City (BBB)', 'Domestic City (CCC)', '2030-05-02T10:00:00'), // known domestic -> skipped
    fl(4, 'Abroad City (BBB)', 'Known City (DDD)', '2030-05-03T10:00:00'),   // known international -> rechecked
    { id: 'transportation-6', tripsyRaw: { resource: 'transportation', id: 6, category: 'car', departureDescription: 'X', arrivalDescription: 'Y', departureAt: '2030-05-05T10:00:00' } },
  ] };
  const records = {
    [lib.tripsyEntryRouteKey(trip.events[2].tripsyRaw)]: { international: false, checkedAt: '2030-03-25T00:00:00Z' },
    [lib.tripsyEntryRouteKey(trip.events[3].tripsyRaw)]: { international: true, checkedAt: '2030-03-25T00:00:00Z' },
  };
  const arrs = lib.tripsyEntryTripRoutes(trip, records).map(t => t.raw.arrivalDescription);
  assert(arrs.join(' | ') === 'Abroad City (BBB) | Known City (DDD)',
    'THE ASK: pressing the button researches the trip\'s flights -- one call per ROUTE, cars and known-domestic routes skipped, known-international routes rechecked -> ' + arrs.join(' | '));
  assert(lib.tripsyEntryTripShowsButton(trip, records, '2030-04-01') === true, 'an upcoming trip with a possibly-international flight shows the title-bar button');
  assert(lib.tripsyEntryTripShowsButton(trip, records, '2030-06-01') === false, 'a trip already over shows no button');
  const domesticOnly = { key: 't2', start: '2030-05-01', end: '2030-05-03', events: [trip.events[2], trip.events[4]] };
  assert(lib.tripsyEntryTripShowsButton(domesticOnly, records, '2030-04-01') === false
    && lib.tripsyEntryTripShowsButton({ key: 't3', start: '2030-05-01', events: [] }, records, '2030-04-01') === false,
    'a trip whose flights are all known domestic, or with no flights, shows no button');
  assert(lib.tripsyEntryRouteKey({ departureDescription: ' Home  City ', arrivalDescription: 'ABROAD (BBB)' }) === 'home city→abroad (bbb)',
    'route keys are case/spacing-insensitive');
}

// ---- parsing the model's answer ----
{
  const txt = 'I searched official sites.\n<json>{"departure_country":"Switzerland","arrival_country":"Germany","international":true,"requirements_needed":true,"headline":"Valid passport needed.","items":[{"title":"Passport validity","detail":"Valid 3 months past departure."}],"links":[{"label":"Official info","url":"https://example.gov/entry"},{"label":"bad","url":"javascript:alert(1)"}]}</json>';
  const r = lib.tripsyEntryParseResult(txt);
  assert(r.international && r.requirementsNeeded && r.arrivalCountry === 'Germany' && r.items.length === 1,
    'the trailing <json> answer parses into the record the dialog renders');
  assert(r.links.length === 1 && r.links[0].url === 'https://example.gov/entry',
    'only http(s) links survive -- a javascript: URL from the model never reaches an href');
  const dom = lib.tripsyEntryParseResult('<json>{"international":false,"requirements_needed":true,"items":[{"title":"x"}]}</json>');
  assert(dom.requirementsNeeded === false, 'a domestic flight can never claim requirements, whatever the model says');
  let threw = false; try { lib.tripsyEntryParseResult('no json here'); } catch (e) { threw = true; }
  assert(threw, 'an answer without the <json> block throws, so the route stays unrecorded and the next press retries it');
}

// ---- the button rule ----
assert(lib.tripsyEntryRecordShowsButton({ international: true, requirementsNeeded: true, items: [{ title: 'Visa' }], links: [] }) === true,
  'THE ASK: an international arrival with requirements shows the "Entry Requirements" button');
assert(lib.tripsyEntryRecordShowsButton({ international: true, requirementsNeeded: false, items: [], links: [] }) === false
  && lib.tripsyEntryRecordShowsButton({ international: false, requirementsNeeded: false, items: [], links: [] }) === false
  && lib.tripsyEntryRecordShowsButton(null) === false,
  '"if there are any": no requirements, a domestic flight, or no research yet -> no button');

// ---- the dialog escapes everything and links open safely ----
{
  const h = lib.tripsyEntryRequirementsHtml({ arrivalCountry: '<b>X</b>', route: 'A → B', headline: 'h', items: [{ title: '<i>t</i>', detail: 'd' }],
    links: [{ label: 'Apply', url: 'https://example.gov/apply' }], nationality: 'United States', checkedAt: '2030-04-01T00:00:00Z', verifiedOnline: true });
  assert(!/<b>X<\/b>|<i>t<\/i>/.test(h) && /&lt;b&gt;X/.test(h), 'every model-written string is escaped');
  assert(/href="https:\/\/example\.gov\/apply" target="_blank" rel="noopener noreferrer"/.test(h), 'links to complete the requirements open in a new tab');
  assert(/United States passport holders/.test(h) && /confirm on the official sites/.test(h), 'the dialog says who it was researched for and to confirm officially');
}

// ---- wiring ----
const req = extractFn('tripsyEntryClaudeRequest');
assert(/web_search_20260209/.test(req) && /claude-opus-5-5/.test(req) && /fallbacks: 'default'/.test(req) && /server-side-fallback-2026-07-01/.test(req),
  'research uses the web_search server tool on Claude Opus 5.5 with the server-side refusal fallback');
const research = extractFn('tripsyResearchEntryRequirements');
assert(/stop_reason !== 'pause_turn'/.test(research) && /run\(true, false\)/.test(research) && /run\(false, false\); verified = false/.test(research),
  'a paused server-tool turn is continued; a 400 drops the fallback option first, then web search (answer marked unverified)');
const tripRun = extractFn('tripsyResearchTripEntryRequirements');
assert(/if \(!isOwner/.test(tripRun) && /tripsyEntryResearchingTrips\.has\(tripKey\)/.test(tripRun) && /tripsyEntryTripRoutes\(trip, driveData\.tripsyEntryRequirements\)/.test(tripRun),
  'only the owner researches, one run per trip at a time, over that trip\'s own routes');
assert(/persistDriveData\(\)/.test(tripRun) && /renderTripsyEventsList\(\)/.test(tripRun.slice(tripRun.indexOf('finally'))),
  'results are saved and the page re-renders so the per-flight buttons appear');
assert(!/tripsyEnsureEntryRequirements/.test(html), 'THE ASK: no automatic research remains -- no sync sweep, no trigger after a new flight saves');
const impl = extractFn('renderTripsyEventsListImpl');
assert(/data-tripsy-entry-research data-key=/.test(html) && /isOwner && tripsyEntryTripShowsButton\(trip,/.test(html) && />Entry Requirements<\/span>/.test(html),
  'THE ASK: the trip title bar carries an owner-only "Entry Requirements" button');
assert(/\$\{entryTripButtonHtml\}/.test(html) && /\[data-tripsy-entry-research\][\s\S]{0,400}tripsyResearchTripEntryRequirements\(btn\.dataset\.key\)/.test(impl),
  'the button is placed in the header and wired to the per-trip research');
assert(/data-tripsy-entry-reqs=/.test(impl) && /🛂 Entry Requirements/.test(impl) && /showTripsyEntryRequirements\(btn\.dataset\.tripsyEntryReqs\)/.test(impl),
  'the flight row carries the "Entry Requirements" button for every viewer, opening the details dialog');
assert(/driveData\.tripsyEntryRequirements[\s\S]{0,400}liveRoutes/.test(extractFn('pruneDriveDataInMemory')),
  'the new driveData key has its prune rule: records no remaining flight uses are dropped');

// ---- hand-entered records from a Claude session (2026-10-03) ----
{
  const recs = lib.tripsyEntryRecordsFromRelay({ entries: [
    { route_key: 'aaa→bbb', route: 'AAA → BBB', checked_at: '2030-04-01T00:00:00Z', international: true, requirements_needed: true,
      arrival_country: 'Testland', items: [{ title: 'Arrival card', detail: 'Online, 3 days before.' }],
      links: [{ label: 'Official', url: 'https://example.gov/card' }, { label: 'x', url: 'ftp://nope' }], sources: ['https://example.gov/a', 'javascript:x'] },
    { route_key: 'no-arrow', international: true },
    { route_key: 'ccc→ddd', international: false, requirements_needed: true, checked_at: 'garbage' },
  ] }, '2030-04-02T00:00:00.000Z');
  assert(Object.keys(recs).join() === 'aaa→bbb,ccc→ddd', 'relay entries key by route; a malformed route key is skipped');
  assert(recs['aaa→bbb'].checkedAt === '2030-04-01T00:00:00.000Z' && recs['aaa→bbb'].links.length === 1 && recs['aaa→bbb'].sources.length === 1,
    'THE ASK: a hand-entered record keeps its checked date and goes through the same link sanitizer');
  assert(recs['ccc→ddd'].requirementsNeeded === false && recs['ccc→ddd'].checkedAt === '2030-04-02T00:00:00.000Z',
    'a domestic relay entry can never claim requirements, and a bad date falls back to now');
  const drain = extractFn('drainTripsyEntryRequirementsRelay');
  assert(/TRIPSY_ENTRY_RELAY_FILENAME/.test(drain) && /Date\.parse\(cur\.checkedAt\) >= Date\.parse\(rec\.checkedAt\)\) continue/.test(drain),
    'the drain never replaces a NEWER record already on file');
  assert(extractFn('syncTripsyRelays').indexOf('drainTripsyEntryRequirementsRelay()') > 0, 'the relay is still drained on every sync');
}
