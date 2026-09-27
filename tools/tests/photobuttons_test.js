// "The buttons on the photos in the itinerary are not working" (2026-09-27).
// The 🔄🗂🔍📋🚫 photo controls were wired as a delegated listener created
// inline inside previewTripsyItinerary, on the PREVIEW overlay's content node
// only -- the partial itinerary's full mode renders the very same cards
// (buttons included) into its own overlay, which never had that wiring, so
// every photo button there was dead. The wiring is now ONE top-level
// function, wireTripsyPhotoCardControls(contentEl), called by both overlays.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) return null;
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

const wire = extractFn('wireTripsyPhotoCardControls');
assert(!!wire, 'the photo-controls wiring is a top-level function, not code trapped inside the Preview overlay\'s creation');
assert((html.match(/wireTripsyPhotoCardControls\(/g) || []).length === 3,
  'called from exactly two places (Preview\'s content node and the partial overlay\'s) plus its own definition');
assert(/wireTripsyPhotoCardControls\(previewContent\);/.test(html),
  'Preview wires it on its content node, replacing the old inline listeners');
{
  const partial = extractFn('getOrCreateTripsyPartialOverlay');
  assert(/wireTripsyPhotoCardControls\(overlay\.querySelector\('#tripsy-partial-content'\)\)/.test(partial),
    'THE FIX: the partial overlay wires the same controls -- its full mode shows the same cards, so the same buttons now work');
}
// The handler is DELEGATED (one listener on the container, resolving the card
// per click), so it survives the innerHTML swaps every re-render does --
// which is also why wiring the getOrCreate\'d node once is enough.
assert(/contentEl\.addEventListener\('click', async e => \{/.test(wire)
  && /contentEl\.addEventListener\('keydown', e => \{/.test(wire),
  'one delegated click listener (all five buttons) plus the Enter-to-search keydown, both on the container');
assert(/e\.target\.closest\('\.tp-place-card'\)/.test(wire),
  'everything resolves per CARD from data- attributes, so any container showing print-built cards is served');
assert(!/previewContent/.test(wire),
  'no Preview-specific reference survives inside the shared function');

// Executed: the function attaches its two listeners to whatever node it is given.
{
  const listeners = [];
  const stub = { addEventListener: (type, fn) => listeners.push(type) };
  const f = new Function('contentEl', extractFn('wireTripsyPhotoCardControls').replace(/^function /, 'var wireTripsyPhotoCardControls = function ')
    + '\nwireTripsyPhotoCardControls(contentEl);');
  f(stub);
  assert(listeners.sort().join(',') === 'click,keydown',
    'calling it wires exactly the click + keydown pair onto the given node');
}
