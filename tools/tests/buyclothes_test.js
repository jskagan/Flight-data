// "When I am on a trip, add a menu item called 'Buy Clothes' which allows me to add new
// clothes purchased on the trip. Allow me to take pictures, add descriptions and
// categories, add them to packing cubes, and add them to future outfits via a dialog which
// can recalculate future outfits for the trip" (2026-10-20). Synthetic fixtures only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const constLine = name => { const m = html.match(new RegExp(`const ${name} = [^\\n]*`)); if (!m) throw new Error('missing const ' + name); return m[0]; };
// Stubs: line fit = same packing group; group = the garment's own `group`.
const api = new Function('tripsyWardrobeGarmentFillsLine', 'tripsyAttirePackingGroupOf', 'TRIPSY_GARMENT_TYPE_LABEL', 'TRIPSY_ATTIRE_PACKING_GROUP_LABEL', [
  constLine('TRIPSY_OUTFIT_ROLES'),
  fnSource('tripsyGarmentTypeKey'), fnSource('tripsyOutfitGarmentRoles'),
  fnSource('tripsyBuyClothesPackingLine'), fnSource('tripsyBuyClothesOutfitTargets'), fnSource('tripsyBuyClothesApplyToBlocks'),
  'return { line: tripsyBuyClothesPackingLine, targets: tripsyBuyClothesOutfitTargets, apply: tripsyBuyClothesApplyToBlocks };'].join('\n'))(
  (g, ln) => (ln.group || '') === (g.group || ''), g => g.group || 'tops', { shirt: 'Shirts', trousers: 'Trousers' }, { tops: 'Tops', outerwear: 'Outerwear' });

