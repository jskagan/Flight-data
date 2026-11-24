// "Build the cancellation proposal" (2026-11-24). A parsed proposal event with
// action:'cancel' names a tracked booking (or one leg of it) that was cancelled.
// It never becomes a new event: the Review Parsed Docs page lists the tracked
// events it matches and deletes the ones the owner ticks. These checks pin the
// matching rules, that cancellations stay out of duplicate/conflict/cluster
// logic, and the review-page wiring. Fixtures are synthetic.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) throw new Error('missing ' + name);
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

const src = ['tripsyParseIdentValue', 'tripsyProposalIsCancellation', 'tripsyCancellationTargets', 'tripsyProposalEventIsDuplicate']
  .map(extractFn).join('\n');
const api = new Function(`
  const tripsyEventKey = raw => raw ? raw.resource + ':' + raw.id : null;
  ${src}
  return { tripsyProposalIsCancellation, tripsyCancellationTargets, tripsyProposalEventIsDuplicate };
`)();

const ev = (raw, summary) => ({ summary, tripsyRaw: raw });
const trips = [
  { key: 'T1', name: 'Trip One', events: [
    ev({ resource: 'transportation', id: 1, confirmation: 'ABC123', transportNumber: 'XX100', departureAt: '2030-05-01T10:00:00' }, 'Leg 1'),
    ev({ resource: 'transportation', id: 2, confirmation: 'ABC123', transportNumber: 'XX200', departureAt: '2030-05-08T09:00:00' }, 'Leg 2'),
    ev({ resource: 'hosting', id: 3, name: 'Hotel A', confirmation: 'H-9', startsAt: '2030-05-01', endsAt: '2030-05-08' }, 'Hotel A'),
    ev({ resource: 'activity', id: 4, name: 'Dinner B', startsAt: '2030-05-02T19:00:00' }, 'Dinner B'),
  ] },
  { key: 'T2', name: 'Trip Two', events: [
    ev({ resource: 'hosting', id: 5, name: 'Hotel A', confirmation: 'H-9', startsAt: '2030-05-01', endsAt: '2030-05-08' }, 'Hotel A twin'),
  ] },
];
const keys = r => r.map(x => x.eventKey).sort().join(',');
const cancel = (resource, fields, extra) => ({ action: 'cancel', tripsyResource: resource, fields, resolution: 'pending', ...extra });

assert(api.tripsyProposalIsCancellation(cancel('activity', {})), 'action:cancel is a cancellation');
assert(!api.tripsyProposalIsCancellation({ fields: {} }), 'an ordinary proposal is not');

assert(keys(api.tripsyCancellationTargets(cancel('transportation', { confirmation: 'abc123', departureAt: '2030-05-08T09:00:00' }), trips)) === 'transportation:2',
  'confirmation picks the booking, the start narrows it to the cancelled leg (case-insensitive)');
assert(keys(api.tripsyCancellationTargets(cancel('transportation', { confirmation: 'ABC123', transportNumber: 'XX100' }), trips)) === 'transportation:1',
  'a flight number narrows to its leg');
assert(keys(api.tripsyCancellationTargets(cancel('transportation', { confirmation: 'ABC123' }), trips)) === 'transportation:1,transportation:2',
  'a whole-booking cancellation lists every leg');
assert(keys(api.tripsyCancellationTargets(cancel('transportation', { confirmation: 'ABC123', departureAt: '2030-06-01T09:00:00' }), trips)) === 'transportation:1,transportation:2',
  'a narrowing that would leave nothing is skipped, not applied');
assert(keys(api.tripsyCancellationTargets(cancel('hosting', { confirmation: 'H-9' }), trips)) === 'hosting:3,hosting:5',
  'the same booking stored twice is listed twice, for the owner to tick');
assert(api.tripsyCancellationTargets(cancel('activity', { confirmation: 'H-9' }), trips).length === 0,
  'the resource must match');
