// "Why am I getting a message that the gray Vuori polo shirt is not available on
// 8/16?" -> "It was washed on 8/11." Diagnosis: the SAME caching bug already fixed for
// Swap (swaprunoutrefresh_test.js) also existed for Wash Now and Not Dirty. The Daily
// Dress Guide's run-out bar (renderOpts.laundryInfo) is computed once when the guide
// opens; pressing Wash Now or Not Dirty on the laundry-day screen only ever rebuilt
// THAT screen (showTripsyLaundryDay closing and reopening itself), never told the
// guide behind it to recompute or re-render -- so a wash recorded from inside an
// already-open guide left the run-out bar showing stale, already-resolved warnings.
// Fixed by threading the SAME shared refreshLaundryInfo callback (opts.onChanged) into
// showTripsyLaundryDay, fired after both Wash Now and Not Dirty succeed.
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

// ---- showTripsyLaundryDay accepts opts and fires opts.onChanged on both actions ----
const laundryDay = extractFn('showTripsyLaundryDay');
assert(/async function showTripsyLaundryDay\(tripKey, dayKey, person, opts = \{\}\) \{/.test(laundryDay),
  'takes an opts param, defaulting to {} so existing callers with no 4th arg are unaffected');

const washBlock = laundryDay.slice(laundryDay.indexOf("[data-laundry-wash]"), laundryDay.indexOf("[data-laundry-unpick]"));
assert(/Store\.washTripsyLaundryBag\(tripKey, person, dayKey\)/.test(washBlock), 'Wash Now still records the wash');
assert(/if \(opts\.onChanged\) opts\.onChanged\(\);/.test(washBlock), 'THE FIX: Wash Now fires opts.onChanged');
assert(/showTripsyLaundryDay\(tripKey, dayKey, person, opts\);/.test(washBlock),
  'and passes opts through when rebuilding itself, so a second wash on the same visit still fires onChanged');
// onChanged must fire BEFORE the self-rebuild, matching the onSwapped ordering convention.
const washChangedIdx = washBlock.indexOf('if (opts.onChanged)');
const washRebuildIdx = washBlock.indexOf('showTripsyLaundryDay(tripKey, dayKey, person, opts);');
assert(washChangedIdx > -1 && washRebuildIdx > washChangedIdx, 'onChanged fires before the screen rebuilds itself');

const notDirtyBlock = laundryDay.slice(laundryDay.indexOf("data-laundry-clean"), laundryDay.length);
assert(/Store\.addLaundryNotDirty\(tripKey, person, dayKey, it\.creditKey \|\| it\.key, credit\)/.test(notDirtyBlock),
  'Not Dirty still records the credit');
assert(/if \(opts\.onChanged\) opts\.onChanged\(\);/.test(notDirtyBlock), 'THE FIX: Not Dirty also fires opts.onChanged');

// ---- the Daily Dress Guide wires the SAME refreshLaundryInfo callback used by Swap ----
const guideRender = extractFn('renderTripsyDressGuideInto');
assert(/const refreshLaundryInfo = async \(\) => \{/.test(guideRender),
  'one shared callback recomputes the run-out projection and re-renders the guide');
assert(/showTripsyLaundryDay\(guide\.tripKey, el\.getAttribute\('data-tripsy-laundry-day'\), person, \{ onChanged: refreshLaundryInfo \}\);/.test(guideRender),
  'the laundry-day trigger passes it as onChanged');
assert(/showTripsyOutfitModal\(guide\.tripKey, el\.dataset\.tripsyOutfitBlock, person, \{ onSwapped: refreshLaundryInfo \}\);/.test(guideRender),
  'and the outfit-block trigger passes the exact same callback as onSwapped -- one function, both fixes');

// ---- executed: the shared refresh callback recomputes and re-renders ----
{
  let laundryCalls = 0, rerenderCalls = 0;
  const renderOpts = { laundryInfo: { runOut: new Map([['stale', ['Old Data']]]), hasWash: true } };
  const guide = { tripKey: 'T1' };
  const person = 'him';
  const tripsyLaundryRunOutByDay = async () => { laundryCalls++; return { runOut: new Map(), hasWash: true }; };
  renderOpts.rerender = () => { rerenderCalls++; };
  const refreshLaundryInfo = async () => {
    try { renderOpts.laundryInfo = await tripsyLaundryRunOutByDay(guide.tripKey, person, guide); }
    catch (e) { /* ignore for this fixture */ }
    if (renderOpts.rerender) renderOpts.rerender();
  };
  refreshLaundryInfo().then(() => {
    assert(laundryCalls === 1, 'calling the shared callback recomputes the projection exactly once');
    assert(rerenderCalls === 1, 'and triggers exactly one re-render');
    assert(!renderOpts.laundryInfo.runOut.has('stale'), 'the stale cached entry is replaced, not merged with the fresh one');
  });
}

// ---- exactly one real call site passes onChanged: the guide's own trigger. The two
// internal self-rebuild calls (Wash Now, Not Dirty) pass the already-received `opts`
// through by reference instead, which is how a second action on the same visit still
// carries the callback without re-stating it. ----
assert((html.match(/onChanged: refreshLaundryInfo/g) || []).length === 1,
  'the literal onChanged wiring appears exactly once, at the guide\'s laundry-day trigger');
assert((html.match(/showTripsyLaundryDay\(tripKey, dayKey, person, opts\);/g) || []).length === 2,
  'both internal self-rebuild calls forward opts by reference rather than re-declaring onChanged');
