// THE BUG JUST REPORTED: "I am trying to swap a casual top for another, but when I
// press swap not all available casual tops appear." tripsyOutfitSwapPicker bucketed
// candidates by the narrow typeKey (tripsyGarmentTypeBucket -- polo/shirt/tee/jacket
// are each their own bucket) UNCONDITIONALLY, even for the 3 mix-and-match tiers
// (casual/smart_casual/athletic) where the app's own convention -- already used by
// tripsyWardrobeNeedByTier's need lines -- treats any garment of the same packing
// GROUP as interchangeable. Verified against the owner's real wardrobe: their casual
// tops alone span typeKeys polo(9)/shirt(8)/tee(5)/jacket(3)/group:tops(2), so
// swapping e.g. a polo only ever offered other polos, hiding ~16+ valid substitutes.
// The 4 itemized tiers (black_tie/formal/cocktail/semi_formal) must keep the narrow
// type match -- a dress-shirt slot must not offer a tie.
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
function extractConst(name) {
  const m = html.match(new RegExp(`const ${name} = `));
  const start = m.index;
  const end = html.indexOf(';\n', start) + 1;
  return html.slice(start, end);
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const pickerSrc = extractFn('tripsyOutfitSwapPicker');

// ---- source-pattern checks: the fix is present and wired ----
assert(/const isMixAndMatch = liveTier && !TRIPSY_ATTIRE_ITEMIZED_CATEGORIES\.includes\(liveTier\);/.test(pickerSrc),
  'a mix-and-match tier is any live tier NOT in the itemized list');
assert(/const currentGroup = current \? tripsyAttirePackingGroupOf\(current\) : null;/.test(pickerSrc),
  'the current garment\'s packing GROUP is computed alongside its type bucket');
assert(/isMixAndMatch\s*\n\s*\? \(!currentGroup \|\| tripsyAttirePackingGroupOf\(g\) === currentGroup\)\s*\n\s*: \(!bucketKey \|\| tripsyGarmentTypeBucket\(g\)\.key === bucketKey\)/.test(pickerSrc),
  'the candidate filter branches: group match for mix-and-match tiers, narrow type-bucket match otherwise');
assert(/isMixAndMatch \? \(TRIPSY_ATTIRE_PACKING_GROUP_LABEL\[currentGroup\] \|\| currentGroup\) : tripsyGarmentTypeBucket\(current\)\.label/.test(pickerSrc),
  'the modal\'s typeLabel also reflects the group name on a mix-and-match tier, not a misleadingly narrow type label');

// ---- executed: the exact candidate-building expression, against fixtures ----
(async () => {
  const exprStart = pickerSrc.indexOf('const isMixAndMatch');
  const exprEnd = pickerSrc.indexOf(');', pickerSrc.indexOf('const candidates = [...new Set')) + 2;
  const blockSrc = pickerSrc.slice(exprStart, exprEnd);
  assert(blockSrc.includes('isMixAndMatch') && blockSrc.includes('currentGroup'),
    'sanity: extracted the group-aware candidate-building block, not a stale copy');

  const TRIPSY_ATTIRE_ITEMIZED_CATEGORIES = ['black_tie', 'formal', 'cocktail', 'semi_formal'];
  const TRIPSY_ATTIRE_PACKING_GROUP_LABEL = { tops: 'Tops', footwear: 'Footwear' };

  const run = async (wardrobe, currentGarmentId, person, liveTier, blockGarmentIds) => {
    const byId = new Map(wardrobe.map(g => [g.id, g]));
    const current = byId.get(currentGarmentId);
    const tripsyGarmentTypeBucket = g => ({ key: g.__type || ('group:' + (g.group || 'accessories')), label: g.__type || g.group });
    const tripsyAttirePackingGroupOf = g => g.group || 'accessories';
    const TRIPSY_ATTIRE_CATEGORY_LABEL = { casual: 'Casual', cocktail: 'Cocktail' };
    const tripsyNormalizeTripSelection = sel => sel;
    const tripsyWardrobeGarmentExcludedFromOutfits = g => g.group === 'essentials';
    const garments = wardrobe;
    const selectedRaw = wardrobe.map(g => ({ id: g.id, qty: 1 }));
    const block = { garmentIds: blockGarmentIds };
    // No same-day availability fixture here -- that's covered by its own test file
    // (swapavailability_test.js). This harness only needs the picker's real
    // Store.getTripsyTripOutfits call to resolve to "no other blocks" so the
    // type/group-matching logic under test is unaffected by it.
    const Store = { getTripsyTripOutfits: async () => null };
    const tripKey = 'T';
    let candidates, isMixAndMatch, currentGroup, bucketKey, typeLabel, wornElsewhere, outfitsForDay, wornSameDay;
    // Direct-eval const/let is scoped to the eval call itself -- strip declaration
    // keywords so the block assigns into these outer bindings instead.
    await eval(`(async () => { ${blockSrc
      .replace('const isMixAndMatch', 'isMixAndMatch')
      .replace('const bucketKey', 'bucketKey')
      .replace('const currentGroup', 'currentGroup')
      .replace('const typeLabel', 'typeLabel')
      .replace('const tierLabel', 'let tierLabel')
      .replace('const wornElsewhere', 'wornElsewhere')
      .replace('const outfitsForDay', 'outfitsForDay')
      .replace('const wornSameDay', 'wornSameDay')
      .replace('const candidates', 'candidates')} })()`);
    return candidates.map(g => g.id);
  };

  // Real-shape fixture: a casual tier (mix-and-match) with a polo, a shirt, a tee
  // (three different typeKeys, same 'tops' group) plus a jacket (different group)
  // and a pair of shoes (different group entirely).
  const wardrobe = [
    { id: 'polo', name: 'Polo', person: 'him', group: 'tops', __type: 'polo', tiers: ['casual'] },
    { id: 'shirt', name: 'Casual Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['casual'] },
    { id: 'tee', name: 'Tee', person: 'him', group: 'tops', __type: 'tee', tiers: ['casual'] },
    { id: 'current-polo', name: 'Current Polo', person: 'him', group: 'tops', __type: 'polo', tiers: ['casual'] },
    { id: 'jacket', name: 'Casual Jacket', person: 'him', group: 'outerwear', __type: 'jacket', tiers: ['casual'] },
    { id: 'shoes', name: 'Sneakers', person: 'him', group: 'footwear', __type: 'sneaker', tiers: ['casual'] },
    { id: 'her-shirt', name: 'Her Casual Shirt', person: 'her', group: 'tops', __type: 'shirt', tiers: ['casual'] },
    { id: 'cocktail-shirt', name: 'Dress Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['cocktail'] },
  ];

  let got = await run(wardrobe, 'current-polo', 'him', 'casual', ['current-polo']);
  assert(got.includes('polo'), 'THE FIX: another polo (same type) is still offered');
  assert(got.includes('shirt'), 'THE FIX: a casual SHIRT is now offered when swapping a polo -- was hidden before this fix');
  assert(got.includes('tee'), 'THE FIX: a casual TEE is now offered too -- same real-data bug (5 tees hidden)');
  assert(!got.includes('jacket'), 'a different packing GROUP (outerwear) is still excluded');
  assert(!got.includes('shoes'), 'footwear is still excluded');
  assert(!got.includes('her-shirt'), "the other person's garments are still excluded");
  assert(!got.includes('current-polo'), 'the currently-worn garment never offers itself');
  assert(!got.includes('cocktail-shirt'), 'a top not tagged for the casual tier is still excluded');

  // Itemized tier (cocktail): must NOT loosen to group-matching -- a shirt slot
  // still must not offer, say, an unrelated top of a different narrow type meant
  // for formal wear only, and a tie must never appear for a dress-shirt swap.
  const itemized = [
    { id: 'cur-shirt', name: 'Current Dress Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['cocktail'] },
    { id: 'other-shirt', name: 'Other Dress Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['cocktail'] },
    { id: 'tie', name: 'Tie', person: 'him', group: 'accessories', __type: 'tie', tiers: ['cocktail'] },
  ];
  got = await run(itemized, 'cur-shirt', 'him', 'cocktail', ['cur-shirt']);
  assert(got.includes('other-shirt'), 'itemized tier: another dress shirt is offered');
  assert(!got.includes('tie'), 'itemized tier: narrow type-bucket matching is preserved -- a tie never offers as a shirt substitute');

  // No live tier at all (guide unavailable): falls back to same-bucket-only, the
  // pre-existing behavior for that case -- unaffected by this fix.
  got = await run(wardrobe, 'current-polo', 'him', null, ['current-polo']);
  assert(got.includes('polo') && !got.includes('shirt') && !got.includes('tee'),
    'no live tier -> falls back to narrow same-type-bucket matching, unchanged by this fix');
})();
