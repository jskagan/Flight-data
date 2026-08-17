const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
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

// ---- static wiring ----
assert(/\.tripsy-itin-warning--generating \{ animation: tripsy-attire-badge-blink/.test(html),
  'the Edit menu item ▲ has a blink rule');
assert(/tripsy-attire-badge-blink 1s steps\(1, end\) infinite/.test(
  (html.match(/\.tripsy-itin-warning--generating \{[^}]*\}/) || [''])[0]),
  'and it shares the glyph badge keyframes, so the two blink in step');
// There are four reduced-motion blocks in the file; take the one that governs these badges.
const rm = (html.match(/@media \(prefers-reduced-motion: reduce\) \{[^@]*?tripsy-itin-glyph-badge--generating[^@]*?\}\s*\}/) || [''])[0];
assert(/tripsy-itin-warning--generating/.test(rm), 'and is disabled under reduced-motion like its siblings');

const refresh = extractFn('tripsyRefreshItineraryGeneratingBadges');
assert(/data-tripsy-itin-warning/.test(refresh), 'the badge sweep also drives the menu-item ▲');
assert(/classList\.toggle\('tripsy-itin-warning--generating', running\)/.test(refresh), 'toggling the blink by run state');
assert(/el\.style\.display = 'inline-flex'/.test(refresh),
  'and force-SHOWING it: a run started from an already-open page triggers no My Trips render');
assert(!/el\.style\.display = 'none'/.test(refresh),
  'but never hiding it -- whether it shows otherwise is the changed-events pass\'s call');

// ---- the glyph tap mid-run reports instead of opening the menu ----
const toggle = html.slice(html.indexOf('wireTripsyHeaderMenuToggle("[data-tripsy-itinerary-menu-toggle]"'),
                          html.indexOf('wireTripsyHeaderMenuToggle("[data-tripsy-trip-menu-toggle]"'));
assert(/await tripsyItineraryProgressDialog\(tripKey\);\s*\n\s*return false;/.test(toggle),
  'mid-run it shows the progress dialog and does NOT open the menu');
assert(toggle.indexOf('tripsyItineraryProgressDialog') < toggle.indexOf('Itinerary is out of date'),
  'and that check comes BEFORE the out-of-date review prompt');
assert(/if \(!isOwner \|\| !badge\) return true;/.test(toggle),
  'a viewer, or no badge at all, still just opens the menu');

// ---- the dialog reports live, and says so when the run ends ----
const dlg = extractFn('tripsyItineraryProgressDialog');
assert(/Update in progress/.test(dlg), 'it states that an update is in progress');
assert(/tripsyItineraryGeneratingStatus\.get\(tripKey\)/.test(dlg), 'and displays that run\'s status');
assert(/tripsyItineraryProgressWatchers\.set\(ov, paint\)/.test(dlg), 'registering for live repaints');
assert(/tripsyItineraryProgressWatchers\.delete\(ov\)/.test(dlg), 'and deregistering on close');
assert(/'Finished\.'/.test(dlg), 'once the run ends it says Finished rather than freezing on a stage');
assert(/data-itin-progress-ok/.test(dlg) && !/data-confirm-no/.test(dlg),
  'single OK button -- there is nothing to decide');

// ---- the run publishes each stage, through ONE helper ----
// The end anchor also appears far EARLIER in the file, so search for it from the start
// index -- a bare indexOf produced a backwards (empty) slice and passed nothing.
const runStart = html.indexOf('const checkedDayKeys = [...new Set(');
const run = html.slice(runStart, html.indexOf('document.body.appendChild(overlay);', runStart));
assert(/const setStage = text => \{[\s\S]*?status\.textContent = text;[\s\S]*?tripsySetItineraryGeneratingStatus\(trip\.key, text\)/.test(run),
  'one helper writes both the dialog line and the shared status');
for (const [stage, label] of [
  ['Generating write-ups for', 'generating'],
  ['Fetching photos', 'photos'],
  ['Saving…', 'saving'],
]) assert(run.includes(stage), `the run reports its ${label} stage`);
// The old final 'Opening itinerary…' stage is GONE by design (2026-08-17: "do not
// automatically open the itinerary view") -- Continue now ends in the three-way
// Close / Itinerary View / Trips View dialog instead of an unconditional jump.
// See itindonedialog_test.js for that dialog's own coverage.
assert(!run.includes('Opening itinerary…'), 'no auto-open stage remains');
assert(/setStage\(checkedDayKeys\.length\s*\n?\s*\? 'Could not generate/.test(run),
  'a failure is reported through the same channel, not just in the dialog');
assert(!/status\.textContent = 'Generating…'/.test(run), 'the old fixed "Generating…" line is gone');
// Only a real regeneration publishes: "Opening itinerary…" with nothing checked must not
// make the glyph claim a run is happening.
assert(/if \(checkedDayKeys\.length\) tripsySetItineraryGeneratingStatus/.test(run),
  'nothing checked publishes no status, matching the badge rule');
// Cleanup must clear the status and repaint, or a later dialog shows a stale stage.
assert(/tripsyItineraryGeneratingStatus\.delete\(trip\.key\)/.test(run), 'the finally clears the status');
assert(/tripsyItineraryProgressWatchers\.forEach/.test(run), 'and repaints any open dialog');

// ---- the status helper is defined before use and tolerates a broken watcher ----
const setter = extractFn('tripsySetItineraryGeneratingStatus');
assert(/try \{ fn\(\); \} catch/.test(setter), 'a dead dialog cannot break the run');
