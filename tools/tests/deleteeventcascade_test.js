// "When I delete an event from the my trips page, it should also be deleted from all
// pages, itinerary, daily dress, schedule, etc." Investigation: deleting an event
// (applyTripsyChangeToTrips) only ever touched the live trips array -- the Daily Dress
// Guide (driveData.tripsyAttireGuides) and composed Outfits (driveData.tripsyTripOutfits)
// are separate SNAPSHOTS that kept showing the deleted event until a manual
// Refresh/Regenerate, and the Itinerary's own "out of date" ▲ badge only ever detected
// ADDED/MODIFIED events -- a pure deletion tripped no signal at all, so the generated
// narrative silently kept describing something that no longer existed. Fixed three ways:
// (1) tripsyStripDeletedEventFromCaches mechanically removes the deleted event from the
// guide's days/blocks and any outfit block's eventIds (no Claude call needed, these are
// just structured lists); (2) tripsyItineraryChangedEvents now also detects a baseline
// key with no matching current event as changeType 'deleted', driving the ▲ badge like
// any other change; (3) the itinerary baseline records lightweight per-event
// day/summary metadata so a later deletion can still be shown in the changes dialog
// after the real event is gone.
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

// ---- source-pattern checks: the mechanical cache-cleanup helper ----
const stripFn = extractFn('tripsyStripDeletedEventFromCaches');
assert(stripFn.includes('driveData.tripsyAttireGuides'), 'sanity: extracted the real function');
assert(/const matches = id => id === hyphenBase \|\| \(typeof id === 'string' && id\.startsWith\(hyphenBase \+ '-'\)\);/.test(stripFn),
  'matches the exact hyphen id OR any multi-day check-in/checkout/begin/end suffixed variant');
assert(/const \{ blocks, counts \} = computeTripsyAttireBlocks\(guide\.days\);/.test(stripFn),
  'recomputes displayCategory/blocks/counts after removing events, same as every other guide mutation');
assert(/\.filter\(day => day\.events\.length > 0\)/.test(stripFn), 'a day left with no events is dropped, not shown empty');
assert(/\.filter\(b => b\.eventIds\.length > 0\)/.test(stripFn),
  'an outfit block that loses ALL its events (every one deleted) is dropped entirely');

// ---- source-pattern checks: wired into queueTripsyChange's delete_event path ----
// (an object-literal method, "async queueTripsyChange(change) {", not the plain
// "async function X(" shape extractFn handles -- sliced by its neighboring sibling.)
const queueSrc = html.slice(html.indexOf('async queueTripsyChange(change) {'), html.indexOf('async cancelTripsyChange('));
assert(/const touchedGuidesOrOutfits = change\.type === 'delete_event'\s*\n\s*&& tripsyStripDeletedEventFromCaches\(change\.tripKey, change\.eventKey\.replace\(':', '-'\)\);/.test(queueSrc),
  'THE FIX: a delete_event change triggers the cache cleanup, converting the colon eventKey to the hyphen id space');
assert(/if \(touchedUpdatePages \|\| touchedGuidesOrOutfits\) await persistDriveData\(\{ silentConflict: true \}\);/.test(queueSrc),
  'only writes when something actually changed, combined with the existing Update-page cleanup into one write');

// ---- source-pattern checks: itinerary deletion detection ----
const baselineFn = extractFn('tripsyItineraryBaselineFromEvents');
assert(/meta\[key\] = \{ dayKey: tripsyDayKey\(ev\.start\) \|\| null, summary: ev\.summary \|\| 'Event' \};/.test(baselineFn),
  'the baseline now also records lightweight day/summary info per event, for later deletion display');

const changedFn = extractFn('tripsyItineraryChangedEvents');
assert(/for \(const key of Object\.keys\(baseline\.fp\)\) \{\s*\n\s*if \(currentKeys\.has\(key\)\) continue;/.test(changedFn),
  'THE FIX: every baseline key is checked against the CURRENT event set, not just current events checked against baseline');
assert(/changeType: 'deleted', blurbStale: false, dayKey: m && m\.dayKey, summary: m && m\.summary \}\);/.test(changedFn),
  "a deleted entry carries no live ev, using the baseline's own saved day/summary instead");

