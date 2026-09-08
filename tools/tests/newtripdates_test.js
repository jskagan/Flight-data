// "When I select Create a new trip from the Review Parsed Docs page, I only get
// the option to select a name for the trip, not the dates, and I cannot add later
// flights that are imported at the same time to that trip." (2026-09-08.)
// One design gap, two symptoms that compound: the per-event import path used a
// bare prompt() for a NAME and hardcoded the trip to a single day (the event's
// own); every event card's destination dropdown then offered ONLY date-matched
// trips, so the just-created one-day trip was invisible to the return flight a
// few days later; and the nicer "create a trip for these N events" offer only
// ever clustered events WITHIN one proposal, so two flights from two emails never
// got it. Fixed three ways: (1) tripsyNewTripDialog asks for name + start + end,
// defaulting to the event's own span; (2) tripsyParseTripOptionsHtml keeps
// date-matched trips first (still the default) but offers every other trip under
// an "Other trips" group; (3) tripsyParseFindClusters clusters ACROSS proposals,
// rendered once at the top of the page, and the cluster accept resolves each
// event inside its own proposal.
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

// ---- (1) the per-event "Create a new trip" path asks for dates ----
const importFn = extractFn('tripsyParseImportProposalEvent');
assert(!/\bprompt\(/.test(importFn), 'THE FIX: the bare name-only prompt() is gone');
assert(/const picked = await tripsyNewTripDialog\(\{ name: event\.eventSummary \|\| 'New Trip', start: startDay, end: /.test(importFn),
  'it opens the name + dates dialog, defaulting name to the event summary and the range to the event\'s own span');
assert(/const endDayRaw = tripsyDayKey\(fields\.endsAt \|\| fields\.arrivalAt\) \|\| startDay;/.test(importFn),
  'the default end comes from the event\'s own end (a hotel\'s check-out, a flight\'s arrival day), falling back to the start');
assert(/tripKey, name: tripName, start: picked\.start, end: picked\.end,/.test(importFn),
  'THE FIX: the create_trip change carries the dates the reviewer picked, not a hardcoded single day');
assert(/if \(!picked\) return false;/.test(importFn), 'Cancel imports nothing');

const dialogFn = extractFn('tripsyNewTripDialog');
assert(/type="date" data-newtrip-start/.test(dialogFn) && /type="date" data-newtrip-end/.test(dialogFn), 'the dialog has real start and end date inputs');
assert(/if \(!nm\) \{ err\.textContent = 'Enter a name for the trip\.'; return; \}/.test(dialogFn), 'an empty name is refused in place, not silently accepted');
assert(/if \(!s\) s = e;\s*\n\s*if \(!e\) e = s;/.test(dialogFn), 'a missing start or end is filled from the other');
assert(/if \(e < s\) \[s, e\] = \[e, s\];/.test(dialogFn), 'an end before the start is swapped rather than refused');
assert(/ov\.onclick = e => \{ if \(e\.target === ov\) done\(null\); \};/.test(dialogFn), 'clicking outside cancels (resolves null)');
assert(/ov\.style\.zIndex = '2147483100';/.test(dialogFn), 'same z-index tier as the other small dialogs, so it cannot open behind the page');

// ---- (2) the destination dropdown offers every trip, date-matched first ----
assert(/select\.innerHTML = tripsyParseTripOptionsHtml\(day, tripsyDecryptedTrips\);/.test(extractFn('tripsyRefreshTripSelect')),
  'tripsyRefreshTripSelect (after a Modify changes the date) uses the shared option builder');
const cardFn = extractFn('tripsyParseReviewCardHtml');
assert(/const selectOptions = tripsyParseTripOptionsHtml\(dayKey, tripsyDecryptedTrips\);/.test(cardFn),
  'the review card\'s first render uses the same builder, so the two can never disagree');
assert(!cardFn.includes('data-parse-cluster-box') && !cardFn.includes('tripsyParseFindCluster('),
  'the per-card cluster box is gone -- clustering moved to the page level');

(async () => {
  global.tripsyDayKey = s => (s ? String(s).slice(0, 10) : null);
  global.esc = s => String(s);
  global.formatTripDateRange = (a, b) => `${a}–${b}`;
  eval(extractFn('tripsyParseMatchTrips').replace(/^function tripsyParseMatchTrips/, 'var tripsyParseMatchTrips = function'));
  eval(extractFn('tripsyParseTripOptionsHtml').replace(/^function tripsyParseTripOptionsHtml/, 'var tripsyParseTripOptionsHtml = function'));

  const trips = [
    { key: 'A', name: 'Cirrus Training', start: '2026-09-21', end: '2026-09-25' },
    { key: 'B', name: 'Singapore GP', start: '2026-10-06', end: '2026-11-02' },
    { key: 'C', name: 'Telluride', start: '2027-03-10', end: '2027-03-15' },
  ];
  const optionOrder = h => [...h.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);

  // A day inside trip A: A is first and selected, then Create new, then the rest.
  let h = tripsyParseTripOptionsHtml('2026-09-23', trips);
  assert(optionOrder(h).join() === 'A,__new__,C,B', 'THE ASK: matched trip first, then Create new, then EVERY other trip (newest first) -> ' + optionOrder(h).join());
  assert(/<option value="A" selected>/.test(h), 'the first date-matched trip is the default -- unchanged behaviour');
  assert(!/<option value="__new__" selected>/.test(h), 'Create new is NOT selected when something matched');
  assert(/<optgroup label="Other trips">/.test(h), 'the non-matching trips sit under an "Other trips" group');
  assert(/<option value="C">Telluride \(2027-03-10–2027-03-15\)<\/option>/.test(h), 'other trips show their dates, since out-of-range trips need disambiguating');
  assert(/<option value="A" selected>Cirrus Training<\/option>/.test(h), 'a matched trip keeps its plain name label, as before');
  assert((h.match(/value="A"/g) || []).length === 1, 'a matched trip is not repeated inside Other trips');

  // A day matching nothing: Create new is selected explicitly, and every trip is still pickable.
  h = tripsyParseTripOptionsHtml('2026-12-01', trips);
  assert(optionOrder(h).join() === '__new__,C,B,A', 'THE ASK: with no date match, every existing trip is still offered -> ' + optionOrder(h).join());
  assert(/<option value="__new__" selected>/.test(h), 'Create new is the explicit default when nothing matches -- the browser would otherwise pick the first Other trip');

  // No date at all behaves like no match.
  h = tripsyParseTripOptionsHtml(null, trips);
  assert(optionOrder(h).join() === '__new__,C,B,A' && /"__new__" selected/.test(h), 'an undated event gets Create new selected and every trip offered');

  // No trips at all: just Create new, no empty group.
  h = tripsyParseTripOptionsHtml('2026-09-23', []);
  assert(optionOrder(h).join() === '__new__' && !/optgroup/.test(h), 'with no trips there is only Create new and no empty Other trips group');
})();

// ---- (3) clustering across proposals ----
const renderSrc = extractFn('renderTripsyParseReview');
assert(/const clusters = tripsyParseFindClusters\(unmatched\);/.test(renderSrc), 'THE FIX: the page computes clusters over ALL proposals\' unmatched events');
assert(/for \(const p of proposals\) \{\s*\n\s*for \(const ev of p\.events\) \{/.test(renderSrc), 'the unmatched set is gathered across every proposal, not per card');
assert(/data-parse-cluster-box data-event-refs=/.test(renderSrc), 'each cluster box carries "<proposalId>:<eventId>" refs, since it can span proposals');
assert(/container\.innerHTML = clusterHtml \+ proposals\.map/.test(renderSrc), 'cluster offers render once, above the cards');
assert(/box\.dataset\.eventRefs\.split\(','\)/.test(renderSrc) && /const i = ref\.indexOf\(':'\);/.test(renderSrc),
  'the accept handler resolves each ref back to its own proposal + event');
assert(/proposalId: proposal\.id,\s*\n\s*eventId: ev\.id,/.test(renderSrc), 'every event change names the proposal it belongs to');
assert(/Store\.acceptTripsyParseProposalCluster\(\{ tripChange, eventChanges \}\)/.test(renderSrc), 'and the Store call no longer assumes a single proposal');
assert(/if \(!dayKeys\.length\) \{ toast\("Those events have no dates to build a trip from\."/.test(renderSrc), 'a cluster with no dated events cannot silently make a dateless trip');

const storeSrc = html.slice(html.indexOf('async acceptTripsyParseProposalCluster('), html.indexOf('// Raw forwarded-email intake'));
assert(/const pid = ec\.proposalId \|\| proposalId;/.test(storeSrc), 'the Store groups event changes by their own proposalId, falling back to the old single-proposal param');
assert(/for \(const \[pid, changes\] of byProposal\) \{/.test(storeSrc), 'THE FIX: each proposal in the cluster is resolved, not just one');
assert(/driveData\.tripsyParseProposals = driveData\.tripsyParseProposals\.filter\(p => p\.id !== pid\);/.test(storeSrc), 'a proposal left with nothing pending is finished, per proposal');

(async () => {
  global.tripsyDayKey = s => (s ? String(s).slice(0, 10) : null);
  global.TRIPSY_PARSE_CLUSTER_MAX_SPAN_DAYS = 45;
  eval(extractFn('tripsyParseFindClusters').replace(/^function tripsyParseFindClusters/, 'var tripsyParseFindClusters = function'));

  const P1 = { id: 'p1', sourceFileName: 'Fwd: United eTicket' }, P2 = { id: 'p2', sourceFileName: 'Fwd: United return' }, P3 = { id: 'p3', sourceFileName: 'Ski' };
  const ev = (id, day) => ({ id, eventSummary: id, fields: day ? { departureAt: `${day}T10:00:00` } : {} });

  // THE ASK: an outbound and a return flight from two different emails form ONE cluster.
  let out = ev('out', '2026-10-10'), ret = ev('ret', '2026-10-17');
  let clusters = tripsyParseFindClusters([{ proposal: P2, event: ret }, { proposal: P1, event: out }]);
  assert(clusters.length === 1, 'THE ASK: two flights from two proposals cluster together -> ' + clusters.length);
  assert(clusters[0].start === '2026-10-10' && clusters[0].end === '2026-10-17', 'the cluster carries the real start..end range for the new trip -> ' + clusters[0].start + '..' + clusters[0].end);
  assert(clusters[0].events.map(x => x.event.id).join() === 'out,ret', 'events come out in day order regardless of input order');
  assert(clusters[0].events[0].proposal === P1 && clusters[0].events[1].proposal === P2, 'each event keeps its own proposal, so the accept can resolve it in the right place');

  // A far-off singleton (a lone Feb flight) neither joins the Oct cluster nor is offered alone.
  clusters = tripsyParseFindClusters([{ proposal: P1, event: out }, { proposal: P2, event: ret }, { proposal: P3, event: ev('feb', '2027-02-01') }]);
  assert(clusters.length === 1 && clusters[0].events.length === 2, 'an event more than 45 days out starts its own cluster, and a lone event is not offered -> ' + JSON.stringify(clusters.map(c => c.events.length)));

  // Two genuinely separate trips get two offers, instead of one all-or-nothing span check cancelling both.
  clusters = tripsyParseFindClusters([{ proposal: P1, event: out }, { proposal: P2, event: ret }, { proposal: P3, event: ev('feb1', '2027-02-01') }, { proposal: P3, event: ev('feb3', '2027-02-03') }]);
  assert(clusters.length === 2 && clusters[0].start === '2026-10-10' && clusters[1].start === '2027-02-01', 'two separate future trips each get their own offer -> ' + clusters.map(c => c.start).join(', '));

  // Undated events are skipped; a single dated event yields nothing.
  clusters = tripsyParseFindClusters([{ proposal: P1, event: out }, { proposal: P2, event: ev('nodate', null) }]);
  assert(clusters.length === 0, 'an undated event cannot place a trip and a lone dated one is not offered');
  assert(tripsyParseFindClusters([]).length === 0, 'no unmatched events, no offers');
})();
