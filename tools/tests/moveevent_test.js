// "Let's add a feature that allows the user to re-assign an event to another
// existing trip." Before this, the ONLY way to move an event was delete + re-create,
// which mints a NEW event id -- so every id-keyed reference (attached documents,
// composed outfit blocks, the Daily Dress Guide, itinerary baselines) was silently
// detached in the process. The move_event change type carries the very same event
// object across (same id, same tripsyRaw), touching only which trip's events[] holds
// it; tripsyReHomeMovedEvent then does the derived-cache bookkeeping -- the source
// trip's guide/outfits drop it exactly like a deletion, and its attached documents'
// tripKey follows it so they keep showing under the right trip card.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
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

// ---- source-pattern checks: the applier has a move_event branch with the right guards ----
const applyFn = extractFn('applyTripsyChangeToTrips');
assert(applyFn.includes("change.type === 'move_event'"), 'applyTripsyChangeToTrips handles a move_event change');
assert(/const si = trips\.findIndex\(t => \(t\.events \|\| \[\]\)\.some\(ev => tripsyEventKey\(ev\.tripsyRaw\) === change\.eventKey\)\);/.test(applyFn),
  'the SOURCE trip is located by eventKey (same as edit/delete), never by a caller-supplied tripKey that may be stale');
assert(/const di = trips\.findIndex\(t => t\.key === change\.targetTripKey\);/.test(applyFn), 'the destination is an existing trip looked up by targetTripKey');
assert(/if \(si === di\) throw new Error/.test(applyFn), 'moving an event onto the trip it is already in is refused, not silently dropped and re-added');
assert(/next\[di\] = \{ \.\.\.trips\[di\], events: sortEvents\(\[\.\.\.\(trips\[di\]\.events \|\| \[\]\), moving\]\) \};/.test(applyFn),
  'the destination gets the SAME event object appended and re-sorted -- not a re-created copy');

// ---- source-pattern checks: wired into queueTripsyChange's post-save cleanup ----
const queueSrc = html.slice(html.indexOf('async queueTripsyChange(change) {'), html.indexOf('async cancelTripsyChange('));
assert(/\(change\.type === 'edit_event' \|\| change\.type === 'delete_event' \|\| change\.type === 'move_event'\) && change\.source !== 'tripsy_update_page'/.test(queueSrc),
  'a move invalidates a saved Update-comparison page that references the event, like an edit or delete does');
assert(/const touchedByMove = change\.type === 'move_event' && tripsyReHomeMovedEvent\(change\);/.test(queueSrc),
  'THE FEATURE: a move_event runs the re-homing bookkeeping');
assert(/if \(touchedUpdatePages \|\| touchedGuidesOrOutfits \|\| touchedByMove\) await persistDriveData\(\{ silentConflict: true \}\);/.test(queueSrc),
  'folded into the existing single best-effort write, only when something actually changed');
