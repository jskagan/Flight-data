// "There is a red triangle by the itinerary glyph. I select review changes from the
// dialog box, but there are no new changes to review and the box just disappears."
// The "Review changes" handler re-checks tripsyItineraryChangedEvents (deliberately,
// since another tab/device may have already regenerated) but on an empty result it
// just fell through to `return true` -- silently opening the menu with no explanation,
// which reads as the confirm dialog closing and nothing happening. Fixed: an empty
// re-check now toasts "Already up to date" and clears this trip's now-stale ▲ (both
// the small span next to Edit and the glyph badge) instead of leaving the mystery.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- extract the itinerary-menu-toggle beforeOpen callback verbatim ----
const callSiteMarker = 'wireTripsyHeaderMenuToggle("[data-tripsy-itinerary-menu-toggle]"';
const callStart = html.indexOf(callSiteMarker);
assert(callStart > -1, 'sanity: found the itinerary menu-toggle wiring call');
const fnStart = html.indexOf('async (btn, tripKey) => {', callStart);
let depth = 0, fnEnd = -1;
for (let j = html.indexOf('{', fnStart); j < html.length; j++) {
  if (html[j] === '{') depth++;
  else if (html[j] === '}') { depth--; if (!depth) { fnEnd = j + 1; break; } }
}
const cb = html.slice(fnStart, fnEnd);
assert(cb.includes('tripsyItineraryChangedEvents') && cb.includes('showTripsyItineraryChangesDialog'),
  'sanity: extracted the real beforeOpen callback, not a stale copy');

// ---- source-pattern checks ----
assert(/if \(!changed\.length\) \{/.test(cb), 'the empty-result branch is now its own explicit block');
assert(/toast\('Already up to date — nothing to review\.'\);/.test(cb),
  'THE FIX: the owner is told plainly that there is nothing to review');
assert(/const warnEl = container\.querySelector\(`\[data-tripsy-itin-warning="\$\{CSS\.escape\(tripKey\)\}"\]`\);/.test(cb),
  'the small ▲ span next to Edit is looked up');
assert(/if \(warnEl\) warnEl\.style\.display = 'none';/.test(cb), 'and hidden -- the stale warning is cleared, not left to self-correct later');
assert(/tripsySetItineraryGlyphBadge\(btn, ''\);/.test(cb), 'the 🧭 glyph badge is cleared too, via the same helper the rest of the app uses');
assert(/return false;\s*\n\s*\}\s*\n\s*await showTripsyItineraryChangesDialog/.test(cb),
  'the empty branch returns false (does not silently open the menu) before the real dialog path');

// ---- executed: the actual empty/non-empty branching, against a lightweight re-creation
// of the callback's control flow (the real callback is deeply embedded in a page-render
// closure with dozens of unrelated dependencies; this exercises the exact NEW logic added) ----
(async () => {
  const run = async (reviewChosen, changedEvents) => {
    const calls = { toast: [], warnHidden: false, glyphCleared: false, dialogShown: false, menuOpened: null };
    const toast = msg => calls.toast.push(msg);
    const container = { querySelector: () => ({ set style(v) { calls.warnHidden = v.display === 'none'; }, get style() { return {}; } }) };
    const tripsyConfirmDialog = async () => reviewChosen;
    const tripsyItineraryChangedEvents = async () => changedEvents;
    const showTripsyItineraryChangesDialog = async () => { calls.dialogShown = true; };
    const tripsySetItineraryGlyphBadge = (btn, state) => { if (state === '') calls.glyphCleared = true; };
    const btn = {};
    const tripKey = 'T1';

    // Mirrors the real callback's control flow exactly (verified against the source-
    // pattern assertions above, which pin the real code to this same shape).
    const review = await tripsyConfirmDialog();
    if (!review) return { ...calls, menuOpened: true };
    const changed = await tripsyItineraryChangedEvents();
    if (!changed.length) {
      toast('Already up to date — nothing to review.');
      const warnEl = container.querySelector(`[data-tripsy-itin-warning="${tripKey}"]`);
      if (warnEl) warnEl.style = { display: 'none' };
      tripsySetItineraryGlyphBadge(btn, '');
      return { ...calls, menuOpened: false };
    }
    await showTripsyItineraryChangesDialog();
    return { ...calls, menuOpened: false };
  };

  let r = await run(true, []);
  assert(r.toast.includes('Already up to date — nothing to review.'), 'THE ASK: empty re-check -> the owner is told, not left guessing');
  assert(r.warnHidden === true, 'the stale small-span warning is cleared');
  assert(r.glyphCleared === true, 'the stale glyph badge is cleared');
  assert(r.dialogShown === false, 'no empty changes dialog is shown');
  assert(r.menuOpened === false, 'and the menu does not silently open in its place');

  r = await run(true, [{ ev: { id: 'e1' }, key: 'e1', changeType: 'added' }]);
  assert(r.dialogShown === true, 'a real, non-empty result still opens the changes dialog as before');
  assert(!r.toast.length, 'and does not also fire the "up to date" toast');

  r = await run(false, []);
  assert(r.menuOpened === true, 'declining the confirm ("Not now") still just opens the menu, unaffected by this fix');
})();
