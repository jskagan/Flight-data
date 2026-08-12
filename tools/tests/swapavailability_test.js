// "When a user selects the swap button for an individual garment, only show other
// garments that are available to be worn for another day." Before this, Swap only
// excluded a garment already worn in THIS same block (wornElsewhere) -- it never
// checked whether a candidate was already committed to a DIFFERENT outfit block on
// the SAME day, which would mean the same physical piece being worn in two outfits at
// once. A garment worn on some OTHER day of the trip is fine (that's the ordinary
// case of reusing a piece) and must still be offered.
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

const pickerSrc = extractFn('tripsyOutfitSwapPicker');

// ---- source-pattern checks ----
assert(/const outfitsForDay = await Store\.getTripsyTripOutfits\(tripKey, person\);/.test(pickerSrc),
  'fetches this person\'s composed outfits to see what else is worn that day');
assert(/if \(b === block \|\| b\.dayKey !== block\.dayKey\) continue;/.test(pickerSrc),
  'skips this exact block (already covered by wornElsewhere) and any block on a DIFFERENT day');
assert(/!wornElsewhere\.has\(g\.id\) && !wornSameDay\.has\(g\.id\)/.test(pickerSrc),
  'the candidate filter excludes both same-block and same-day-elsewhere garments');

// ---- executed: the exact candidate-building block, against fixtures ----
(async () => {
  const exprStart = pickerSrc.indexOf('const outfitsForDay');
  const exprEnd = pickerSrc.indexOf(');', pickerSrc.indexOf('const candidates = [...new Set')) + 2;
  const blockSrc = pickerSrc.slice(exprStart, exprEnd);
  assert(blockSrc.includes('wornSameDay') && blockSrc.includes('outfitsForDay'),
    'sanity: extracted the same-day-availability-aware block, not a stale copy');

  const run = async (wardrobe, currentGarmentId, block, otherBlocks) => {
    const byId = new Map(wardrobe.map(g => [g.id, g]));
    const current = byId.get(currentGarmentId);
    const person = 'him';
    const liveTier = null; // irrelevant to this feature -- no tier filtering in these fixtures
    const tripsyGarmentTypeBucket = g => ({ key: g.__type || ('group:' + (g.group || 'accessories')) });
    const tripsyAttirePackingGroupOf = g => g.group || 'accessories';
    const isMixAndMatch = false;
    const bucketKey = current ? tripsyGarmentTypeBucket(current).key : null;
    const tripsyNormalizeTripSelection = sel => sel;
    const tripsyWardrobeGarmentExcludedFromOutfits = g => g.group === 'essentials';
    const selectedRaw = wardrobe.map(g => ({ id: g.id, qty: 1 }));
    const tripKey = 'T';
    const Store = { getTripsyTripOutfits: async () => ({ blocks: [block, ...otherBlocks] }) };
    const wornElsewhere = new Set((block.garmentIds || []).filter(id => id !== currentGarmentId));
    let candidates, outfitsForDay, wornSameDay;
    // Direct-eval const/let is scoped to the eval call itself -- strip declaration
    // keywords so the block assigns into these outer bindings instead.
    await eval(`(async () => { ${blockSrc
      .replace('const outfitsForDay', 'outfitsForDay')
      .replace('const wornSameDay', 'wornSameDay')
      .replace('const candidates', 'candidates')} })()`);
    return candidates.map(g => g.id);
  };

  const wardrobe = [
    { id: 'current-shirt', name: 'Current Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: [] },
    { id: 'shirt-a', name: 'Shirt A', person: 'him', group: 'tops', __type: 'shirt', tiers: [] },
    { id: 'shirt-b', name: 'Shirt B', person: 'him', group: 'tops', __type: 'shirt', tiers: [] },
    { id: 'shirt-c', name: 'Shirt C', person: 'him', group: 'tops', __type: 'shirt', tiers: [] },
  ];
  const thisBlock = { dayKey: '2026-08-14', garmentIds: ['current-shirt'] };

  // shirt-a is in ANOTHER block on the SAME day -> excluded. shirt-b is in a block on
  // a DIFFERENT day -> still offered. shirt-c is in no other block at all -> offered.
  let got = await run(wardrobe, 'current-shirt', thisBlock, [
    { dayKey: '2026-08-14', garmentIds: ['shirt-a'] },
    { dayKey: '2026-08-16', garmentIds: ['shirt-b'] },
  ]);
  assert(!got.includes('shirt-a'), 'THE FIX: a garment already worn in a DIFFERENT block the SAME day is excluded');
  assert(got.includes('shirt-b'), 'a garment worn on a DIFFERENT day is still offered -- reuse across the trip is normal');
  assert(got.includes('shirt-c'), 'a garment worn nowhere else at all is offered');

  // No other blocks at all (a single-block day, or a trip with one outfit) -> nothing
  // extra is excluded beyond the same-block check that already existed.
  got = await run(wardrobe, 'current-shirt', thisBlock, []);
  assert(got.includes('shirt-a') && got.includes('shirt-b') && got.includes('shirt-c'),
    'with no other blocks at all, nothing is excluded by the same-day rule');

  // A block with no dayKey (defensive: guide data can be incomplete) must not exclude
  // everything by accident -- the `block.dayKey` guard in the source covers this.
  const noDayBlock = { garmentIds: ['current-shirt'] };
  got = await run(wardrobe, 'current-shirt', noDayBlock, [{ dayKey: '2026-08-14', garmentIds: ['shirt-a'] }]);
  assert(got.includes('shirt-a'), 'a block with no dayKey skips the same-day check entirely rather than excluding everything');
})();