// ---- which line the bought garment is packed under ----
{
  const need = { casual: [{ name: 'casual tops', group: 'tops' }, { name: 'jeans', group: 'pants' }], cocktail: [{ name: 'dress shirts', group: 'tops' }], general: [] };
  const polo = { id: 'p', name: 'Linen polo', group: 'tops', tiers: ['cocktail', 'casual'] };
  assert(JSON.stringify(api.line(need, polo)) === JSON.stringify({ tier: 'cocktail', line: 'dress shirts' }), 'THE ASK: packed under the first of its dress categories with a line it fits');
  const linen = { id: 's', name: 'Linen shirt', group: 'tops', tiers: ['formal', 'casual'] };
  assert(JSON.stringify(api.line(need, linen)) === JSON.stringify({ tier: 'casual', line: 'casual tops' }), 'a tag with no lines on this trip is skipped for one that has');
  const jacket = { id: 'j', name: 'Rain jacket', group: 'outerwear', tiers: ['casual'] };
  assert(JSON.stringify(api.line(need, jacket)) === JSON.stringify({ tier: 'casual', line: 'Outerwear' }), 'no fitting line: its first tag with the type/group-derived name (the Add Garment fallback)');
  assert(api.line(need, { id: 'u', name: 'Socks', group: 'essentials', tiers: [] }).tier === 'general', 'an untagged garment goes under General');
}
// ---- the outfits ahead it could join ----
const byId = new Map([
  ['tee', { id: 'tee', name: 'Grey tee', group: 'tops' }], ['jeans', { id: 'jeans', name: 'Jeans', group: 'pants' }],
  ['sneak', { id: 'sneak', name: 'Sneakers', group: 'footwear' }], ['dshirt', { id: 'dshirt', name: 'White dress shirt', group: 'tops' }],
  ['new', { id: 'new', name: 'Linen shirt', group: 'tops', tiers: ['casual'] }],
]);
const outfits = { blocks: [
  { dayKey: '2026-10-18', category: 'casual', label: 'Beach', garmentIds: ['tee', 'jeans', 'sneak'] },
  { dayKey: '2026-10-20', category: 'casual', label: 'Lunch', garmentIds: ['tee', 'jeans', 'sneak'] },
  { dayKey: '2026-10-21', category: 'cocktail', label: 'Dinner', garmentIds: ['dshirt', 'jeans', 'sneak'] },
  { dayKey: '2026-10-22', category: 'casual', label: 'Ride', garmentIds: ['tee', 'jeans'], wornFromFlightDayKey: '2026-10-21' },
  { dayKey: '2026-10-23', category: 'casual', label: 'Museum', garmentIds: ['new', 'jeans', 'sneak'] },
  { dayKey: '2026-10-24', category: 'casual', label: 'Walk', garmentIds: ['jeans', 'sneak'] },
] };
{
  const t = api.targets(byId.get('new'), outfits, '2026-10-20', byId);
  assert(t.map(x => x.block.label).join() === 'Lunch,Walk', 'THE ASK: only outfits from today on, at a tagged dress code, not a flight mirror, not already wearing it');
  assert(t[0].replaceId === 'tee' && t[0].role === 'tops', 'a top replaces the top already in the outfit');
  assert(t[1].replaceId === null, 'an outfit with no top yet just gains it');
  const jk = api.targets({ id: 'jk', name: 'Light jacket', group: 'outerwear', tiers: [] }, outfits, '2026-10-21', byId);
  assert(jk.map(x => x.block.label).join() === 'Dinner,Museum,Walk' && jk.every(x => x.replaceId === null), 'an untagged outer layer fits any dress code and is ADDED, never a replacement');
  const prev = api.apply(byId.get('new'), t);
  assert(outfits.blocks[1].garmentIds.join() === 'new,jeans,sneak' && outfits.blocks[5].garmentIds.join() === 'jeans,sneak,new', 'apply swaps in place / pushes when nothing is replaced');
  assert(prev.get(outfits.blocks[1]).join() === 'tee,jeans,sneak', 'the previous ids are returned for rollback');
}
// ---- wiring ----
{
  const start = html.indexOf('const attireMenuItems = attireDressOnly');
  const menu = html.slice(start, html.indexOf('].join', start));
  assert(/isOwner && attireHasGuide && attireTripUnderway \? menuListButtonHtml\(`data-tripsy-attire-nav="buy"[^\n]*'Buy Clothes'\)/.test(menu), 'THE ASK: the Buy Clothes row is on the Clothes menu only while the trip is underway, owner-only');
  assert(/case 'buy': tripsyBuyClothesFlow\(key, name\); break;/.test(html), 'the row runs the flow');
  const flow = fnSource('tripsyBuyClothesFlow');
  assert(/showWardrobeGarmentForm\(null, saved => resolve\(saved\), \{\n\s*title: '🛍️ Buy Clothes'/.test(flow) && /onCancel: \(\) => resolve\(null\)/.test(flow), 'step 1 is the Wardrobe garment form (photo, name, type, dress categories), and Cancel ends the flow');
  assert(/showTripsyCubePicker\(g\.name, Array\.from\(\{ length: qty \}, \(\) => ''\)\)/.test(flow) && /tripsyGarmentSkipsCube\(g\.name/.test(flow), 'step 3 is the cube picker, skipped for hanging/loose types');
  assert(/Store\.setTripWardrobe\(tripKey, entries\.map\(e => tripsyWardrobeCarryCubes\(/.test(flow), 'step 2 writes the packing list through the cube-carrying helper');
  assert(/tripsyBuyClothesOutfitDialog\(g, targets, garmentById\)/.test(flow) && /tripsyRecomposeFutureOutfitsInBackground\(tripKey, person, todayKey\)/.test(flow), 'step 4 is the outfits dialog, with Recalculate handing the rest of the trip to the composer');
  assert(/for \(const \[b, ids\] of prev\) b\.garmentIds = ids;/.test(flow), 'a failed outfit save restores every block');
  const form = fnSource('showWardrobeGarmentForm');
  assert(/if \(onSaved\) onSaved\(garment\);/.test(form) && /ov\._onCancel = typeof opts\.onCancel === 'function'/.test(form), 'the form hands back the saved garment and reports a dismissal');
  const compose = fnSource('composeTripsyOutfits');
  assert(/\{ redress = null \} = \{\}\)/.test(compose) && /if \(redress && redress\(b\)\) return; \/\/ asked to be re-dressed: never kept/.test(compose), 'compose can be told to re-dress still-covered blocks');
  assert(/redress: b => b\.dayKey >= fromDayKey/.test(fnSource('tripsyRecomposeFutureOutfitsInBackground')), 'Recalculate re-dresses every block from today on and keeps the days already worn');
  assert(/composeTripsyOutfits\(tripKey, person, \{ redress \}\)/.test(fnSource('runTripsyOutfitComposition')), 'the runner threads it through');
}
