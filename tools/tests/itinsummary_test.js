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

// ---- Email: a prefilled draft, because the app cannot send ----
// gmail.readonly cannot send mail, and a web page cannot attach a file to an email, so
// the itinerary travels as text in a mailto: body and the owner sends it themselves.
{
  assert(/id="tripsy-summary-email-btn"/.test(overlay), 'THE ASK: the Summary screen has an Email button');
  assert(/const TRIPSY_MAILTO_SAFE_LENGTH = 1800;/.test(overlay),
    'a conservative mailto length ceiling exists');
  assert(/if \(full\.length <= TRIPSY_MAILTO_SAFE_LENGTH\)/.test(overlay),
    'the check measures the ENCODED mailto URL, not the raw text -- encoding inflates it by ~1.5x');
  assert(/navigator\.clipboard\.writeText\(text\)/.test(overlay),
    'over the ceiling it copies the full text rather than sending a silently truncated itinerary');
  assert(/catch \(e\) \{[\s\S]*?Clipboard write failed[\s\S]*?\}/.test(overlay),
    'and a refused clipboard (permissions/insecure context/old WebView) is caught, not thrown');
  assert(/copying it to the clipboard was refused[\s\S]*?Save as PDF instead and attach the file/.test(overlay),
    'in that case it says so honestly and points at the attachment route');
  // The message must come BEFORE the mailto: hand-off. Opening a mail client takes
  // focus, so a toast fired alongside it is shown in a window nobody is looking at --
  // reported as "no content in the email, no toast message", i.e. this path running
  // invisibly and looking broken.
  const tooLongIdx = overlay.indexOf('Too long to prefill');
  const copiedIdx = overlay.indexOf('Copied to clipboard');
  const blankMailtoIdx = overlay.indexOf("if (openBlank) window.location.href = `mailto:?subject=");
  assert(tooLongIdx > -1 && copiedIdx > -1 && blankMailtoIdx > copiedIdx,
    'the owner is told what happened BEFORE any mail client is opened, not after');
  assert(/tripsyConfirmDialog\([\s\S]*?title: 'Copied to clipboard'/.test(overlay),
    'and via a dialog that waits to be dismissed, not a toast that auto-hides behind the mail app');
  assert(/yes: 'Open blank draft', no: 'Just copy'/.test(overlay),
    'opening a blank draft is offered, not forced -- an empty draft is not obviously wanted');
  const text = extractFn('buildTripsyItinerarySummaryText');
  assert(/buildTripsyPrintDayData\(trip\)/.test(text),
    'the text is built from the same day data as the HTML summary, so the two cannot list different events');
  assert(/tripsyDiaryScheduleLines\(/.test(text),
    'reusing the diary schedule rows keeps per-row wording consistent across surfaces');
}
{
  // Executed: the prefill-vs-clipboard decision, at realistic sizes.
  const decide = t => (`mailto:?subject=${encodeURIComponent('Itinerary — Trip')}&body=${encodeURIComponent(t)}`.length <= 1800)
    ? 'prefill' : 'clipboard';
  const shortTrip = ['Trip', 'Jun 19 – Jun 22, 2026', '', 'Day 1 — Fri, Jun 19', '  4:00 PM  Hotel Check-in'].join('\n');
  assert(decide(shortTrip) === 'prefill', 'a short trip prefills the draft');
  const rows = [];
  for (let d = 1; d <= 17; d++) {
    rows.push('', `Day ${d} — Mon, Aug ${d}`);
    for (let e = 0; e < 4; e++) rows.push('  9:00 AM  Some Event Name Here (123 Example Street, Somewhere, UK)');
  }
  assert(decide(['Trip', 'Aug 1 – Aug 17, 2026', ...rows].join('\n')) === 'clipboard',
    'a long trip falls back to clipboard rather than truncating');
}

// ---- print isolation: this overlay must not print alongside the print root ----
assert(/#tripsy-preview-overlay, #tripsy-summary-overlay \{ display: none !important; \}/.test(html),
  'the Summary overlay is hidden in @media print, or it would print on top of #tripsy-print-root');

// ---- printing started BY THE BROWSER also prints the summary ----
// Reported: printing from the Summary screen produced "the app's own interface". Save
// as PDF adds body.tripsy-printing, but Cmd+P / Share->Print add nothing -- so the app
// behind the overlay printed instead. The screen now keeps the print root loaded and
// marks the body while it is open, covering every route into printing.
assert(/body\.tripsy-summary-open > \*:not\(#tripsy-print-root\) \{ display: none !important; \}/.test(html),
  'a browser-initiated print hides the app when the Summary screen is open');
assert(/body\.tripsy-summary-open #tripsy-print-root \{ display: block !important; \}/.test(html),
  'and reveals the print root instead');
assert(/getOrCreateTripsyPrintRoot\(\)\.innerHTML = html;\s*\n\s*document\.body\.classList\.add\('tripsy-summary-open'\);/.test(show),
  'the print root is loaded with the SAME html the screen shows, so the two cannot differ');
{
  // Closing must undo both, or a later Cmd+P elsewhere in the app prints this stale summary.
  const closeFn = overlay.slice(overlay.indexOf('const close = () => {'), overlay.indexOf('overlay.querySelector(\'#tripsy-summary-close-btn\')'));
  assert(/classList\.remove\('tripsy-summary-open'\)/.test(closeFn), 'closing drops the print marker');
  assert(/printRoot\.innerHTML = ''/.test(closeFn), 'and clears the print root, so no stale summary can print later');
}

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
