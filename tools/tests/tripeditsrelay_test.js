// "Can you look up the concert times ... and add them to the itinerary"
// (2026-09-28). A Claude session outside the browser cannot update
// trips-data.json (its Drive tooling only CREATES files), and replacing the
// file wholesale would race an open session's own edits -- so sessions
// write a small tripsy-trip-edits.json relay and drainTripsyTripEdits feeds
// each entry through the ONE Store.queueTripsyChange entry point: the same
// conflict-guarded write path a hand-made edit gets, the app staying the
// data file's single writer. Entries must be replay-safe, because a failure
// keeps the relay file for the next open.
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

// ---- wiring ----
assert(/const TRIPSY_TRIP_EDITS_FILENAME = 'tripsy-trip-edits\.json';/.test(html),
  'the relay filename constant exists');
assert(/await drainTripsyRelayFiles\(TRIPSY_TRIP_EDITS_FILENAME, applyTripsyTripEditsRelay\)/.test(html),
  'the drain rides the SHARED relay helper -- file deleted only after a fully successful apply, kept for retry otherwise');
assert(/try \{ await drainTripsyTripEdits\(\); \} catch/.test(html)
  && html.indexOf('await drainTripsyNarrativeResults()') < html.indexOf('await drainTripsyTripEdits()'),
  'syncTripsyRelays drains trip edits AFTER the trips load (queueTripsyChange edits the live array), next to the narrative drain');
assert(/if \(!isOwner \|\| !tripsyDecryptedTrips\) return;/.test(extractFn('drainTripsyTripEdits')),
  'owner-only, and never before trips-data.json has actually loaded');
{
  // "Look at the start times for the concerts. They do not match with what
  // you reported" (2026-09-28): the drain applied its edits while My Trips
  // was open, but the sync's re-render snapshot only watched the proposal
  // queues -- queueTripsyChange touches neither -- so the page kept the
  // pre-edit render (midnight placeholders) until a manual reload.
  // tripsDataUpdatedAt now rides BOTH snapshots: it moves exactly when
  // trips-data.json was rewritten during the sync.
  const sync = extractFn('syncTripsyRelays');
  const snaps = sync.match(/JSON\.stringify\(\[[\s\S]*?\]\)/g) || [];
  assert(snaps.length === 2 && snaps.every(s => /tripsDataUpdatedAt/.test(s)),
    'THE REPAINT FIX: both re-render snapshots include tripsDataUpdatedAt, so drained trip edits repaint an open My Trips page');
}

// The trip-op constants the normalizer needs (the grown-dependency lesson).
const TRIP_CONSTS = ['TRIPSY_TRIP_EDIT_KEY_RE', 'TRIPSY_TRIP_EDIT_DAY_RE', 'TRIPSY_TRIP_EDIT_TRIP_FIELDS']
  .map(n => { const m = html.match(new RegExp('const ' + n + ' = [^\\n]*')); return m ? m[0].replace(/^const /, 'var ') : ''; }).join('\n');

