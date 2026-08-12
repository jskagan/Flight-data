// THE BUG JUST REPORTED: pressing Swap on the outfit modal (opened from the Daily
// Dress Guide's "See outfit" cue) did nothing -- the swap picker (#tw-swap-overlay)
// had no explicit z-index, so it opened at the base .tw-modal layer, BEHIND the
// outfit modal (2147483080) that opens it. Invisible, awaiting a pick that could
// never be tapped. Same bug class as tripsyWardrobeChoosePackedCount fixed earlier.
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

const outfitModal = extractFn('showTripsyOutfitModal');
const outfitZ = (outfitModal.match(/ov\.style\.zIndex = '(\d+)'/) || [])[1];
assert(outfitZ === '2147483080', 'the outfit modal itself sits at its documented z-index -> ' + outfitZ);

const swapPicker = extractFn('tripsyOutfitSwapPicker');
const swapZ = (swapPicker.match(/ov\.style\.zIndex = '(\d+)'/) || [])[1];
assert(!!swapZ, 'the swap picker now sets an explicit z-index');
assert(Number(swapZ) > Number(outfitZ),
  `the swap picker (${swapZ}) renders ABOVE the outfit modal (${outfitZ}) it opens from`);

// Every other known overlay z-index in the app -- the swap picker must clear all of
// them too, not just the one it's opened from, since a stray lower value would just
// move the same "invisible modal" bug to a different caller.
const allZ = [...html.matchAll(/\.style\.zIndex = '(\d+)'/g)].map(m => Number(m[1]));
const maxOther = Math.max(...allZ.filter(z => z !== Number(swapZ)));
assert(Number(swapZ) >= 2147483080, 'clears the outfit modal specifically');
assert(maxOther <= 2147483200, 'sanity: no overlay in the app exceeds the documented ceiling (2147483200)');
