// "When there are new events that are parsed that are identical to existing events,
// ignore the new events automatically and do not show them to the user."
// tripsyProposalEventIsDuplicate judges identity conservatively (same resource, same
// start to the minute, and every identity field the PARSED side carries -- end/name/
// company/transportNumber/category -- matching the tracked event; an unspecified
// field never counts against identity, a specified-but-different one keeps the event
// reviewable). tripsyAutoIgnoreDuplicateProposals sweeps every still-pending proposal
// event through it, resolving duplicates exactly as a manual Reject would
// (resolution:'rejected' + autoIgnored:'duplicate', proposal finished/deleted when
// nothing stays pending), run from syncTripsyRelays (after trips load), after a
// local parse (with the toast count corrected), and at the top of the review page.
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

// ---- source patterns: the three call sites ----
const sync = extractFn('syncTripsyRelays');
const decryptIdx = sync.indexOf('await ensureTripsyDecrypted()');
const sweepIdx = sync.indexOf('await tripsyAutoIgnoreDuplicateProposals()');
const badgeIdx = sync.indexOf('await updateTripsyStatusBadge()');
assert(decryptIdx > -1 && sweepIdx > decryptIdx && badgeIdx > sweepIdx,
  'syncTripsyRelays sweeps AFTER trips load and BEFORE the badge refresh, so an all-duplicates drain never flashes a badge');
const localParse = extractFn('runTripsyLocalParse');
assert(/staged = Math\.max\(0, staged - await tripsyAutoIgnoreDuplicateProposals\(\)\);/.test(localParse),
  'a local parse sweeps too, and corrects the toast count so hidden duplicates are never announced');
const review = extractFn('renderTripsyParseReview');
assert(review.indexOf('tripsyAutoIgnoreDuplicateProposals()') > -1
  && review.indexOf('tripsyAutoIgnoreDuplicateProposals()') < review.indexOf('listTripsyParseProposals()'),
  'THE ASK: the review page itself sweeps before listing -- a duplicate is never shown');

// ---- executed: the identity predicate ----
eval(extractFn('tripsyParseIdentValue'));
eval(extractFn('tripsyProposalEventIsDuplicate').replace(/^function /, 'var tripsyProposalEventIsDuplicate = function '));
const trips = [{
  key: 't1', events: [
    { tripsyRaw: { resource: 'activity', name: 'Dinner at Le Bernardin', category: 'restaurant', startsAt: '2026-09-10T19:00:00', endsAt: '2026-09-10T21:00:00' } },
    { tripsyRaw: { resource: 'transportation', company: 'NetJets', transportNumber: '123', category: 'airplane', departureAt: '2026-09-08T10:00:00', arrivalAt: '2026-09-08T14:00:00' } },
    { tripsyRaw: { resource: 'hosting', name: 'The Carlyle', startsAt: '2026-09-08T15:00:00', endsAt: null } },
  ],
}];
const pev = (resource, fields) => ({ tripsyResource: resource, fields, resolution: 'pending' });

assert(tripsyProposalEventIsDuplicate(pev('activity', { name: 'Dinner at Le Bernardin', category: 'restaurant', startsAt: '2026-09-10T19:00:00', endsAt: '2026-09-10T21:00:00' }), trips) === true,
  'THE ASK: an exact re-parse of a tracked event is a duplicate');
assert(tripsyProposalEventIsDuplicate(pev('activity', { name: '  dinner at LE BERNARDIN ', startsAt: '2026-09-10T19:00:00' }), trips) === true,
  'case/whitespace differences and unspecified fields (no end, no category) do not defeat identity');
assert(tripsyProposalEventIsDuplicate(pev('activity', { name: 'Dinner at Le Bernardin', startsAt: '2026-09-10T20:00:00' }), trips) === false,
  'a different start time is a different event -- still shown');
assert(tripsyProposalEventIsDuplicate(pev('activity', { name: 'Dinner at Le Bernardin', startsAt: '2026-09-10T19:00:00', endsAt: '2026-09-10T22:00:00' }), trips) === false,
  'a DIFFERENT specified end is new information -- still shown');
