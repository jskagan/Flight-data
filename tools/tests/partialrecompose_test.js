// "Regenerating outfits takes a very long time for minor changes." A Regenerate used
// to re-dress EVERY time-block on the trip in one huge Claude call, even when only one
// block's dress code had moved -- minutes of streaming for outfits that come back
// unchanged. composeTripsyOutfits is now INCREMENTAL: when existing outfits are usable
// (same packing selection), every still-covered block keeps its outfit verbatim and
// only the genuinely UNCOVERED blocks go to Claude. "Covered" is the exact same greedy
// day+tier multiset match tripsyOutfitsUncoveredBlocks uses to decide staleness, so
// what gets re-dressed is precisely what the staleness check flagged. Kept blocks are
// listed in the prompt as fixed context (their garments still count against the
// re-wear limits) rather than re-opened; zero stale blocks skips the API call
// entirely; a changed selection or a first compose still re-dresses everything.
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

const composeFn = extractFn('composeTripsyOutfits');
assert(composeFn.includes('INCREMENTAL RECOMPOSE'), 'sanity: extracted the real function');

// ---- source-pattern checks ----
assert(/existing\.selectionFingerprint && existing\.selectionFingerprint\.hash === selectionFp\.hash/.test(composeFn),
  'partial mode only when the packing selection is UNCHANGED -- a changed selection could strand kept outfits on unpacked garments');
assert(/const j = unused\.findIndex\(sb => sb\.dayKey === b\.dayKey && sb\.category === b\.category\);/.test(composeFn),
  'coverage matching is the same greedy day+tier multiset rule tripsyOutfitsUncoveredBlocks uses');
assert(/if \(j >= 0\) \{ keptByIndex\.set\(i, unused\[j\]\); unused\.splice\(j, 1\); \}/.test(composeFn),
  'each saved block covers at most ONE current block (multiset, not just presence)');
assert(/const staleBlocks = blocks\.filter\(\(b, i\) => !keptByIndex\.has\(i\)\);/.test(composeFn),
  'only uncovered blocks are considered stale');