// ---- source-pattern checks: the changes dialog handles a null `ev` safely ----
const dialogFn = extractFn('showTripsyItineraryChangesDialog');
assert(/const dayKeyFor = c => c\.ev \? \(tripsyDayKey\(c\.ev\.start\) \|\| 'undated'\) : \(c\.dayKey \|\| 'undated'\);/.test(dialogFn),
  "day-grouping falls back to the deleted entry's own stored dayKey when there is no live ev");
assert(/const tag = c\.changeType === 'added' \? 'New' : c\.changeType === 'deleted' \? 'Deleted' : 'Modified';/.test(dialogFn),
  'a deleted row is labeled distinctly, not lumped in with Modified');
assert(/const summary = c\.ev \? \(c\.ev\.summary \|\| 'Event'\) : \(c\.summary \|\| 'Event'\);/.test(dialogFn),
  "row text falls back to the deleted entry's own stored summary when there is no live ev");

// ---- executed: tripsyStripDeletedEventFromCaches' own logic, against fixtures ----
(async () => {
  // computeTripsyAttireBlocks pulls in a large chunk of the Attire subsystem unrelated
  // to what's being tested here (block-grouping, display-category propagation, ...,
  // already covered by its own tests) -- stubbed exactly like outfit_stale_test.js does,
  // just enough to prove tripsyStripDeletedEventFromCaches actually CALLS it after
  // mutating guide.days.
  let computeCallCount = 0;
  global.computeTripsyAttireBlocks = days => { computeCallCount++; return { blocks: ['stub-block'], counts: { stub: 1 } }; };
  eval(stripFn.replace(/^function tripsyStripDeletedEventFromCaches/, 'var tripsyStripDeletedEventFromCaches = function'));

  let driveData;
  const reset = () => {
    driveData = {
      tripsyAttireGuides: [{
        tripKey: 'T1',
        days: [
          { dayKey: 'd1', events: [{ id: 'activity-1', category: 'casual' }, { id: 'activity-2', category: 'casual' }] },
          { dayKey: 'd2', events: [{ id: 'activity-3', category: 'smart_casual' }] },
        ],
      }],
      tripsyTripOutfits: [{
        tripKey: 'T1', person: 'him',
        blocks: [
          { dayKey: 'd1', eventIds: ['activity-1', 'activity-2'], garmentIds: ['g1'] },
          { dayKey: 'd2', eventIds: ['activity-3'], garmentIds: ['g2'] },
        ],
      }],
    };
  };

  // Deleting one of TWO events in a day/block -- the day/block survives, just shrinks.
  reset();
  let changed = tripsyStripDeletedEventFromCaches('T1', 'activity-1');
  assert(changed === true, 'reports a real change was made');
  const guide1 = driveData.tripsyAttireGuides[0];
  assert(guide1.days.length === 2 && guide1.days[0].events.length === 1 && guide1.days[0].events[0].id === 'activity-2',
    'THE ASK: the deleted event is gone from the Daily Dress Guide, its day survives with the other event');
  const outfits1 = driveData.tripsyTripOutfits[0];
  assert(outfits1.blocks[0].eventIds.length === 1 && outfits1.blocks[0].eventIds[0] === 'activity-2',
    'and gone from the composed outfit block, which keeps its remaining event and garments');
  assert(outfits1.blocks[0].garmentIds.length === 1, 'the block\'s garments are untouched -- only the dangling event id is removed');

  // Deleting the ONLY event in a day/block -- the day and block are dropped entirely.
  reset();
  changed = tripsyStripDeletedEventFromCaches('T1', 'activity-3');
  const guide2 = driveData.tripsyAttireGuides[0];
  assert(guide2.days.length === 1 && guide2.days[0].dayKey === 'd1',
    'THE ASK: a day left with nothing on it is dropped, not shown empty -> ' + JSON.stringify(guide2.days.map(d => d.dayKey)));
  const outfits2 = driveData.tripsyTripOutfits[0];
  assert(outfits2.blocks.length === 1 && outfits2.blocks[0].dayKey === 'd1',
    'and a block with nothing left to dress is dropped entirely');

  // A multi-day event's split "-checkin"/"-checkout" rows both get removed from one delete.
  reset();
  driveData.tripsyAttireGuides[0].days[0].events.push({ id: 'hosting-9-checkin', category: 'casual' });
  driveData.tripsyAttireGuides[0].days[1].events.push({ id: 'hosting-9-checkout', category: 'casual' });
  changed = tripsyStripDeletedEventFromCaches('T1', 'hosting-9');
  const guide3 = driveData.tripsyAttireGuides[0];
  const remainingIds = guide3.days.flatMap(d => d.events.map(e => e.id));
  assert(!remainingIds.includes('hosting-9-checkin') && !remainingIds.includes('hosting-9-checkout'),
    'THE ASK: BOTH split halves of a deleted multi-day event are removed, not just the exact id -> ' + JSON.stringify(remainingIds));

  // Nothing matches -- no-op, no write needed.
  reset();
  changed = tripsyStripDeletedEventFromCaches('T1', 'activity-999');
  assert(changed === false, 'a delete that touches nothing in these caches reports no change, so the caller skips the write');

  // A different trip's guide/outfits are never touched.
  reset();
  changed = tripsyStripDeletedEventFromCaches('T2', 'activity-1');
  assert(changed === false && driveData.tripsyAttireGuides[0].days[0].events.length === 2,
    'a delete on a DIFFERENT trip leaves this trip\'s caches alone');
})();