assert(tripsyProposalEventIsDuplicate(pev('transportation', { company: 'NetJets', transportNumber: '123', departureAt: '2026-09-08T10:00:00', arrivalAt: '2026-09-08T14:00:00' }), trips) === true,
  'a flight matched on company + number + times is a duplicate');
assert(tripsyProposalEventIsDuplicate(pev('transportation', { company: 'NetJets', transportNumber: '456', departureAt: '2026-09-08T10:00:00' }), trips) === false,
  'same times but a different flight number is NOT identical');
assert(tripsyProposalEventIsDuplicate(pev('activity', { name: 'Dinner at Le Bernardin' }), trips) === false,
  'no start time at all -> no identity to establish, never auto-ignored');
assert(tripsyProposalEventIsDuplicate(pev('hosting', { name: 'The Carlyle', startsAt: '2026-09-08T15:00:00', endsAt: '2026-09-12T11:00:00' }), trips) === false,
  'a specified end against a tracked event with NO end is new information (a checkout date) -- still shown');
assert(tripsyProposalEventIsDuplicate(pev('transportation', { departureAt: '2026-09-10T19:00:00' }), trips) === false,
  'the same clock time on a DIFFERENT resource is not a duplicate');

// ---- executed: the sweep, with a stubbed store ----
(async () => {
  const sweepSrc = extractFn('tripsyAutoIgnoreDuplicateProposals')
    .replace(/^async function /, 'var tripsyAutoIgnoreDuplicateProposals = async function ');
  let persisted = 0;
  const ctx = {
    isOwner: true,
    tripsyDecryptedTrips: trips,
    driveData: {
      tripsyAttachments: [{ id: 'att1', parseStatus: 'staged' }],
      tripsyParseProposals: [
        { id: 'p1', attachmentId: 'att1', events: [
          pev('activity', { name: 'Dinner at Le Bernardin', startsAt: '2026-09-10T19:00:00' }), // duplicate
        ] },
        { id: 'p2', attachmentId: null, events: [
          pev('activity', { name: 'Dinner at Le Bernardin', startsAt: '2026-09-10T19:00:00' }), // duplicate
          pev('activity', { name: 'Brand New Lunch', startsAt: '2026-09-11T12:00:00' }),        // genuinely new
        ] },
      ],
    },
    persistDriveData: async () => { persisted++; },
    tripsyProposalEventIsDuplicate,
  };
  const run = new Function('isOwner', 'tripsyDecryptedTrips', 'driveData', 'persistDriveData', 'tripsyProposalEventIsDuplicate',
    sweepSrc + '\nreturn tripsyAutoIgnoreDuplicateProposals();');
  const ignored = await run(ctx.isOwner, ctx.tripsyDecryptedTrips, ctx.driveData, ctx.persistDriveData, ctx.tripsyProposalEventIsDuplicate);

  assert(ignored === 2, 'both duplicate events were auto-ignored in one sweep');
  assert(persisted === 1, 'one persist for the whole sweep');
  assert(!ctx.driveData.tripsyParseProposals.some(p => p.id === 'p1'),
    'a proposal left with nothing pending is finished and deleted, like a manual Reject');
  assert(ctx.driveData.tripsyAttachments[0].parseStatus === 'done',
    'and its source attachment is marked done');
  const p2 = ctx.driveData.tripsyParseProposals.find(p => p.id === 'p2');
  assert(p2 && p2.events[0].resolution === 'rejected' && p2.events[0].autoIgnored === 'duplicate',
    "a duplicate resolves as 'rejected' (the manual-Reject vocabulary) with the autoIgnored marker recording why");
  assert(p2.events[1].resolution === 'pending',
    'THE ASK, other half: the genuinely NEW event in the same proposal stays pending and IS shown');

  // Trips not loaded -> the sweep does nothing rather than guessing.
  const before = JSON.stringify(ctx.driveData.tripsyParseProposals);
  const none = await run(true, null, ctx.driveData, ctx.persistDriveData, ctx.tripsyProposalEventIsDuplicate);
  assert(none === 0 && JSON.stringify(ctx.driveData.tripsyParseProposals) === before && persisted === 1,
    'with trips still null nothing is touched and nothing is persisted');
})();
