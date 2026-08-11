const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const src = ['tripsyContentFingerprint', 'tripsyEventKey', 'tripsyItineraryEventKey', 'tripsyItineraryEventFingerprint',
  'tripsyItineraryBlurbFingerprint', 'tripsyItineraryBaselineFromEvents', 'tripsyDayKey', 'parseTripLocalParts',
  'tripsyIsFlightEvent', 'expandMultiDayTripsyEvents'].map(extractFn).join('\n');

const ev = (over = {}) => ({
  id: 'a1', summary: 'Dinner at Founders', start: '2026-05-24T01:00:00', end: '',
  location: '', notes: '',
  tripsyRaw: { resource: 'activity', category: 'restaurant', address: '1 Main St', ...(over.raw || {}) },
  ...over,
});
// The rule the dialog applies, lifted verbatim from tripsyItineraryChangedEvents.
const decide = `
const staleFor = (before, after) => {
  const base = tripsyItineraryBaselineFromEvents([before]);
  const key = tripsyItineraryEventKey(after);
  const changed = tripsyItineraryEventFingerprint(after) !== base.fp[key];
  const prev = base.bfp ? base.bfp[key] : null;
  return { changed, blurbStale: prev == null ? true : prev !== tripsyItineraryBlurbFingerprint(after) };
};`;

fs.writeFileSync(__dirname + '/blurbstale_run.js', `
${src}
${decide}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const base = ${JSON.stringify(ev())};
const clone = o => JSON.parse(JSON.stringify(o));

// A pure TIME move: flagged as changed, but the blurb still describes it correctly.
const moved = clone(base); moved.start = '2026-05-24T02:30:00'; moved.end = '2026-05-24T04:00:00';
let r = staleFor(base, moved);
assert(r.changed, 'a time move counts as a modification');
assert(!r.blurbStale, 'but its summary blurb is KEPT');

// A retitled event: the blurb now describes the wrong thing.
const retitled = clone(base); retitled.summary = 'Dinner at Bestia';
r = staleFor(base, retitled);
assert(r.changed && r.blurbStale, 'a retitled event drops its blurb');

// A moved VENUE, same title and time.
const relocated = clone(base); relocated.tripsyRaw.address = '99 Other Ave';
r = staleFor(base, relocated);
assert(r.changed && r.blurbStale, 'a new address drops its blurb');

// Notes / category / company all count too.
for (const [label, mut] of [
  ['notes', e => { e.notes = 'window table'; }],
  ['category', e => { e.tripsyRaw.category = 'theater'; }],
  ['company', e => { e.tripsyRaw.company = 'Amtrak'; }],
  ['confirmation', e => { e.tripsyRaw.confirmation = 'XYZ'; }],
]) {
  const m = clone(base); mut(m);
  const rr = staleFor(base, m);
  assert(rr.changed && rr.blurbStale, label + ' change drops its blurb');
}

// Untouched event: neither flag.
r = staleFor(base, clone(base));
assert(!r.changed && !r.blurbStale, 'an untouched event is not flagged at all');

// A baseline recorded BEFORE bfp existed assumes stale -- the safe direction.
const legacy = tripsyItineraryBaselineFromEvents([base]);
delete legacy.bfp;
const key = tripsyItineraryEventKey(moved);
const prev = legacy.bfp ? legacy.bfp[key] : null;
assert(prev == null, 'legacy baseline has no bfp -> treated as stale');

// RENDER-TIME suppression keys off the UNEXPANDED event, but the summary rows it guards
// are built from EXPANDED ones. A multi-day hotel must resolve to the same key on both
// halves, or its check-in/check-out rows could never be matched to the baseline.
const stay = { id: 'h9', summary: 'Conrad Los Angeles', start: '2026-05-22T15:00:00', end: '2026-05-24T12:00:00',
  location: '', notes: '', type: 'hotel', tripsyRaw: { resource: 'hosting', id: 1233459, category: '', address: '100 S Grand' } };
const halves = expandMultiDayTripsyEvents([stay]);
assert(halves.length === 2, 'the stay splits into two rows');
assert(halves.every(h => tripsyItineraryEventKey(h) === tripsyItineraryEventKey(stay)),
  'both halves resolve to the underlying event key -> ' + halves.map(tripsyItineraryEventKey).join(', '));
// And the reason the fingerprint is computed on the UNEXPANDED event: a half's own
// fingerprint does NOT match the baseline, so keying off it would flag every stay stale.
const stayBase = tripsyItineraryBaselineFromEvents([stay]);
assert(halves.some(h => tripsyItineraryBlurbFingerprint(h) !== stayBase.bfp[tripsyItineraryEventKey(stay)]),
  'a split half fingerprints differently -- hence unexpanded');
`);