// ---- executed: the apply itself ----
(async () => {
  const src = extractFn('applyTripsyTripEditsRelay');
  if (!src) { assert(false, 'could not extract applyTripsyTripEditsRelay'); return; }
  const calls = { queued: [], toasts: [] };
  const trips = [{ key: 'tripsy-1', name: 'GP', events: [
    { id: 'activity-11', summary: 'JJ Lin - Padang Stage', tripsyRaw: { resource: 'activity', id: 11, name: 'JJ Lin - Padang Stage', startsAt: '2026-10-09T00:00:00' } },
  ] }];
  const mk = (failOn) => new Function('calls', 'trips', 'failOn', `
    var tripsyDecryptedTrips = trips;
    var tripsyEventKey = r => r.resource + ':' + r.id;
    var toast = (msg, kind) => calls.toasts.push(msg);
    var TRIPSY_TRIP_EDIT_KNOWN_TYPES = ['edit_event', 'delete_event', 'create_event', 'edit_trip', 'create_trip', 'delete_trip', 'move_event'];
    var Store = { queueTripsyChange: async change => {
      if (failOn && change.eventSummary === failOn) throw new Error('write failed');
      if (failOn === 'RETURN_FALSE' && change.eventSummary === 'Soft fail') return false;
      calls.queued.push(change);
      // Mirror applyTripsyChangeToTrips for trips so later ops in the same
      // file see a trip an earlier op created.
      if (change.type === 'create_trip') trips.push({ key: change.tripKey, name: change.name, start: change.start, end: change.end, location: change.location, events: [] });
      if (change.type === 'edit_trip') { const t = trips.find(x => x.key === change.tripKey); Object.assign(t, change.changes); }
      if (change.type === 'create_event') { const t = trips.find(x => x.key === change.tripKey); t.events.push({ tripsyRaw: { resource: change.tripsyResource, id: 900 + t.events.length, ...change.fields } }); }
      return true;
    } };
    ${TRIP_CONSTS}
    ${extractFn('tripsyTripEditNormalizeTripChange')}
    ${extractFn('tripsyTripEditCreateIdentity')}
    ${src.replace(/^async function /, 'var applyTripsyTripEditsRelay = async function ')}
    return applyTripsyTripEditsRelay;
  `)(calls, trips, failOn || null);

  const relay = { edits: [
    { type: 'edit_event', eventKey: 'activity:11', eventSummary: 'JJ Lin - Padang Stage', changes: { startsAt: '2026-10-09T22:30:00' } },
    { type: 'edit_event', eventKey: 'activity:999', eventSummary: 'Ghost', changes: {} },
    { type: 'create_event', tripKey: 'tripsy-1', tripsyResource: 'activity', eventSummary: 'CORTIS - Padang Stage',
      fields: { name: 'CORTIS - Padang Stage', startsAt: '2026-10-09T19:30:00' } },
    { type: 'create_event', tripKey: 'tripsy-1', tripsyResource: 'activity', eventSummary: 'JJ Lin dup',
      fields: { name: 'JJ Lin - Padang Stage', startsAt: '2026-10-09T00:00:00' } },
    { type: 'create_event', tripKey: 'tripsy-gone', tripsyResource: 'activity', eventSummary: 'Orphan', fields: { name: 'X', startsAt: 'Y' } },
    { type: 'create_trip', tripKey: 'tripsy-1', name: 'GP again' },
    { type: 'set_everything_on_fire', tripKey: 'tripsy-1' },
  ] };
  await mk()(relay);
  assert(calls.queued.length === 2
    && calls.queued[0].type === 'edit_event' && calls.queued[0].eventKey === 'activity:11'
    && calls.queued[1].type === 'create_event' && calls.queued[1].fields.name === 'CORTIS - Padang Stage',
    'exactly the valid entries reach queueTripsyChange: a real edit and a genuinely new event');
  assert(calls.toasts.length === 1 && /Applied 2 itinerary updates/.test(calls.toasts[0]),
    'the owner is told what landed: ' + calls.toasts[0]);
  // skips, in order: missing event, duplicate create (REPLAY SAFETY -- same
  // name+startsAt already tracked), unknown trip, existing trip key, unknown type.

  // A write failure throws (so the shared drain KEEPS the relay file), but the
  // rest still applied first.
  calls.queued.length = 0; calls.toasts.length = 0;
  trips[0].events = trips[0].events.filter(e => e.tripsyRaw.id === 11); // the stub recorded the first run's create
  let threw = false;
  try { await mk('JJ Lin - Padang Stage')(relay); } catch (e) { threw = true; }
  assert(threw && calls.queued.length === 1 && calls.queued[0].fields.name === 'CORTIS - Padang Stage',
    'one failed entry does not block the rest, and the throw keeps the relay file for the next open (replay dedupes make that safe)');

  // "incorporate this information into the itinerary for my Germany trip"
  // (2026-09-30): relayed CAR legs were silently skipped. Transportation has no
  // name/startsAt, so the old name+startsAt dedupe read '' === '' against any
  // existing flight and called every new leg a duplicate.
  calls.queued.length = 0; calls.toasts.length = 0;
  trips[0].events.push({ id: 'transportation-5', tripsyRaw: { resource: 'transportation', id: 5, category: 'airplane',
    departureAt: '2026-11-16T09:15:00', departureDescription: 'Zurich (ZRH)', arrivalDescription: 'Stuttgart (STR)' } });
  await mk()({ edits: [
    { type: 'create_event', tripKey: 'tripsy-1', tripsyResource: 'transportation', eventSummary: 'Drive',
      fields: { category: 'car', departureAt: '2026-11-18T12:30:00', departureDescription: 'Stuttgart', arrivalDescription: 'Salzburg' } },
    { type: 'create_event', tripKey: 'tripsy-1', tripsyResource: 'transportation', eventSummary: 'Flight replay',
      fields: { category: 'airplane', departureAt: '2026-11-16T09:15:00', departureDescription: 'Zurich (ZRH)', arrivalDescription: 'Stuttgart (STR)' } },
  ] });
  assert(calls.queued.length === 1 && calls.queued[0].eventSummary === 'Drive',
    'THE FIX: a new car leg on a trip with flights is applied, while a true transportation replay (same departure time + endpoints) is still skipped');
  const ident = new Function(extractFn('tripsyTripEditCreateIdentity') + '; return tripsyTripEditCreateIdentity;')();
  assert(ident('transportation', {}) === '' && ident('activity', {}) === '',
    'an entry with nothing identifying never dedupes against anything');

  // ---- create_trip / edit_trip in the `fields` shape (2026-11-24) ----
  calls.queued.length = 0; calls.toasts.length = 0;
  const before = trips.length;
  await mk()({ edits: [
    { type: 'create_trip', tripKey: 'tripsy-pending-a1b2c3d4', fields: { name: 'Test Trip', start: '2030-05-08', end: '2030-05-01', location: 'Lisbon, Portugal' } },
    { type: 'create_event', tripKey: 'tripsy-pending-a1b2c3d4', tripsyResource: 'activity', eventSummary: 'Dinner',
      fields: { name: 'Dinner', startsAt: '2030-05-02T19:00:00' } },
    { type: 'edit_trip', tripKey: 'tripsy-pending-a1b2c3d4', fields: { name: 'Renamed Trip', end: '2030-05-09', bogus: 'x' } },
    { type: 'create_trip', tripKey: 'tripsy-pending-a1b2c3d4', fields: { name: 'Dup', start: '2030-01-01' } },
    { type: 'create_trip', tripKey: 'my-own-key', fields: { name: 'Bad key', start: '2030-01-01' } },
    { type: 'create_trip', tripKey: 'tripsy-pending-nodate1', fields: { name: 'No date' } },
    { type: 'edit_trip', tripKey: 'tripsy-pending-gone0000', fields: { name: 'Ghost' } },
  ] });
  const ct = calls.queued[0];
  assert(calls.queued.length === 3 && ct.type === 'create_trip' && ct.tripKey === 'tripsy-pending-a1b2c3d4'
    && ct.name === 'Test Trip' && ct.start === '2030-05-01' && ct.end === '2030-05-08' && ct.location === 'Lisbon, Portugal'
    && typeof ct.id === 'string' && typeof ct.createdAt === 'string' && !('fields' in ct),
    'create_trip (fields shape) becomes the hand-made change shape {id, type, createdAt, tripKey, name, start, end, location}, reversed dates swapped');
  assert(calls.queued[1].type === 'create_event' && calls.queued[1].tripKey === 'tripsy-pending-a1b2c3d4',
    'ops apply in FILE ORDER: the create_event after it lands on the trip the create_trip just made');
  assert(calls.queued[2].type === 'edit_trip' && JSON.stringify(calls.queued[2].changes) === JSON.stringify({ name: 'Renamed Trip', end: '2030-05-09' }),
    'edit_trip (fields shape) becomes {changes} limited to name/start/end/location');
  assert(trips.length === before + 1,
    'skipped: a second create_trip on an existing key (no duplicate), a key outside tripsy-pending-, a create with no start, an edit of a missing trip');

  const norm = new Function(TRIP_CONSTS + '\n' + extractFn('tripsyTripEditNormalizeTripChange') + '; return tripsyTripEditNormalizeTripChange;')();
  const flat = norm({ type: 'create_trip', tripKey: 'tripsy-pending-0fcaf9dd', name: 'Flat', start: '2030-01-01', end: '2030-01-03' });
  assert(flat && flat.name === 'Flat' && flat.end === '2030-01-03' && flat.location === null,
    'the older flat create_trip form still works');
  assert(norm({ type: 'create_trip', tripKey: 'tripsy-pending-x1y2', fields: { name: 'One day', start: '2030-02-02' } }).end === '2030-02-02',
    'a missing end becomes the start');
  assert(norm({ type: 'edit_trip', tripKey: 'tripsy-1', changes: { start: 'soon' } }) === null,
    'an edit with no valid field is skipped (bad date dropped)');

  // queueTripsyChange reports failure by RETURNING false; that must count as
  // a failure (file kept), not as applied.
  calls.queued.length = 0; calls.toasts.length = 0;
  let threw2 = false;
  try { await mk('RETURN_FALSE')({ edits: [{ type: 'create_event', tripKey: 'tripsy-1', tripsyResource: 'activity', eventSummary: 'Soft fail', fields: { name: 'Soft', startsAt: '2031-01-01T10:00:00' } }] }); }
  catch (e) { threw2 = true; }
  assert(threw2 && calls.toasts.length === 0, 'THE FIX: a save that returns false keeps the relay file instead of being counted as applied');
})();
