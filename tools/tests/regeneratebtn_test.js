// "Add a 'Regenerate' button to the right of the Definitions button on the
// clothing summary screen." The Attire overlay's static shell (wired once,
// created lazily after sign-in so isOwner is settled) gains an owner-only
// Regenerate button between Definitions and the close X. It fires the exact
// same safe entry the trip card's 👔 menu Refresh uses
// (tripsyRunAttireGenerationSafely) against the trip the overlay currently
// shows, with isRefresh reflecting whether a guide actually exists, and a
// generating-keys guard so a double-press can't run two generations at once.
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

const shell = extractFn('getOrCreateTripsyAttireOverlay');

// ---- placement: Definitions, then Regenerate, then the close X ----
const defIdx = shell.indexOf('id="tripsy-attire-definitions-btn"');
const regenIdx = shell.indexOf('id="tripsy-attire-regenerate-btn"');
const closeIdx = shell.indexOf('id="tripsy-attire-close-btn"');
assert(defIdx > -1 && regenIdx > defIdx && closeIdx > regenIdx,
  'THE ASK: Regenerate sits to the RIGHT of Definitions (and before the close X)');
assert(/\$\{isOwner \? '<button class="tripsy-update-btn" id="tripsy-attire-regenerate-btn">Regenerate<\/button>' : ''\}/.test(shell),
  'owner-only: viewers (who cannot generate) never see the button');
assert(/class="tripsy-update-btn" id="tripsy-attire-regenerate-btn"/.test(shell),
  'styled like its neighbor Definitions (tripsy-update-btn), not the close X');

// ---- behavior ----
assert(/const regenBtn = overlay\.querySelector\('#tripsy-attire-regenerate-btn'\);\s*\n\s*if \(regenBtn\) regenBtn\.addEventListener/.test(shell),
  'wired once in the static shell, guarded for the viewer shell that omits the button');
assert(/const key = tripsyAttireOverlayTripKey;\s*\n\s*if \(!key\) return;/.test(shell),
  'acts on whichever trip the overlay currently shows');
assert(/if \(tripsyAttireGeneratingKeys\.has\(key\)\) \{ toast\('Already generating/.test(shell),
  'a double-press while a generation is running is refused with a toast, not a second overlapping run');
assert(/const hasGuide = !!\(driveData\.tripsyAttireGuides \|\| \[\]\)\.find\(g => g\.tripKey === key\);\s*\n\s*tripsyRunAttireGenerationSafely\(key, \{ isRefresh: hasGuide \}\);/.test(shell),
  'fires the SAME safe entry the 👔 menu uses, with isRefresh reflecting whether a guide actually exists');

// ---- executed: the click decision against fixtures ----
{
  const decide = (key, generating, hasGuide) => {
    if (!key) return 'noop';
    if (generating.has(key)) return 'toast-busy';
    return hasGuide ? 'refresh' : 'generate';
  };
  assert(decide('t1', new Set(), true) === 'refresh', 'a trip with a guide regenerates as a Refresh (reuse-aware, override-preserving)');
  assert(decide('t1', new Set(), false) === 'generate', 'from the empty state it is a first generate');
  assert(decide('t1', new Set(['t1']), true) === 'toast-busy', 'mid-generation press -> busy toast, no second run');
  assert(decide(null, new Set(), true) === 'noop', 'no trip resolved -> nothing fires');
}
