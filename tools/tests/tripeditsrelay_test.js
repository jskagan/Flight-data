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
      calls.queued.push(change);
    } };
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
  let threw = false;
  try { await mk('JJ Lin - Padang Stage')(relay); } catch (e) { threw = true; }
  assert(threw && calls.queued.length === 1 && calls.queued[0].fields.name === 'CORTIS - Padang Stage',
    'one failed entry does not block the rest, and the throw keeps the relay file for the next open (replay dedupes make that safe)');
})();
