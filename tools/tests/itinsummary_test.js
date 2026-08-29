// Itinerary -> Summary (asked 2026-08-29): "the first part of the total itinerary -- the
// listing of events broken down by dates with no narratives", read-only, with a save-as-PDF
// option.
//
// Built by giving buildTripsyPrintHtml a `summaryOnly` mode rather than writing a second
// renderer, so the Summary screen and its PDF can never drift from what Print produces for
// the same section. Two properties this suite protects:
//   1. READ-ONLY BY CONSTRUCTION. The screen shows print HTML, which contains no controls
//      at all -- as opposed to reusing previewTripsyItinerary and hiding its owner editing
//      controls one by one, where a newly-added control would silently appear here too.
//   2. The early return happens BEFORE Part 2 / Travel Information, so their per-place
//      photo lookups (the slow part of a full build) are skipped rather than computed and
//      thrown away.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) return '';
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
  return '';
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the builder's summary-only mode ----
const build = extractFn('buildTripsyPrintHtml');
assert(/async function buildTripsyPrintHtml\(tripKey, \{ summaryOnly = false \} = \{\} \)?/.test(build.replace(/\s+/g, ' ')) ||
       /\{ summaryOnly = false \} = \{\}/.test(build),
  'summaryOnly defaults to false, so every pre-existing caller behaves exactly as before');
const iSummary = build.indexOf('const summaryHtml =');
const iReturn = build.indexOf('if (summaryOnly) return');
const iPart2 = build.indexOf('part2Html');
const iTravel = build.indexOf('travelInfoHtml');
assert(iSummary > -1 && iReturn > iSummary, 'the early return comes after Part 1 is built');
assert(iReturn > -1 && iReturn < iPart2 && iReturn < iTravel,
  'and BEFORE Part 2 / Travel Information -- their photo lookups are skipped, not wasted');
assert(/if \(summaryOnly\) return `\$\{headerHtml\}\$\{summaryHtml\}`;/.test(build),
  'it returns exactly the cover header plus the day-by-day listing -- no narrative');

// ---- no dead affordances: nothing to jump to without Part 2 ----
assert((build.match(/summaryOnly \? '' : ' tp-day-block-linkable'/g) || []).length === 2,
  'both day-block kinds (with events, and empty ranges) drop the linkable class in summary mode');
assert((build.match(/summaryOnly \? '' : ` data-tripsy-summary-day-link/g) || []).length === 2,
  'and drop the jump attribute, so nothing promises a scroll that cannot happen');

// ---- READ-ONLY: the summary-only path emits no interactive markup ----
{
  const emitted = build.slice(0, iReturn); // everything that can reach the summary output
  for (const control of ['<button', '<input', '<textarea', 'contenteditable', 'data-tripsy-generate']) {
    assert(!emitted.includes(control), `the summary-only path emits no ${control}`);
  }
}

// ---- the screen itself ----
const show = extractFn('showTripsyItinerarySummary');
assert(/buildTripsyPrintHtml\(tripKey, \{ summaryOnly: true \}\)/.test(show),
  'the Summary screen renders the summary-only build');
assert(/Building summary…/.test(show), 'it shows a placeholder while building rather than an empty box');
assert(/content\.scrollTop = 0;/.test(show), 'and opens at the top rather than wherever a previous view left it');
const overlay = extractFn('getOrCreateTripsySummaryOverlay');
assert(/id="tripsy-summary-pdf-btn"/.test(overlay) && /Save as PDF/.test(overlay),
  'THE ASK: the screen offers Save as PDF');
assert(/openTripsyItineraryPrintView\(overlay\.dataset\.tripKey \|\| '', \{ summaryOnly: true \}\)/.test(overlay),
  'which prints the summary-only build -- the browser print dialog is where Save as PDF lives on macOS/iOS');
assert(!/previewTripsyItinerary/.test(overlay) && !/previewTripsyItinerary/.test(show),
  'it does NOT reuse the editable preview overlay, whose owner controls are exactly what must not appear here');
assert(/e\.target === overlay/.test(overlay), 'click-outside closes it, same rule as the preview overlay');

// ---- print isolation: this overlay must not print alongside the print root ----
assert(/#tripsy-preview-overlay, #tripsy-summary-overlay \{ display: none !important; \}/.test(html),
  'the Summary overlay is hidden in @media print, or it would print on top of #tripsy-print-root');

// ---- the menu entry ----
{
  const start = html.indexOf('// Create/Delete are the two states of one owner-only button:');
  const menu = html.slice(start, start + 3000);
  assert(/data-tripsy-summary-itinerary/.test(menu), 'THE ASK: a Summary item exists in the Itinerary menu');
  assert(/'📅', 'Summary'/.test(menu), 'labelled Summary');
  // Available to everyone: it only reads existing data, exactly like Print.
  assert(!/isOwner \? menuListButtonHtml\(`data-tripsy-summary-itinerary/.test(menu),
    'and is not owner-gated -- it is a read-only view, like Print');
  assert(menu.indexOf('data-tripsy-summary-itinerary') < menu.indexOf('data-tripsy-print-itinerary'),
    'sitting above Print, with which it shares the most');
}
assert(/container\.querySelectorAll\("\[data-tripsy-summary-itinerary\]"\)/.test(html),
  'the menu item is wired up');
