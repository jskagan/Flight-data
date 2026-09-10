// "Why did the app not include the 11/6 leg of my flight from LAX to EWR when
// parsing my United Airlines flights?" (2026-09-08.) Two findings, two fixes:
//
// (1) THE CAUSE: the leg WAS parsed, then auto-ignored as a "duplicate". Mo's
// UA2303 LAX->EWR (her own PNR, O8QR3W) was already tracked in her NY trip;
// Jon's UA2303 from his confirmation (ON36SQ) matched it on resource, times,
// flight number, carrier and category -- and tripsyProposalEventIsDuplicate
// deliberately never compared confirmation numbers -- so the sweep rejected it
// before the review page could show it. A different confirmation is a
// different BOOKING, never a duplicate; the guard fires only when BOTH sides
// carry one and they differ, so an absent confirmation still never counts
// against identity and a re-forwarded confirmation still dedupes.
//
// (2) ALONG THE WAY: the intake's HTML->text step (htmlToPlainText, shared with
// the PS parsers) neither strips <style>/<script>/<head> nor keeps line breaks.
// The stored body of that real email was 16,591 chars, the first 15,140 of them
// raw CSS, with the five-leg itinerary flattened into one 1,256-char line.
// tripsyIntakeHtmlToText (intake path only) fixes that, reusing the unchanged
// htmlToPlainText per line for its entity decoding.
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

// ---- (1) source pin + executed: confirmation-aware duplicate detection ----
const dupSrc = extractFn('tripsyProposalEventIsDuplicate');
assert(/const newConf = tripsyParseIdentValue\(f\.confirmation\);\s*\n\s*const oldConf = tripsyParseIdentValue\(raw\.confirmation\);\s*\n\s*if \(newConf && oldConf && newConf !== oldConf\) continue;/.test(dupSrc),
  'THE FIX: a tracked event with a DIFFERENT confirmation number is skipped, not matched');
const identIdx = dupSrc.indexOf("for (const key of ['name', 'company', 'transportNumber', 'category'])");
assert(identIdx > 0 && dupSrc.indexOf('const newConf') < identIdx, 'the confirmation guard runs before the existing identity-field loop, which is otherwise untouched');

eval(extractFn('tripsyParseIdentValue'));
eval(dupSrc.replace(/^function /, 'var tripsyProposalEventIsDuplicate = function '));
const pev = (resource, fields) => ({ tripsyResource: resource, fields, resolution: 'pending' });
// Mo's leg, exactly as it sits in her trip: same flight, same times, HER confirmation.
const mosLeg = { tripsyRaw: { resource: 'transportation', company: 'United Airlines', transportNumber: 'UA2303', category: 'airplane',
  departureAt: '2026-11-06T23:00:00', arrivalAt: '2026-11-07T07:05:00', confirmation: 'O8QR3W' } };
const untrackedConfLeg = { tripsyRaw: { resource: 'transportation', company: 'United Airlines', transportNumber: 'UA2641', category: 'airplane',
  departureAt: '2026-11-10T15:30:00', arrivalAt: '2026-11-10T18:45:00' } }; // no confirmation recorded
const trips = [{ key: 'mo', events: [mosLeg, untrackedConfLeg] }];
const jonsLeg = { company: 'United Airlines', transportNumber: 'UA2303', category: 'airplane',
  departureAt: '2026-11-06T23:00:00', arrivalAt: '2026-11-07T07:05:00', confirmation: 'ON36SQ' };

assert(tripsyProposalEventIsDuplicate(pev('transportation', jonsLeg), trips) === false,
  "THE ASK: Jon's UA2303 under his OWN confirmation is NOT a duplicate of Mo's identical-times UA2303 -- it is shown for review");
assert(tripsyProposalEventIsDuplicate(pev('transportation', { ...jonsLeg, confirmation: ' o8qr3w ' }), trips) === true,
  'the SAME confirmation (case/whitespace-insensitive) is still a duplicate -- a re-forwarded confirmation still dedupes');
assert(tripsyProposalEventIsDuplicate(pev('transportation', { ...jonsLeg, confirmation: '' }), trips) === true,
  'a parsed event carrying NO confirmation still matches on the other identity fields, exactly as before');
