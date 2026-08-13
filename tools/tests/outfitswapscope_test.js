// Two requests on top of the earlier Swap-picker visibility fix:
// 1. Swap should offer substitutes for the block's CURRENT (live) dress code, not the
//    tier it was composed against -- an event's dress code can be hand-overridden
//    after composing (tripsyAttireOverrideCategory), and the picker must catch up.
// 2. Swap should also let the owner remove a piece with no replacement (e.g. a tie
//    that's merely optional at a now-Cocktail event), not just substitute it.
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

// ---- wiring: the outfit modal computes the LIVE tier and threads it through ----
const modal = extractFn('showTripsyOutfitModal');
assert(/let guide = null;/.test(modal), 'guide is hoisted out of the staleness try-block');
assert(/guide = await Store\.getTripsyAttireGuide\(tripKey\);/.test(modal), 'still populated the same way');
assert(/const liveTier = tripsyOutfitBlockLiveTier\(guide, block\);/.test(modal),
  'Swap computes the LIVE tier, not block.category (the compose-time tier)');
assert(/tripsyOutfitSwapPicker\(tripKey, block, currentId, person, liveTier\)/.test(modal),
  'and passes it into the picker');
assert(/chosen === TRIPSY_OUTFIT_SWAP_REMOVE\)[\s\S]{0,20}\{[\s\S]{0,80}block\.garmentIds\.splice\(i, 1\);/.test(modal),
  'a Remove result splices the garment out with no replacement');
assert(/if \(chosen === currentId\) return;[\s\S]{0,20}block\.garmentIds\[i\] = chosen;/.test(modal),
  'an ordinary pick still replaces in place');

// ---- tripsyOutfitBlockLiveTier: executed against fixtures ----
const tripsyAttireDisplayCategory = ev => ev.__cat; // stand-in: the real fn reads override/block propagation, irrelevant here
eval(extractFn('tripsyOutfitBlockLiveTier'));
const guideFixture = {
  days: [{ events: [{ id: 'e1', __cat: 'cocktail' }, { id: 'e2', __cat: 'formal' }] }],
};
assert(tripsyOutfitBlockLiveTier(guideFixture, { eventIds: ['e1'], category: 'casual' }) === 'cocktail',
  'reads the LIVE category off the guide, not the stale block.category');
assert(tripsyOutfitBlockLiveTier(guideFixture, { eventIds: ['e2'], category: 'cocktail' }) === 'formal',
  'a different event -> its own live category');
assert(tripsyOutfitBlockLiveTier(guideFixture, { eventIds: ['unknown-id'], category: 'casual' }) === 'casual',
  'an event missing from the guide falls back to block.category');
assert(tripsyOutfitBlockLiveTier(null, { eventIds: ['e1'], category: 'casual' }) === 'casual',
  'no guide at all falls back to block.category too');
assert(tripsyOutfitBlockLiveTier(guideFixture, { eventIds: [], category: 'casual' }) === 'casual',
  'a block with no events falls back to block.category');

// ---- tripsyOutfitSwapCandidates (the shared helper the picker now calls), executed
// against fixtures ----
{
  const candidatesSrc = extractFn('tripsyOutfitSwapCandidates');
  assert(candidatesSrc.includes('liveTier') && candidatesSrc.includes('g.tiers'),
    'sanity: extracted the tier-aware helper, not a stale copy');

  const TRIPSY_ATTIRE_ITEMIZED_CATEGORIES = ['black_tie', 'formal', 'cocktail', 'semi_formal'];
  const tripsyGarmentTypeBucket = g => ({ key: g.__type || ('group:' + (g.group || 'accessories')) });
  const tripsyAttirePackingGroupOf = g => g.group || 'accessories';
  const tripsyNormalizeTripSelection = sel => sel;
  const tripsyWardrobeGarmentExcludedFromOutfits = g => g.group === 'essentials';
  let wardrobeFixture = [];
  const Store = {
    // Same-day availability (a separate, later addition) isn't exercised by this
    // fixture set -- covered by its own test file. No other blocks is a no-op here.
    getTripsyTripOutfits: async () => null,
    listWardrobe: async () => wardrobeFixture,
    getTripWardrobe: async () => wardrobeFixture.map(g => ({ id: g.id, qty: 1 })),
  };
  eval(candidatesSrc.replace(/^async function tripsyOutfitSwapCandidates/, 'var tripsyOutfitSwapCandidates = async function'));

  const run = async (wardrobe, currentGarmentId, person, liveTier, blockGarmentIds) => {
    wardrobeFixture = wardrobe;
    const block = { garmentIds: blockGarmentIds };
    const { candidates } = await tripsyOutfitSwapCandidates('T', block, currentGarmentId, person, liveTier);
    return candidates.map(g => g.id);
  };

  const wardrobe = [
    { id: 'cocktail-shirt', name: 'Dress Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['cocktail'] },
    { id: 'casual-polo', name: 'Polo Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['casual'] },
    { id: 'untagged-shirt', name: 'Old Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: [] },
    { id: 'current-shirt', name: 'Current Shirt', person: 'him', group: 'tops', __type: 'shirt', tiers: ['cocktail'] },
    { id: 'cocktail-shoes', name: 'Oxfords', person: 'him', group: 'footwear', __type: 'shoes', tiers: ['cocktail'] },
    { id: 'her-cocktail-shirt', name: 'Her Blouse', person: 'her', group: 'tops', __type: 'shirt', tiers: ['cocktail'] },
  ];

  (async () => {
    let got = await run(wardrobe, 'current-shirt', 'him', 'cocktail', ['current-shirt']);
    assert(got.includes('cocktail-shirt'), 'a same-type garment tagged for the LIVE tier is offered');
    assert(!got.includes('casual-polo'), 'a same-type garment NOT tagged for the live tier is excluded -- THE FEATURE JUST ADDED');
    assert(!got.includes('untagged-shirt'), 'an untagged garment is excluded too, same convention as Pack-for-tier');
    assert(!got.includes('cocktail-shoes'), 'a different type bucket is still excluded regardless of tier match');
    assert(!got.includes('her-cocktail-shirt'), "the other person's garments are still excluded");
    assert(!got.includes('current-shirt'), 'the currently-worn garment never offers itself');

    // With no live tier (guide unavailable), falls back to the OLD same-bucket-only
    // behavior rather than showing nothing.
    got = await run(wardrobe, 'current-shirt', 'him', null, ['current-shirt']);
    assert(got.includes('cocktail-shirt') && got.includes('casual-polo') && got.includes('untagged-shirt'),
      'no live tier -> falls back to same-bucket-only, the pre-fix behavior');

    // Changing the tier changes the offer -- the whole point of the fix.
    got = await run(wardrobe, 'current-shirt', 'him', 'casual', ['current-shirt']);
    assert(got.includes('casual-polo') && !got.includes('cocktail-shirt'),
      'switching the live tier to casual now offers the casual polo instead');
  })();
}

// ---- the Remove button and updated copy, checked against the real source ----
const pickerSrc = extractFn('tripsyOutfitSwapPicker');
assert(/data-tw-swap-remove/.test(pickerSrc), 'the Remove button exists');
assert(/done\(TRIPSY_OUTFIT_SWAP_REMOVE\)/.test(pickerSrc), 'clicking it resolves with the sentinel');
assert(/or remove this item instead/.test(pickerSrc), 'the empty-candidates message mentions the remove option too');
assert(/for \$\{esc\(tierLabel\)\}/.test(pickerSrc), "the modal title names the tier it's scoping to, when known");
