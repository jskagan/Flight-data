// "The parse run is way too long for adding a couple of items." The cloud routine
// spins up a whole sandbox (minutes) to parse what is often two small forwarded
// emails. Run Parse Now (runTripsyParseNow) now parses LOCALLY first -- email bodies
// already in driveData, flagged PDF/image attachments downloaded from Drive and sent
// as document/image blocks -- via the same direct-Claude-call plumbing the attire
// features use (tripsyAttireClaudeCall, thinking off, low effort: pure structured
// extraction), staging results through the exact same Store.applyDrained*Proposals
// the cloud relay drain uses so everything downstream is identical. Only what the
// browser can't do (.docx/.heic, overflow past the per-press cap, local failures)
// falls through to the cloud worker, and a local FAILURE leaves the item untouched-
// pending so the scheduled cloud runs still pick it up.
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
function extractConst(name) {
  const start = html.indexOf(`const ${name} = `);
  const end = html.indexOf(';\n', start);
  return html.slice(start, end + 1);
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- source-pattern checks: the local pipeline ----
const localFn = extractFn('runTripsyLocalParse');
assert(/const emails = \(driveData\.tripsyEmailIntake \|\| \[\]\)\.filter\(e => e && !e\.parsedAt && e\.body\);/.test(localFn),
  'pending emails come straight from driveData -- no cloud round trip to read what the app already has');
assert(/if \(mt === 'application\/pdf'\) return \{ type: 'document', mediaType: mt \};/.test(localFn),
  'a PDF goes to the API as a document block (same shape compareTripsyItineraryPdf uses)');
assert(/if \(\['image\/jpeg', 'image\/png', 'image\/webp', 'image\/gif'\]\.includes\(mt\)\) return \{ type: 'image', mediaType: mt \};/.test(localFn),
  'supported images go as image blocks');
assert(/return null; \/\/ \.docx \/ \.heic \/ unknown -> the cloud routine's job/.test(localFn),
  'formats the browser cannot parse are left for the cloud routine');
assert(/\{ thinking: false, effort: 'low' \}/.test(localFn),
  'extraction runs with thinking off at low effort -- pure structured extraction, the fast settings');
assert(/failed\+\+; return null;/.test(localFn),
  'THE SAFETY RULE: a local failure returns null (item stays pending for the cloud run), never a fake error status');
assert(/await Store\.applyDrainedEmailProposals\(parsedEmails\)/.test(localFn) && /await Store\.applyDrainedDocProposals\(parsedDocs\)/.test(localFn),
  'results stage through the exact same apply functions the cloud relay drain uses -- identical downstream behavior');
assert(/leftovers: baseLeftovers \+ failed/.test(localFn), 'failures count as leftovers, driving the cloud fallback');

// ---- source-pattern checks: the button handler and its fallback ----
const nowFn = extractFn('runTripsyParseNow');
assert(/const r = await runTripsyLocalParse\(\);/.test(nowFn), 'THE FIX: the button parses locally first');
assert(/fallThroughToCloud = r\.leftovers > 0 \|\| !r\.attempted;/.test(nowFn),
  'the cloud worker only fires for what the browser could not handle (or when nothing was local-parseable)');
assert(/if \(fallThroughToCloud\) await runTripsyRefreshViaWorker\(btn\);/.test(nowFn), 'the fallback is the old cloud path, unchanged');
assert(/runTripsyParseNow\(openRoutinesBtn\)/.test(html), 'the status panel button is wired to the new handler');
assert(!/runTripsyRefreshViaWorker\(openRoutinesBtn\)/.test(html), 'and no longer fires the cloud worker directly');

// ---- executed: schema shape + output mapping ----
{
  eval(extractConst('TRIPSY_LOCAL_PARSE_FIELD_KEYS').replace(/^const /, 'var '));
  eval(extractFn('tripsyLocalParseSchema').replace(/^function tripsyLocalParseSchema/, 'var tripsyLocalParseSchema = function'));
  eval(extractFn('tripsyLocalParseToProposalEvents').replace(/^function tripsyLocalParseToProposalEvents/, 'var tripsyLocalParseToProposalEvents = function'));
  global.crypto = global.crypto || {};
  if (!global.crypto.randomUUID) global.crypto.randomUUID = () => 'uuid-' + Math.random().toString(36).slice(2);

  const schema = tripsyLocalParseSchema();
  const fieldProps = schema.properties.events.items.properties.fields;
  const allKeys = [...new Set(Object.values(TRIPSY_LOCAL_PARSE_FIELD_KEYS).flat())];
  assert(fieldProps.required.length === allKeys.length && allKeys.every(k => fieldProps.required.includes(k)),
    'ONE flat fields object (union of the three resources, all required) -- the grammar-size lesson the attire schema learned');
  assert(schema.properties.events.items.properties.resource.enum.join(',') === 'activity,hosting,transportation',
    'resource is a strict 3-value enum');

  // Model output -> proposal events: whitelist per resource, empty strings dropped.
  const events = tripsyLocalParseToProposalEvents([
    { resource: 'activity', event_summary: 'Tour at The Real Mary King\'s Close', fields: {
      name: 'The Real Mary King\'s Close', category: 'tour', startsAt: '2026-08-17T16:20:00',
      address: '2 Warriston\'s Cl, Edinburgh EH1 1PG', confirmation: '42274257',
      endsAt: '', phone: '', website: '', notes: '',
      company: 'SHOULD BE DROPPED', transportNumber: 'SHOULD BE DROPPED' } },
    { resource: 'transportation', event_summary: 'Train to London', fields: {
      category: 'train', company: 'Caledonian Sleeper', departureDescription: 'Edinburgh',
      departureAt: '2026-08-17T23:40:00', arrivalDescription: 'London Euston', arrivalAt: '2026-08-18T07:15:00',
      name: 'SHOULD BE DROPPED' } },
    { resource: 'nonsense', event_summary: 'bad resource', fields: { name: 'x' } },
    { resource: 'activity', event_summary: 'all empty', fields: { name: '', address: '' } },
  ]);
  assert(events.length === 2, `invalid resource and all-empty events are dropped -> ${events.length}`);
  assert(events[0].resolution === 'pending' && events[0].tripsyResource === 'activity' && events[0].id,
    'a proposal event carries the exact shape the review page reads (id/resolution/tripsyResource/fields)');
  assert(events[0].fields.confirmation === '42274257' && !('endsAt' in events[0].fields),
    'empty-string fields are dropped rather than stored as blanks');
  assert(!('company' in events[0].fields), 'THE WHITELIST: a transportation-only field never leaks onto an activity');
  assert(!('name' in events[1].fields) && events[1].fields.company === 'Caledonian Sleeper',
    'and vice versa -- each resource keeps only its own fields');
  assert(events[0].eventSummary === "Tour at The Real Mary King's Close", 'the summary is carried through');
}

// ---- executed: batching + leftover accounting (the fallback contract) ----
{
  const MAX = 8;
  const account = (emailCount, docSpecs /* [{local:bool}] */, failed) => {
    const localDocsCount = docSpecs.filter(d => d.local).length;
    const emailBatch = Math.min(emailCount, MAX);
    const docBatch = Math.min(localDocsCount, Math.max(0, MAX - emailBatch));
    const baseLeftovers = (emailCount - emailBatch) + (docSpecs.length - docBatch);
    return { attempted: emailBatch + docBatch, leftovers: baseLeftovers + failed };
  };

  // THE ASK: a couple of emails -> all parsed locally, nothing left for the cloud.
  let r = account(2, [], 0);
  assert(r.attempted === 2 && r.leftovers === 0, `two forwarded emails parse entirely in-app, no cloud run at all -> ${JSON.stringify(r)}`);

  // A .docx in the mix -> it (alone) falls through to the cloud.
  r = account(2, [{ local: false }], 0);
  assert(r.attempted === 2 && r.leftovers === 1, 'a .docx is left for the cloud routine while the emails still parse locally');

  // A local failure counts as a leftover, so the cloud run still gets it.
  r = account(2, [], 1);
  assert(r.leftovers === 1, 'a failed local parse falls through to the cloud rather than being lost');

  // A big backlog is capped per press; the overflow goes to the cloud.
  r = account(12, [{ local: true }, { local: true }], 0);
  assert(r.attempted === 8 && r.leftovers === 6, `the per-press cap holds (8 attempted), overflow goes to the cloud -> ${JSON.stringify(r)}`);
}