assert(/const touchedGuidesOrOutfits = change\.type === 'delete_event'\s*\n\s*&& tripsyStripDeletedEventFromCaches\(/.test(queueSrc),
  'the pre-existing delete_event cleanup line is left byte-identical (deleteeventcascade_test pins it)');

// ---- source-pattern checks: label, icon, handler, dialog ----
assert(/move_event: '↪️ Move to trip',/.test(html), 'the in-flight/failed-write badge has a label for a move');
const iconIdx = html.indexOf('data-tripsy-move-event data-key=');
assert(iconIdx > 0, 'the timeline row renders a ↪️ Move icon');
const ownerBlockStart = html.lastIndexOf('const ownerIconsHtml = !canEditDelete', iconIdx);
const deleteIconIdx = html.indexOf('data-tripsy-delete-event data-key=', ownerBlockStart);
assert(ownerBlockStart > 0 && iconIdx > ownerBlockStart && iconIdx < deleteIconIdx,
  'the Move icon sits inside the owner-gated (canEditDelete) icon block, beside Edit/Attach/Delete -- viewers never see it');
assert(/container\.querySelectorAll\("\[data-tripsy-move-event\]"\)\.forEach\(btn => \{/.test(html), 'the Move icon has a click handler');
const handlerSrc = html.slice(html.indexOf('container.querySelectorAll("[data-tripsy-move-event]")'), html.indexOf('// Re-derives the event\'s CURRENT effective raw fields'));
assert(/const targetTripKey = await tripsyMoveEventDialog\(btn\.dataset\.tripKey, summary\);/.test(handlerSrc), 'it asks the trip picker first');
assert(/if \(!targetTripKey\) return;/.test(handlerSrc), 'Cancel / click-outside moves nothing');
assert(/type: 'move_event',/.test(handlerSrc) && /targetTripKey,/.test(handlerSrc) && /eventKey: btn\.dataset\.key,/.test(handlerSrc),
  'it queues a move_event carrying the source tripKey, the targetTripKey and the eventKey');
assert(/renderTripsyEventsList\(\);\s*\n\s*updateTripsyPendingWarningBadge\(\);/.test(handlerSrc),
  'optimistic re-render immediately after queueing, same shape as Delete');
const dialogFn = extractFn('tripsyMoveEventDialog');
assert(/\.filter\(t => t\.key !== currentTripKey\)/.test(dialogFn), "the picker excludes the event's current trip");
assert(/if \(!others\.length\) \{ toast\(/.test(dialogFn) && /resolve\(null\); return; \}/.test(dialogFn), 'with no other trip at all it explains and resolves null instead of showing an empty select');
assert(/ov\.onclick = e => \{ if \(e\.target === ov\) done\(null\); \};/.test(dialogFn), 'clicking outside cancels (resolves null), never moves');
assert(/ov\.style\.zIndex = '2147483100';/.test(dialogFn), 'same z-index tier as tripsyConfirmDialog, so it cannot open behind the timeline');

// ---- executed: applyTripsyChangeToTrips' move branch, against fixtures ----
(async () => {
  global.tripsyEventKey = raw => raw ? `${raw.resource}:${raw.id}` : null;
  // Only reached by the create/edit branches, which aren't under test here.
  global.tripsyRawToDisplay = () => ({});
  global.tripsyBlankRaw = () => ({});
  global.tripsyMintLocalId = () => 1;
  eval(applyFn.replace(/^function applyTripsyChangeToTrips/, 'var applyTripsyChangeToTrips = function'));

  const mk = (resource, id, start) => ({ id: `${resource}-${id}`, summary: `ev${id}`, start, tripsyRaw: { resource, id } });
  let e1, e2, e3, trips;
  const reset = () => {
    e1 = mk('activity', 1, '2026-09-21T10:00:00');
    e2 = mk('activity', 2, '2026-09-22T09:00:00');
    e3 = mk('activity', 3, '2026-10-07T12:00:00');
    trips = [
      { key: 'A', name: 'Cirrus Training', start: '2026-09-21', end: '2026-09-25', events: [e1, e2] },
      { key: 'B', name: 'Singapore GP', start: '2026-10-06', end: '2026-11-02', events: [e3] },
      { key: 'C', name: 'Untouched', start: '2027-03-10', end: '2027-03-15', events: [] },
    ];
    global.tripsyDecryptedTrips = trips;
  };

  reset();
  applyTripsyChangeToTrips({ type: 'move_event', tripKey: 'A', targetTripKey: 'B', eventKey: 'activity:2' });
  const next = global.tripsyDecryptedTrips;
  const A = next.find(t => t.key === 'A'), B = next.find(t => t.key === 'B'), C = next.find(t => t.key === 'C');
  assert(A.events.length === 1 && A.events[0] === e1, 'THE ASK: the event is gone from its source trip, the rest of that trip untouched');
  assert(B.events.length === 2 && B.events.includes(e2), 'and now lives in the destination trip');
  assert(B.events[0] === e2 && B.events[1] === e3, 'the destination is re-sorted by start, so the moved event lands in date order -> ' + B.events.map(e => e.start).join(', '));
  assert(B.events.find(e => e.tripsyRaw.id === 2) === e2, 'the SAME object crossed over -- same id, same tripsyRaw -- so attachments/outfits keyed on it still resolve');
  assert(C === trips[2], 'a trip not involved in the move keeps its exact original reference');
  assert(next !== trips && trips[0].events.length === 2, 'arrays are REPLACED not mutated -- the prior trips reference is intact for rollback on a failed save');

  // Refusals: each leaves the prior trips reference as-is (the caller rolls back to it).
  reset();
  let threw = null;
  try { applyTripsyChangeToTrips({ type: 'move_event', tripKey: 'A', targetTripKey: 'ZZZ', eventKey: 'activity:2' }); } catch (e) { threw = e.message; }
  assert(/trip not found: ZZZ/.test(threw || ''), 'an unknown destination trip throws rather than losing the event -> ' + threw);
  reset();
  threw = null;
  try { applyTripsyChangeToTrips({ type: 'move_event', tripKey: 'A', targetTripKey: 'A', eventKey: 'activity:2' }); } catch (e) { threw = e.message; }
  assert(/already in trip A/.test(threw || ''), 'moving onto the trip it is already in is refused -> ' + threw);
  reset();
  threw = null;
  try { applyTripsyChangeToTrips({ type: 'move_event', tripKey: 'A', targetTripKey: 'B', eventKey: 'activity:999' }); } catch (e) { threw = e.message; }
  assert(/event not found: activity:999/.test(threw || ''), 'an unknown event throws -> ' + threw);
  reset();
  // A stale caller-supplied source tripKey is harmless: the source is found by eventKey.
  applyTripsyChangeToTrips({ type: 'move_event', tripKey: 'WRONG', targetTripKey: 'B', eventKey: 'activity:2' });
  assert(global.tripsyDecryptedTrips.find(t => t.key === 'B').events.includes(e2), 'the source trip is located by eventKey, so a stale tripKey on the change cannot misroute the move');
})();

// ---- executed: tripsyReHomeMovedEvent's bookkeeping, against fixtures ----
(async () => {
  let computeCalls = 0;
  global.computeTripsyAttireBlocks = () => { computeCalls++; return { blocks: ['stub'], counts: { stub: 1 } }; };
  eval(extractFn('tripsyStripDeletedEventFromCaches').replace(/^function tripsyStripDeletedEventFromCaches/, 'var tripsyStripDeletedEventFromCaches = function'));
  eval(extractFn('tripsyReHomeMovedEvent').replace(/^function tripsyReHomeMovedEvent/, 'var tripsyReHomeMovedEvent = function'));

  const reset = () => {
    global.driveData = {
      tripsyAttireGuides: [{ tripKey: 'A', days: [{ dayKey: 'd1', events: [{ id: 'activity-1' }, { id: 'activity-2' }] }] }],
      tripsyTripOutfits: [{ tripKey: 'A', person: 'him', blocks: [{ dayKey: 'd1', eventIds: ['activity-1', 'activity-2'], garmentIds: ['g1'] }] }],
      tripsyAttachments: [
        { id: 'att-moving', scope: 'event', tripKey: 'A', eventKey: 'activity:2', fileName: 'boarding-pass.pdf' },
        { id: 'att-staying', scope: 'event', tripKey: 'A', eventKey: 'activity:1', fileName: 'other.pdf' },
        { id: 'att-trip', scope: 'trip', tripKey: 'A', eventKey: null, fileName: 'itinerary.pdf' },
      ],
    };
  };

  reset();
  const changed = tripsyReHomeMovedEvent({ type: 'move_event', tripKey: 'A', targetTripKey: 'B', eventKey: 'activity:2' });
  assert(changed === true, 'reports a change so the caller writes flight-log-data.json');
  const guide = global.driveData.tripsyAttireGuides[0];
  assert(guide.days[0].events.map(e => e.id).join() === 'activity-1', "THE ASK: the moved event is stripped from the SOURCE trip's Daily Dress Guide, like a deletion");
  assert(computeCalls === 1, 'and the guide\'s blocks/counts are recomputed');
  const outfits = global.driveData.tripsyTripOutfits[0];
  assert(outfits.blocks[0].eventIds.join() === 'activity-1' && outfits.blocks[0].garmentIds.length === 1,
    "and from the source trip's composed outfit block, garments untouched");
  const att = Object.fromEntries(global.driveData.tripsyAttachments.map(a => [a.id, a.tripKey]));
  assert(att['att-moving'] === 'B', 'THE ASK: the document attached to the moved event now files under the destination trip');
  assert(att['att-staying'] === 'A' && att['att-trip'] === 'A', 'an attachment on a different event, and a trip-scoped one, stay where they were');

  // Nothing referenced the event anywhere -> no write needed.
  reset();
  global.driveData.tripsyAttachments = [];
  const none = tripsyReHomeMovedEvent({ type: 'move_event', tripKey: 'A', targetTripKey: 'B', eventKey: 'activity:999' });
  assert(none === false, 'a move touching nothing in these caches reports no change, so the caller skips the write');
})();
