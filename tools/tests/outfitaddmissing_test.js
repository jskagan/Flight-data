// "When a garment needs to be removed from an outfit, show a swap button and show garments
// that could be used to replace the removed garment. When a garment is missing from an
// outfit, show an add button and show garments that could be used to complete the outfit."
// (2026-10-05). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  const m = html.match(new RegExp(`\\n(async function ${name}\\(|function ${name}\\()`));
  const start = m.index + 1;
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
function extractConst(name) {
  const start = html.indexOf(`\nconst ${name} = `) + 1;
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const src = [
  ...['TRIPSY_OUTFIT_ROLES', 'TRIPSY_ATTIRE_PACKING_GROUPS', 'TRIPSY_FLIGHT_WORN_ROLE_LABEL', 'TRIPSY_WARDROBE_NEVER_PHOTOGRAPHED_TYPES'].map(extractConst),
  ...['tripsyGarmentTypeKey', 'tripsyAttirePackingGroupOf', 'tripsyWardrobeGarmentExcludedFromOutfits', 'tripsyOutfitGarmentRoles',
    'tripsyOutfitMissingRoles', 'tripsyOutfitAddCandidates'].map(extractFn),
].join('\n');
// Minimal Store + selection normalizer for the candidate finder.
let wardrobe = [], selection = [], outfitBlocks = [];
const Store = {
  listWardrobe: async () => wardrobe,
  getTripWardrobe: async () => selection,
  getTripsyTripOutfits: async () => ({ blocks: outfitBlocks }),
};
const tripsyNormalizeTripSelection = s => s.map(id => ({ id, qty: 1, packed: 1 }));
eval(src);

// ---- which role a garment fills ----
const G = (id, name, extra = {}) => ({ id, name, person: 'him', tiers: ['casual', 'formal'], ...extra });
assert(JSON.stringify(tripsyOutfitGarmentRoles(G('a', 'White Dress Shirt'))) === '["tops"]', 'a dress shirt is a top (dress_wear group, but a TOP by type)');
assert(JSON.stringify(tripsyOutfitGarmentRoles(G('b', 'Navy Suit'))) === '["pants"]', 'a suit brings its own trousers');
assert(JSON.stringify(tripsyOutfitGarmentRoles(G('c', 'Black Cocktail Dress'))) === '["tops","pants"]', 'a dress covers both halves');
assert(JSON.stringify(tripsyOutfitGarmentRoles(G('d', 'Brown Loafers'))) === '["footwear"]', 'shoes are footwear');
assert(tripsyOutfitGarmentRoles(G('e', 'Silk Tie')).length === 0 && tripsyOutfitGarmentRoles(G('f', 'Navy Blazer')).length === 0 && tripsyOutfitGarmentRoles(G('g', 'Leather Belt')).length === 0,
  'a tie, a blazer or a belt is never what is missing');
assert(JSON.stringify(tripsyOutfitGarmentRoles(G('h', 'Linen Polo'))) === '["tops"]' && JSON.stringify(tripsyOutfitGarmentRoles(G('i', 'Blue Jeans'))) === '["pants"]', 'polo = top, jeans = bottoms');

// ---- what an outfit is missing ----
assert(JSON.stringify(tripsyOutfitMissingRoles([G('a', 'White Dress Shirt'), G('b', 'Navy Suit')])) === '["footwear"]', 'shirt + suit is missing only shoes');
assert(JSON.stringify(tripsyOutfitMissingRoles([G('c', 'Black Cocktail Dress'), G('d', 'Heels')])) === '[]', 'dress + heels is complete');
assert(JSON.stringify(tripsyOutfitMissingRoles([])) === '["tops","pants","footwear"]', 'an empty outfit is missing everything, top → bottoms → shoes');
assert(JSON.stringify(tripsyOutfitMissingRoles([G('e', 'Silk Tie'), G('d', 'Loafers')])) === '["tops","pants"]', 'a tie fills no role');

// ---- the garments that could complete it ----
(async () => {
  wardrobe = [
    G('shirt1', 'Blue Oxford Shirt'), G('shirt2', 'White Dress Shirt', { tiers: ['formal'] }), G('tee', 'Grey Tee', { tiers: ['casual'] }),
    G('jeans', 'Blue Jeans'), G('loafers', 'Brown Loafers'), G('sneak', 'White Sneakers', { tiers: ['casual'] }),
    G('hers', 'Her Sandals', { person: 'her' }), G('socks', 'Casual Socks', { group: 'essentials' }), G('unpacked', 'Black Oxfords'),
  ];
  selection = ['shirt1', 'shirt2', 'tee', 'jeans', 'loafers', 'sneak', 'hers', 'socks'];
  const block = { dayKey: '2030-05-01', garmentIds: ['tee', 'jeans'] };
  outfitBlocks = [block, { dayKey: '2030-05-01', garmentIds: ['loafers'] }, { dayKey: '2030-05-02', garmentIds: ['sneak'] }];
  let r = await tripsyOutfitAddCandidates('T', block, 'footwear', 'him', 'casual');
  assert(JSON.stringify(r.candidates.map(g => g.id)) === '["sneak"]',
    'THE ASK: shoes that could complete the outfit = packed, this person, tagged for the live tier, free that day (loafers are worn in another outfit the same day; the Oxfords are not packed) -> ' + r.candidates.map(g => g.id));
  r = await tripsyOutfitAddCandidates('T', block, 'tops', 'him', 'casual');
  assert(JSON.stringify(r.candidates.map(g => g.id)) === '["shirt1"]', 'a top candidate is never one already IN the outfit (the tee), never the wrong tier, never an essential -> ' + r.candidates.map(g => g.id));
  r = await tripsyOutfitAddCandidates('T', block, 'footwear', 'him', null);
  assert(JSON.stringify(r.candidates.map(g => g.id)) === '["sneak"]', 'with no live tier every packed shoe free that day is offered');
})();

// ---- the outfit modal: Not packed → Swap + inline replacements; missing role → Add + candidates ----
const modal = extractFn('showTripsyOutfitModal');
assert(/const lostIds = packedIds \? cards\.filter\(g => !packedIds\.has\(g\.id\)\)\.map\(g => g\.id\) : \[\];/.test(modal),
  'a garment in the outfit but no longer on the Packing List is the one that needs to go');
assert(/data-tw-outfit-lost style="outline:3px solid var\(--red, #c0392b\)/.test(modal) && /Not packed<\/span>/.test(modal), 'its card is outlined red and badged');
assert(/is no longer packed — replace it with…<\/div>\s*<button class="btn" data-tw-outfit-swap="\$\{esc\(lostId\)\}">Swap<\/button>/.test(modal),
  'THE ASK: a Swap button sits on the "replace it with…" row');
assert(/tripsyOutfitSwapCandidates\(tripKey, block, lostId, person, liveTier\)/.test(modal) && /data-tw-outfit-replace-pick="\$\{esc\(g\.id\)\}" data-tw-outfit-replace-lost="\$\{esc\(lostId\)\}"/.test(modal),
  'THE ASK: the garments that could replace it are shown, pickable');
assert(/const missingRoles = tripsyOutfitMissingRoles\(cards\);/.test(modal) && /⚠ No \$\{esc\(roleLabel\.toLowerCase\(\)\)\} in this outfit/.test(modal),
  'THE ASK: a missing top / bottoms / shoes is named');
assert(/<button class="btn" data-tw-outfit-add="\$\{esc\(role\)\}">Add<\/button>/.test(modal) && /tripsyOutfitAddCandidates\(tripKey, block, role, person, liveTier\)/.test(modal)
  && /data-tw-outfit-add-pick="\$\{esc\(g\.id\)\}"/.test(modal),
  'THE ASK: with an Add button and the garments that could complete it');
assert(/applyOutfitChange\(el\.dataset\.twOutfitReplaceLost, el\.dataset\.twOutfitReplacePick\)/.test(modal) && /applyOutfitChange\(null, el\.dataset\.twOutfitAddPick\)/.test(modal)
  && /tripsyOutfitAddPicker\(tripKey, block, btn\.dataset\.twOutfitAdd, person, liveTier\)/.test(modal),
  'a replacement pick swaps, a completion pick adds, the Add button opens the picker');
assert(/if \(!currentId\) \{\s*block\.garmentIds\.push\(chosen\);/.test(modal) && /applyOutfitChange\(currentId, chosen\);/.test(modal),
  'one apply path: Swap/Remove replace or splice, Add pushes -- same optimistic save chain');
assert(/\$\{isOwner \? `<button class="btn" data-tw-outfit-add=/.test(modal) && /if \(isOwner\) for \(const lostId of lostIds\)/.test(modal), 'the controls are owner-only; a viewer still sees what is missing');

// ---- the Add picker has no Remove and sits above both callers ----
const picker = extractFn('tripsyOutfitAddPicker');
assert(/Add \$\{esc\(roleLabel\)\}/.test(picker) && !/data-tw-swap-remove/.test(picker), 'the Add picker offers no "Remove" -- there is nothing to remove');
assert(/ov\.style\.zIndex = '2147483098';/.test(picker), 'and renders above the fix page (2147483095) as well as the outfit modal');

// ---- the fix page: missing roles get Add sections too ----
const fix = extractFn('showTripsyOutfitFixPage');
assert(/const missingRoles = tripsyOutfitMissingRoles\(outfitGarments\);/.test(fix) && /if \(!lostIds\.length && !missingRoles\.length\)/.test(fix),
  'an incomplete outfit is a problem the fix page shows');
assert(/Add \$\{esc\(roleLabel\.toLowerCase\(\)\)\} to complete the outfit…<\/h3>\s*<button class="btn" data-fix-add="\$\{esc\(role\)\}">Add<\/button>/.test(fix)
  && /data-fix-add-pick="\$\{esc\(g\.id\)\}"/.test(fix), 'THE ASK: an Add button plus the candidates, pictured');
assert(/this outfit has no \$\{esc\(missingLabels\.join\(', '\)\)\}/.test(fix), 'the problem note names what is missing');
assert(/if \(!lostId\) block\.garmentIds\.push\(replacementId\);/.test(fix) && /apply\(null, el\.dataset\.fixAddPick\)/.test(fix), 'adding goes through the same optimistic apply');