// ---- executed: the itinerary deletion-detection logic itself, against fixtures ----
(async () => {
  const run = async (baseline, currentEvents) => {
    // Mirrors tripsyItineraryChangedEvents' own control flow exactly (pinned by the
    // source-pattern assertions above to this same shape) -- a minimal re-implementation
    // since the real function depends on many My-Trips-only globals (isOwner, Store, ...).
    const key = ev => ev.key;
    const fp = ev => ev.fp;
    const changed = [];
    const currentKeys = new Set();
    for (const ev of currentEvents) {
      currentKeys.add(key(ev));
      if (!(key(ev) in baseline.fp)) changed.push({ ev, key: key(ev), changeType: 'added' });
      else if (baseline.fp[key(ev)] !== fp(ev)) changed.push({ ev, key: key(ev), changeType: 'modified' });
    }
    for (const k of Object.keys(baseline.fp)) {
      if (currentKeys.has(k)) continue;
      const m = (baseline.meta && baseline.meta[k]) || null;
      changed.push({ ev: null, key: k, changeType: 'deleted', dayKey: m && m.dayKey, summary: m && m.summary });
    }
    return changed;
  };

  const baseline = {
    fp: { 'activity:1': 'fpA', 'activity:2': 'fpB' },
    meta: { 'activity:1': { dayKey: 'd1', summary: 'Museum Tour' }, 'activity:2': { dayKey: 'd2', summary: 'Dinner' } },
  };

  // event 1 deleted (missing from current), event 2 unchanged.
  let changed = await run(baseline, [{ key: 'activity:2', fp: 'fpB' }]);
  assert(changed.length === 1 && changed[0].changeType === 'deleted' && changed[0].key === 'activity:1',
    'THE ASK: a deleted event (in baseline, missing from current) is now detected at all -> ' + JSON.stringify(changed));
  assert(changed[0].ev === null, 'a deleted entry carries no live event object');
  assert(changed[0].dayKey === 'd1' && changed[0].summary === 'Museum Tour',
    'and surfaces its day/name from the baseline\'s own saved metadata -> ' + JSON.stringify(changed[0]));

  // Both events still present, nothing changed at all.
  changed = await run(baseline, [{ key: 'activity:1', fp: 'fpA' }, { key: 'activity:2', fp: 'fpB' }]);
  assert(changed.length === 0, 'nothing deleted, nothing modified -> no changes at all, unaffected by this fix');

  // A baseline recorded before `meta` existed (undefined) degrades safely.
  const oldBaseline = { fp: { 'activity:1': 'fpA' } }; // no .meta at all
  changed = await run(oldBaseline, []);
  assert(changed.length === 1 && changed[0].dayKey == null && changed[0].summary == null,
    'a pre-existing baseline with no meta still detects the deletion, just without day/name -> ' + JSON.stringify(changed[0]));
})();