assert(tripsyProposalEventIsDuplicate(pev('transportation', { company: 'United Airlines', transportNumber: 'UA2641', departureAt: '2026-11-10T15:30:00', arrivalAt: '2026-11-10T18:45:00', confirmation: 'ON36SQ' }), trips) === true,
  'a tracked event with NO confirmation recorded still matches -- an absent field never counts against identity');
assert(tripsyProposalEventIsDuplicate(pev('transportation', { ...jonsLeg, confirmation: 'ON36SQ', transportNumber: 'UA9999' }), trips) === false,
  'the pre-existing rules are untouched: a different flight number is still not identical');

// ---- (2) source pins + executed: the intake HTML -> text step ----
const fetchSrc = extractFn('fetchTripsyIntakeEmail');
assert(/body = tripsyIntakeHtmlToText\(decodeQuotedPrintableIfNeeded\(base64UrlDecodeToUtf8\(htmlData\)\)\);/.test(fetchSrc),
  'THE FIX: the email intake converts HTML through tripsyIntakeHtmlToText');
assert(!/body = htmlToPlainText\(/.test(fetchSrc), 'and no longer through the raw shared helper');
const sharedSrc = extractFn('htmlToPlainText');
assert(/\.replace\(\/\\s\+\/g, ' '\)\s*\n\s*\.trim\(\);/.test(sharedSrc) && !/style/.test(sharedSrc),
  'htmlToPlainText itself is UNCHANGED (still whitespace-collapsing, no style stripping), so the two PS parsers that call it directly are unaffected');
assert((html.match(/htmlToPlainText\(cleanHtml\)/g) || []).length === 2, 'both PS parsers still call htmlToPlainText directly');

eval(sharedSrc.replace(/^function /, 'var htmlToPlainText = function '));
eval(extractFn('tripsyIntakeHtmlToText').replace(/^function /, 'var tripsyIntakeHtmlToText = function '));

// A synthetic United-shaped email: head/style/script/comment noise, a table whose
// cells sit on separate rows, a tag whose attributes wrap across SOURCE lines,
// an encoded arrow, and a <br>.
const sample = `<html><head><title>Itin</title><STYLE type="text/css">.np_body{font-family:Arial}</STYLE></head><body>
<!-- tracking pixel --><table><tr><td>November 06, 2026</td><td>UA2303</td></tr>
<tr><td
   style="padding:0">11:00 pm</td><td>7:05 am</td></tr></table>
<p>LAX &rarr; EWR</p>Arrives next day<br><div>Confirmation number: ON36SQ</div>
<script>alert('x')</script></body></html>`;
const out = tripsyIntakeHtmlToText(sample);
const lines = out.split('\n');
assert(!/np_body|font-family|Arial/.test(out), 'THE FIX: the <style> block (even upper-cased) is stripped -- no CSS in the stored body');
assert(!/alert|tracking pixel|Itin/.test(out), '<script>, HTML comments and <head>/<title> are stripped too');
assert(lines[0] === 'November 06, 2026 UA2303' && lines[1] === '11:00 pm 7:05 am',
  'THE FIX: table rows come out as separate LINES, cells within a row separated by a space -> ' + JSON.stringify(lines.slice(0, 2)));
assert(!/style=|padding/.test(out), 'a tag whose attributes wrap across source lines is removed whole, never split into a stray fragment');
assert(lines.includes('LAX → EWR'), 'entity decoding is the shared helper\'s, unchanged (&rarr; -> →) -> ' + JSON.stringify(lines));
assert(lines.includes('Arrives next day') && lines.includes('Confirmation number: ON36SQ'), '<br> and a closing <div> each break the line');
assert(!lines.some(l => l === '') && !/\n\n/.test(out), 'no empty lines are stored');
assert(/np_body\{font-family:Arial\}/.test(htmlToPlainText(sample)), 'sanity: the raw shared helper would have kept the CSS -- this is what the intake used to store');

assert(tripsyIntakeHtmlToText('just <b>plain</b> words') === 'just plain words', 'text with no block structure stays a single line');
assert(tripsyIntakeHtmlToText('') === '' && tripsyIntakeHtmlToText(null) === '', 'empty / null input gives an empty body');