assert(keys(api.tripsyCancellationTargets(cancel('activity', { name: 'dinner b', startsAt: '2030-05-02T19:00:00' }), trips)) === 'activity:4',
  'with no confirmation, an exact start AND a matching name match');
assert(api.tripsyCancellationTargets(cancel('activity', { startsAt: '2030-05-02T19:00:00' }), trips).length === 0,
  'with no confirmation, a start alone matches nothing');
assert(api.tripsyCancellationTargets(cancel('activity', { name: 'Dinner B' }), trips).length === 0,
  'with no confirmation, a name alone matches nothing');
assert(keys(api.tripsyCancellationTargets(cancel('hosting', { confirmation: 'H-9' }, { targetEventKey: 'hosting:5' }), trips)) === 'hosting:5',
  'a targetEventKey that exists wins outright');
assert(keys(api.tripsyCancellationTargets(cancel('hosting', { confirmation: 'H-9' }, { targetEventKey: 'hosting:99' }), trips)) === 'hosting:3,hosting:5',
  'a stale targetEventKey falls back to the confirmation');

assert(!api.tripsyProposalEventIsDuplicate(cancel('activity', { name: 'Dinner B', startsAt: '2030-05-02T19:00:00' }), trips),
  'a cancellation is never auto-ignored as a duplicate of the event it names');
assert(api.tripsyProposalEventIsDuplicate({ tripsyResource: 'activity', fields: { name: 'Dinner B', startsAt: '2030-05-02T19:00:00' } }, trips),
  'an ordinary identical proposal still is');

// ---- source pins ----
const has = (fn, re, msg) => assert(re.test(extractFn(fn)), msg);
has('tripsyParseConflictTripKeys', /!tripsyProposalIsCancellation\(e\)/, 'conflict trip keys skip cancellations');
has('tripsyParseConflictEventCount', /!tripsyProposalIsCancellation\(e\)/, 'conflict count skips cancellations');
has('renderTripsyParseReview', /tripsyProposalIsCancellation\(ev\)\) continue/, 'new-trip clusters skip cancellations');
has('tripsyParseReviewCardHtml', /tripsyProposalIsCancellation\(ev\)\) return tripsyParseCancellationRowHtml/, 'the card renders a cancellation row');
has('tripsyParseCancellationRowHtml', /data-parse-cancel-target[\s\S]*targets\.length === 1 \? 'checked'/, 'a single match is pre-ticked');
has('tripsyParseCancellationRowHtml', /data-parse-cancel-apply[\s\S]*data-parse-reject/, 'Delete and Ignore buttons');
has('tripsyParseCancellationRowHtml', /No matching event[\s\S]*Dismiss/, 'no match offers Dismiss');
has('renderTripsyParseReview', /type: 'delete_event'[\s\S]*if \(ok\) deleted\.push[\s\S]*resolution: 'cancelled'/,
  'Delete runs delete_event per ticked event, then resolves the proposal as cancelled');
has('renderTripsyParseReview', /deleted\.length < targets\.length[\s\S]*return;/, 'a partial failure keeps the proposal pending');
has('renderTripsyEventsListImpl', /tripsyProposalIsCancellation\(ev\)[\s\S]*tripsyCancellationTargets\(ev, trips\)/,
  'the trip-card badge counts a cancellation on the trip holding its event');
assert(/async finishTripsyParseProposalEvent\(proposalId, eventId, patch\)/.test(html)
  && /rejectTripsyParseProposalEvent\(proposalId, eventId\) \{\s*return this\.finishTripsyParseProposalEvent\(proposalId, eventId, \{ resolution: 'rejected' \}\)/.test(html),
  'Reject goes through the shared finish method');
has('tripsyLocalParseSchema', /cancellation: \{ type: 'boolean' \}/, 'the in-app parser schema carries a cancellation flag');
has('tripsyLocalParsePrompt', /cancellation: true ONLY when/, 'its prompt says when to set it');
has('tripsyLocalParseToProposalEvents', /ev\.cancellation === true \? \{ action: 'cancel' \}/, 'and it becomes action:cancel');
