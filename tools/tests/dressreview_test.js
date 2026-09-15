// "When you first generate the attire guide, show the user each of the
// events/time blocks with your suggested dress category. Make the dress
// category a button that the user can select and then change. Also, allow the
// user to select individual events that are within time blocks and change the
// dress category for individual events. Update the display dynamically."
// showTripsyAttireReviewDialog opens automatically after a FIRST generate
// (never a Refresh), listing each day's time-blocks: the block badge re-tiers
// the whole block via tripsyAttireOverrideBlockCategory (dialog-free -- setting
// the block IS the cascade, shown live), an event badge inside a multi-event
// block goes through the exact tripsyAttireOverrideCategory mechanism the
// Daily Dress Guide's badges use, and every change re-renders the dialog AND
// the summary behind it via the shared renderOpts.rerender convention.
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

// ---- the trigger: every generate AND refresh, while the overlay is still up ----
const gen = extractFn('runTripsyAttireGeneration');
assert(/if \(isOwner && guide && summaryLiveForTrip\(\)\) \{\s*\n\s*await showTripsyAttireReviewDialog\(guide, \{/.test(gen),
  'THE ASK (+ same-day follow-up): the review dialog opens after EVERY generate or refresh (owner, overlay still showing)');
assert(!/!isRefresh && isOwner && guide && summaryLiveForTrip/.test(gen),
  'the original first-generate-only gate is gone -- "also display the review dialog after a user regenerates"');
assert(gen.indexOf('showTripsyAttireReviewDialog') < gen.indexOf('tripsyOutfitsNeedRecompose'),
  'and it is awaited BEFORE the outfit-recompose offers, so the tiers are settled first');
assert(/onChanged: \(\) => \{ if \(summaryLiveForTrip\(\)\) renderTripsyAttireOverlayContent\(guide, attireRenderOpts/.test(gen),
  'every change also repaints the summary behind the dialog');

// ---- the dialog ----
const dlg = extractFn('showTripsyAttireReviewDialog');
assert(/computeTripsyAttireBlocks\(guide\.days \|\| \[\]\);/.test(dlg),
  'each render re-derives the blocks fresh, so the grouping always reflects the latest picks');
assert(/if \(!cur \|\| cur\.category !== cat\) \{ cur = \{ category: cat, events: \[\] \}; groups\.push\(cur\); \}/.test(dlg),
  'blocks group by consecutive constant displayCategory -- the same rule tripsyEnumerateAttireBlocks uses, so splits/merges appear live');
assert(/data-tripsy-attire-review-block data-event-ids=/.test(dlg),
  'THE ASK: each block\'s category is a button carrying its member event ids');
assert(/data-tripsy-attire-review-event data-day-key=/.test(dlg),
  'THE ASK: each event inside a multi-event block gets its own category button');
assert(/tripsyAttireBadgeHtml\(ev\.category\)/.test(dlg),
  'event badges show the event\'s own BASE tier (seeing which member drives the block is the point of this screen)');
assert(/openMenuFor\(btn, category => tripsyAttireOverrideBlockCategory\(guide, ids, category, renderOpts\)\)/.test(dlg),
  'a block badge re-tiers the whole block');
assert(/openMenuFor\(btn, category => tripsyAttireOverrideCategory\(guide, btn\.dataset\.dayKey, btn\.dataset\.eventId, category, renderOpts\)\)/.test(dlg),
  'an event badge goes through the EXACT per-event override mechanism the guide\'s own badges use');
assert(/const renderOpts = \{ rerender: \(\) => \{ render\(\); if \(opts\.onChanged\) opts\.onChanged\(\); \} \};/.test(dlg),
  'THE ASK: the display updates dynamically -- every override re-renders the dialog (and the caller\'s surface) via the shared rerender convention');
const ov = extractFn('getOrCreateTripsyAttireReviewOverlay');
assert(/z-index:9150;/.test(ov),
  'layered above the Attire panel (9000) and below the category menu (9200) / cascade confirms, per the z-order rule');
// The category menu's click-away close must not swallow the very tap that opens it.
const menuFn = extractFn('getOrCreateTripsyAttireCategoryMenu');
assert(/closest\('\[data-tripsy-attire-event-badge\], \[data-tripsy-attire-review-block\], \[data-tripsy-attire-review-event\]'\)/.test(menuFn),
  'the menu\'s click-away handler excludes the review dialog\'s badges, same as the guide\'s own');

// ---- executed: the block override against a stubbed store ----
(async () => {
  const mkGuide = () => ({
    days: [{ dayKey: '2026-11-24', events: [
      { id: 'e1', name: 'Reception', category: 'cocktail', categoryOverridden: false },
      { id: 'e2', name: 'Concert', category: 'formal', categoryOverridden: false },
      { id: 'e3', name: 'Dinner', category: 'cocktail', categoryOverridden: false },
    ] }],
    blocks: {}, counts: {},
  });
  const src = extractFn('tripsyAttireOverrideBlockCategory').replace(/^async function /, 'var tripsyAttireOverrideBlockCategory = async function ');
  const run = async (guide, ids, cat, saveOk) => {
    const calls = { saves: 0, repaints: 0, toasts: [] };
    const f = new Function('guide', 'ids', 'cat', 'computeTripsyAttireBlocks', 'tripsyAttireApplyRecomputedBlocks', 'tripsyAttireRepaint', 'Store', 'toast',
      src + '\nreturn tripsyAttireOverrideBlockCategory(guide, ids, cat, {});');
    await f(guide, ids, cat,
      () => ({ blocks: { recomputed: true }, counts: { recomputed: true } }),
      (g, r) => { g.blocks = r.blocks; g.counts = r.counts; },
      () => { calls.repaints++; },
      { saveTripsyAttireGuide: async () => { calls.saves++; return saveOk; } },
      (msg, kind) => calls.toasts.push(kind || 'info'));
    return calls;
  };

  let g = mkGuide();
  let calls = await run(g, ['e1', 'e2', 'e3'], 'semi_formal', true);
  assert(g.days[0].events.every(e => e.category === 'semi_formal' && e.categoryOverridden),
    'THE ASK: one tap re-tiers every event in the block, each marked as the owner\'s own pick');
  assert(calls.saves === 1 && calls.repaints === 1 && g.blocks.recomputed,
    'blocks/counts re-derive, ONE repaint (before the save -- optimistic) and ONE save for the whole block');

  g = mkGuide();
  g.days[0].events.forEach(e => { e.category = 'formal'; e.categoryOverridden = true; });
  calls = await run(g, ['e1', 'e2', 'e3'], 'formal', true);
  assert(calls.saves === 0, 'picking the tier the block is already set to is a no-op (no wasted 2.5s Drive write)');

  g = mkGuide();
  calls = await run(g, ['e1', 'e2', 'e3'], 'black_tie', false);
  assert(g.days[0].events.every((e, i) => e.category === mkGuide().days[0].events[i].category && !e.categoryOverridden),
    'a failed save rolls every member back to its previous tier and overridden flag');
  assert(calls.toasts.includes('error') && calls.repaints === 2,
    'the failure is toasted and the rollback repainted');

  g = mkGuide();
  calls = await run(g, ['e2'], 'cocktail', true);
  assert(g.days[0].events[1].category === 'cocktail' && g.days[0].events[0].category === 'cocktail' && !g.days[0].events[0].categoryOverridden,
    'a one-event id list touches only that event (single-event blocks route through the same function)');
})();