assert(/if \(!staleBlocks\.length\) \{/.test(composeFn) && /no API call needed/.test(composeFn),
  'zero stale blocks -> no Claude call at all, just a refresh save');
assert(/const scheduleLines = staleBlocks\.map\(scheduleLineFor\)\.join\('\\n'\);/.test(composeFn),
  'THE FIX: the prompt\'s dress-these list contains only the stale blocks');
assert(/ALREADY-DRESSED BLOCKS/.test(composeFn) && /wear DOES count against the re-wear limits/.test(composeFn),
  'kept outfits are given as fixed context so the whole-trip rotation limits still hold');
assert(/eventIds: b\.eventIds, label: b\.label,\s*\n\s*garmentIds: sb\.garmentIds \|\| \[\]/.test(composeFn),
  'a kept block carries its outfit verbatim but refreshes eventIds/label from the CURRENT block');
assert(/if \(!b \|\| !staleIds\.has\(b\.blockId\)\) continue;/.test(composeFn),
  'a stray result for a non-stale block is ignored, never overwrites a kept outfit');
assert(/\.map\(\(b, i\) => keptByIndex\.has\(i\) \? keptOutBlock\(b, keptByIndex\.get\(i\)\) : dressedById\.get\(b\.blockId\)\)/.test(composeFn),
  'the final set merges kept + freshly-dressed blocks back into current-block order');
assert(/if \(!dressedById\.size\) throw new Error\('No outfits came back — try again\.'\);/.test(composeFn),
  'an empty API result still fails loudly (kept blocks alone must not mask a failed call)');

// ---- executed: the coverage-matching + merge logic, against fixtures ----
{
  const run = (currentBlocks, savedBlocks, selectionMatches, dressed) => {
    // Mirrors the real function's partial-recompose control flow exactly (pinned by
    // the source-pattern assertions above to this same shape).
    const keptByIndex = new Map();
    if (savedBlocks && savedBlocks.length && selectionMatches) {
      const unused = [...savedBlocks];
      currentBlocks.forEach((b, i) => {
        const j = unused.findIndex(sb => sb.dayKey === b.dayKey && sb.category === b.category);
        if (j >= 0) { keptByIndex.set(i, unused[j]); unused.splice(j, 1); }
      });
    }
    const staleBlocks = currentBlocks.filter((b, i) => !keptByIndex.has(i));
    const keptOutBlock = (b, sb) => ({
      dayKey: b.dayKey, category: b.category, eventIds: b.eventIds, label: b.label,
      garmentIds: sb.garmentIds || [], note: sb.note || '', gaps: sb.gaps || [],
    });
    const dressedById = new Map((dressed || []).map(d => [d.blockId, d]));
    const outBlocks = currentBlocks
      .map((b, i) => keptByIndex.has(i) ? keptOutBlock(b, keptByIndex.get(i)) : dressedById.get(b.blockId))
      .filter(Boolean);
    return { staleBlocks, keptCount: keptByIndex.size, outBlocks };
  };

  const B = (blockId, dayKey, category, eventIds) => ({ blockId, dayKey, category, eventIds, label: blockId });
  const current = [
    B('B1', 'd1', 'casual', ['e1']),
    B('B2', 'd1', 'smart_casual', ['e2', 'e3']), // tier moved: was casual when composed
    B('B3', 'd2', 'cocktail', ['e4']),
  ];
  const saved = [
    { dayKey: 'd1', category: 'casual', eventIds: ['e1'], garmentIds: ['g1', 'g2'], note: 'kept-1' },
    { dayKey: 'd1', category: 'casual', eventIds: ['e2'], garmentIds: ['g3'], note: 'was-casual' }, // no longer matches B2
    { dayKey: 'd2', category: 'cocktail', eventIds: ['e4-old'], garmentIds: ['g4'], note: 'kept-3' },
  ];

  // THE ASK: only the block whose tier moved is stale; the other two keep their outfits.
  let r = run(current, saved, true, [{ blockId: 'B2', dayKey: 'd1', category: 'smart_casual', eventIds: ['e2', 'e3'], label: 'B2', garmentIds: ['g9'], note: 'fresh', gaps: [] }]);
  assert(r.staleBlocks.length === 1 && r.staleBlocks[0].blockId === 'B2',
    `THE ASK: a one-block tier change re-dresses ONE block, not the whole trip -> ${JSON.stringify(r.staleBlocks.map(b => b.blockId))}`);
  assert(r.keptCount === 2, 'the other two blocks keep their existing outfits');
  assert(r.outBlocks.length === 3 && r.outBlocks[0].note === 'kept-1' && r.outBlocks[1].note === 'fresh' && r.outBlocks[2].note === 'kept-3',
    'the final set merges kept and fresh outfits back into schedule order');
  assert(r.outBlocks[2].eventIds[0] === 'e4', 'a kept block\'s eventIds are refreshed from the CURRENT block, not the stale saved copy');
  assert(r.outBlocks[0].garmentIds.join(',') === 'g1,g2', 'a kept outfit\'s garments are untouched');

  // Nothing changed at all -> nothing stale, no API call needed.
  const unchanged = [B('B1', 'd1', 'casual', ['e1']), B('B2', 'd2', 'cocktail', ['e4'])];
  r = run(unchanged, [
    { dayKey: 'd1', category: 'casual', garmentIds: ['g1'] },
    { dayKey: 'd2', category: 'cocktail', garmentIds: ['g4'] },
  ], true, []);
  assert(r.staleBlocks.length === 0 && r.outBlocks.length === 2, 'all blocks covered -> zero stale, the API call is skipped entirely');

  // A changed packing selection disables partial mode -- everything re-dresses.
  r = run(current, saved, false, current.map(b => ({ ...b, garmentIds: ['gN'], note: 'fresh', gaps: [] })));
  assert(r.staleBlocks.length === 3 && r.keptCount === 0, 'a changed selection re-dresses every block, same as before this fix');

  // First-ever compose (no saved outfits) -- full, unchanged behavior.
  r = run(current, [], true, current.map(b => ({ ...b, garmentIds: ['gN'], note: 'fresh', gaps: [] })));
  assert(r.staleBlocks.length === 3, 'a first compose with nothing saved dresses everything, unchanged');

  // A SECOND block of the same day+tier appearing: multiset counting means only the
  // extra one is stale, and the one saved outfit isn't double-assigned to both.
  const twoSame = [B('B1', 'd1', 'casual', ['e1']), B('B2', 'd1', 'casual', ['e9'])];
  r = run(twoSame, [{ dayKey: 'd1', category: 'casual', garmentIds: ['g1'] }], true,
    [{ blockId: 'B2', dayKey: 'd1', category: 'casual', eventIds: ['e9'], label: 'B2', garmentIds: ['g5'], note: 'fresh', gaps: [] }]);
  assert(r.staleBlocks.length === 1 && r.staleBlocks[0].blockId === 'B2' && r.keptCount === 1,
    'a second same-day-same-tier block only re-dresses the uncovered one (multiset, matching tripsyOutfitsUncoveredBlocks)');
}
