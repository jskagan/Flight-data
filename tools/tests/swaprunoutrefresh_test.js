// "When there is a message in the daily dress guide saying that it ran out of a
// garment and the user swaps a different garment for the missing garment, why doesn't
// the error message clear?" Root cause: the run-out bar (renderOpts.laundryInfo, from
// tripsyLaundryRunOutByDay) is computed ONCE when the guide opens and cached in
// renderOpts, then reused on every renderOpts.rerender() call -- but the outfit modal's
// Swap handler never told the guide behind it that anything changed, so it kept naming
// a garment that had already been swapped away. Fixed with an opts.onSwapped callback
// threaded from the guide's outfit-block click handler into showTripsyOutfitModal,
// fired right after a successful swap save, which recomputes laundryInfo fresh and
// re-renders the guide.
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

// ---- showTripsyOutfitModal fires opts.onSwapped right after a successful swap save ----
const modal = extractFn('showTripsyOutfitModal');
// Optimistic since 2026-10-05: the in-memory change is real immediately, so onSwapped
// fires BEFORE the background save, and again if that save fails and rolls back.
assert(modal.indexOf('if (opts.onSwapped) opts.onSwapped();') < modal.indexOf('Store.saveTripsyTripOutfits(outfits)'),
  'onSwapped fires on the optimistic change, before the modal repaints itself');
assert(/if \(opts\.onSwapped\) opts\.onSwapped\(\);\s*\n\s*showTripsyOutfitModal\(tripKey, eventId, person, opts\);/.test(modal),
  'the modal still repaints itself too -- onSwapped is additive, not a replacement');
// A failed save must NOT fire onSwapped -- nothing actually changed.
const swapBlock = modal.slice(modal.indexOf("btn.onclick = async () => {"), modal.indexOf('if (opts.onSwapped)') + 40);
assert(/if \(!ok\) \{\s*\n\s*block\.garmentIds = prevIds;[\s\S]{0,200}if \(opts\.onSwapped\) opts\.onSwapped\(\);/.test(modal),
  'a failed save rolls back and refreshes the guide again');

// ---- the Daily Dress Guide's outfit-block click handler wires the shared refresh
// callback (refreshLaundryInfo -- also reused by the laundry-day trigger, see
// laundryrefresh_test.js, since a wash/Not Dirty needs the identical refresh) ----
const guideRender = extractFn('renderTripsyDressGuideInto');
assert(/const refreshLaundryInfo = async \(\) => \{/.test(guideRender), 'the guide defines one shared refresh callback');
assert(/renderOpts\.laundryInfo = await tripsyLaundryRunOutByDay\(guide\.tripKey, person, guide\);/.test(guideRender),
  'it recomputes the run-out projection fresh, not reusing the stale cached one');
assert(/if \(renderOpts\.rerender\) renderOpts\.rerender\(\);/.test(guideRender), 'and re-renders the guide behind whichever screen changed something');
assert(/showTripsyOutfitModal\(guide\.tripKey, el\.dataset\.tripsyOutfitBlock, person, \{ onSwapped: refreshLaundryInfo \}\);/.test(guideRender),
  'the callback is actually threaded into the showTripsyOutfitModal call opened from this guide, as onSwapped');

// ---- other callers of showTripsyOutfitModal are unaffected: no onSwapped means the
// old behavior (just close/repaint the modal itself), so nothing else needed updating ----
const otherCallSites = [...html.matchAll(/showTripsyOutfitModal\([^)]*\)/g)].map(m => m[0]);
assert(otherCallSites.some(c => /onSwapped: refreshLaundryInfo/.test(c)), 'sanity: exactly the guide\'s call site passes onSwapped');
const withoutOnSwapped = otherCallSites.filter(c => !/onSwapped/.test(c));
assert(withoutOnSwapped.length >= 3, 'other callers (Wear Days, My Trips event detail, Travel View) still call it with no onSwapped, unaffected -> ' + withoutOnSwapped.length);
