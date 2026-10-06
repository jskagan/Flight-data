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

// "The app is giving me this message but not a button to go to the outfit so I can fix it"
// (2026-10-05): only unpacked-garment rows had a button; an UNCOVERED time-block had none.
const probs = extractFn('tripsyOutfitProblemsDialog');
assert(/it\.kind === 'uncovered' \? `<button class="btn" data-fix-item="\$\{i\}"[^>]*>Dress this outfit<\/button>`/.test(probs),
  'THE REPORT: a time-block with no outfit gets a "Dress this outfit" button');
assert(/data-problems-view[^>]*>View outfits<\/button>/.test(probs) && /done\(\{ action: 'view' \}\)/.test(probs), 'the packing-picks-changed fallback row gets View outfits');
assert(/items\.push\(\{ kind: 'uncovered', line, person, block: b, outfits \}\)/.test(extractFn('tripsyOutfitStaleReasons')), 'uncovered items carry the current block + live record');
const mat = extractFn('tripsyOutfitMaterializeUncovered');
assert(/item\.outfits\.blocks\.push\(saved\);[\s\S]*item\.kind = 'dress'; item\.block = saved;/.test(mat) && /tripsyOutfitMaterializeUncovered\(item\);/.test(fix),
  'an uncovered block is materialized as an empty saved block (shared helper; the fix page uses it too)');
const disc = extractFn('tripsyOutfitDiscardIfEmpty');
assert(/item\.outfits\.blocks\.splice\(i, 1\);/.test(disc) && /tripsyOutfitDiscardIfEmpty\(item\);/.test(fix) && /ov\._close = close;/.test(fix)
  && /\(ov\._close \|\| \(\(\) => \{ ov\.style\.display = 'none'; \}\)\)\(\)/.test(fix),
  'closed with nothing picked (button or click-outside), the empty block is dropped again so the ⚠️ stays honest');
assert(/no outfit has been composed for this time-block yet/.test(fix) && /Dress outfit' : 'Fix outfit'/.test(fix), 'the page says so');

// "I want the button on the dialog box to take me to the specific outfit where there is a
// problem and show the specific garments that can be selected to address that problem"
// (2026-10-05): the button opens THE outfit (the modal above, which marks the unpacked
// garment with replacements and a missing role with Add candidates), not a separate page.
const open = extractFn('tripsyOutfitOpenProblem');
assert(/tripsyOutfitMaterializeUncovered\(item\);/.test(open) && /showTripsyOutfitModal\(tripKey, eventId, item\.person, \{ onClose: \(\) => tripsyOutfitDiscardIfEmpty\(item\) \}\)/.test(open),
  'THE ASK: the dialog button opens that specific outfit (an uncovered block is materialized first; closed empty, it is dropped)');
assert(/if \(!eventId\) \{ showTripsyOutfitFixPage\(tripKey, item\); return; \}/.test(open), 'only a block with no event at all falls back to the fix page');
assert(/const close = \(\) => \{ ov\.style\.display = 'none'; if \(opts\.onClose\) opts\.onClose\(\); \};\s*ov\._close = close;/.test(modal)
  && /\(ov\._close \|\| \(\(\) => \{ ov\.style\.display = 'none'; \}\)\)\(\)/.test(modal), 'the modal honors onClose from its button and from click-outside');
assert(/if \(currentView === 'tripsytrips'\) renderTripsyEventsList\(\); \/\/ the menu ⚠️ re-judges/.test(modal), 'a change made there re-judges the menu ⚠️');

// "This is all I am seeing - still no way to get to the specific outfit causing the problem"
// (2026-10-05, screenshot: the dialog's only row was the "packing picks changed" fallback).
// The fingerprint gate flagged a trip where picks were merely ADDED, so there was no outfit
// to name. Staleness is now judged per outfit, by the same lost-garment rule the reasons use.
const need = extractFn('tripsyOutfitsNeedRecompose');
assert(!/selMoved/.test(need) && !/outfits\.selectionFingerprint\.hash/.test(need) && /return lostSomething \|\| incomplete \|\| uncovered;/.test(need),
  'THE REPORT: a changed packing selection alone never raises the ⚠️ -- only an outfit that lost a garment, or an uncovered block');
assert(/!selected\.has\(id\) && !\(garmentById\.has\(id\) && tripsyWardrobeGarmentExcludedFromOutfits\(garmentById\.get\(id\)\)\)/.test(need)
  && /!selected\.has\(id\) && !\(garmentById\.has\(id\) && tripsyWardrobeGarmentExcludedFromOutfits\(garmentById\.get\(id\)\)\)/.test(extractFn('tripsyOutfitStaleReasons')),
  'the check and the reasons share one lost rule, so every flag has a row naming its outfit (a deleted garment counts as lost)');
assert(/data-tw-outfit-remove-dangling="\$\{esc\(id\)\}"/.test(modal) && /applyOutfitChange\(btn\.dataset\.twOutfitRemoveDangling, TRIPSY_OUTFIT_SWAP_REMOVE\)/.test(modal),
  'an outfit still listing a deleted garment offers Remove it, so that problem can be cleared on the outfit too');

// "I just want to confirm that all outfits for the Singapore GP trip are correct and complete"
// (2026-10-05): the live check found an outfit with no bottoms and no ⚠️ -- its unpacked shorts
// had been removed and nothing added. An incomplete outfit now raises the warning and gets a row.
assert(/return lostSomething \|\| incomplete \|\| uncovered;/.test(extractFn('tripsyOutfitsNeedRecompose')), 'THE ASK: an outfit missing a top/bottoms/shoes raises the outfits ⚠️');
assert(/outfit has no \$\{missing\.map\(r => \(TRIPSY_FLIGHT_WORN_ROLE_LABEL\[r\] \|\| r\)\.toLowerCase\(\)\)\.join\(', '\)\}`/.test(extractFn('tripsyOutfitStaleReasons')),
  'and the problems dialog names what is missing, with a button to that outfit');
