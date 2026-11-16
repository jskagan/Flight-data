// Sweaters are both tops and outerwear (2026-11-14).
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
function fn(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let j = src.indexOf('{', src.indexOf(')', i)), d = 0;
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
}
function konst(name) { const m = src.match(new RegExp('const ' + name + ' = [^;]*;')); if (!m) throw new Error('missing ' + name); return m[0]; }
const code = [konst('TRIPSY_ATTIRE_PACKING_GROUPS'), konst('TRIPSY_OUTFIT_ROLES'), fn('tripsyGarmentTypeKey'), fn('tripsyAttirePackingGroupOf'),
  fn('tripsyGarmentIsLayerOnly'), fn('tripsyGarmentPackingGroups'), konst('TRIPSY_WEARS_BEFORE_WASH'), konst('TRIPSY_WEARS_BEFORE_WASH_BY_GROUP'), fn('tripsyWearsBeforeWash'), fn('tripsyGarmentsShareKind'), fn('tripsyOutfitGarmentRoles')].join('\n');
const api = new Function(code + '\nreturn { tripsyWearsBeforeWash, tripsyGarmentTypeKey, tripsyGarmentPackingGroups, tripsyGarmentsShareKind, tripsyOutfitGarmentRoles };')();
const sw = { name: 'Rust Cashmere Sweater', group: 'outerwear' };
const swTop = { name: 'Navy Cardigan', group: 'tops' };
const qz = { name: 'Black Pleats Quarter Zip', group: 'tops' };
const polo = { name: 'Blue Polo', group: 'tops' };
const coat = { name: 'Black Raincoat', group: 'outerwear' };
const jeans = { name: 'Blue Jeans', group: 'pants' };
ok(JSON.stringify(api.tripsyGarmentPackingGroups(sw)) === '["outerwear","tops"]', 'outerwear sweater is also a top');
ok(JSON.stringify(api.tripsyGarmentPackingGroups(swTop)) === '["tops","outerwear"]', 'tops sweater is also outerwear');
ok(api.tripsyGarmentTypeKey(qz.name) === 'sweater', 'a quarter zip types as a sweater');
ok(api.tripsyGarmentTypeKey('Charcoal Cable 1/4 Zip Sweater') === 'sweater', '1/4 zip sweater');
ok(api.tripsyGarmentPackingGroups(qz).includes('outerwear'), 'quarter zip is also outerwear');
ok(JSON.stringify(api.tripsyGarmentPackingGroups(polo)) === '["tops"]', 'a polo is only a top');
ok(JSON.stringify(api.tripsyGarmentPackingGroups(coat)) === '["outerwear"]', 'a raincoat is only outerwear');
ok(api.tripsyGarmentsShareKind(sw, polo) && api.tripsyGarmentsShareKind(polo, sw), 'sweater <-> casual top swap');
ok(api.tripsyGarmentsShareKind(sw, coat), 'sweater <-> outerwear swap');
ok(!api.tripsyGarmentsShareKind(polo, coat), 'a polo is never a coat');
ok(!api.tripsyGarmentsShareKind(sw, jeans), 'a sweater is never bottoms');
ok(JSON.stringify(api.tripsyOutfitGarmentRoles(sw)) === '["tops"]', 'a sweater fills the top role');
ok(api.tripsyOutfitGarmentRoles(coat).length === 0, 'a coat fills no role');
ok(/!tripsyGarmentPackingGroups\(g\)\.includes\(ln\.group\)/.test(src), 'need-line fill uses both kinds');
ok(/tripsyGarmentsShareKind\(g, current\)/.test(src) && /tripsyGarmentsShareKind\(g, oldGarment\)/.test(src), 'Swap, Ship Home swap and Replace use both kinds');
ok(/tripsyGarmentPackingGroups\(g\)\.includes\(type\)/.test(src), 'Add Garment type filter uses both kinds');
// Overshirts are layers (2026-11-15), even when filed under Tops.
const over = { name: 'Blue Plaid Overshirt', group: 'tops' };
ok(JSON.stringify(api.tripsyGarmentPackingGroups(over)) === '["outerwear"]', 'an overshirt filed as a top is a layer only');
ok(!api.tripsyGarmentsShareKind(over, polo), 'an overshirt is never swapped for a polo');
ok(api.tripsyGarmentsShareKind(over, sw) && api.tripsyGarmentsShareKind(over, coat), 'an overshirt swaps with a sweater or a jacket');
ok(api.tripsyOutfitGarmentRoles(over).length === 0, 'an overshirt is not the outfit\'s top');
ok(api.tripsyWearsBeforeWash(over.name, null, 'tops') === Infinity, 'an overshirt is re-worn, not a one-wear top');
ok(api.tripsyWearsBeforeWash('Blue Polo', null, 'tops') === 1, 'a polo is still one wear');
ok(/tripsyOutfitSwapCandidates\(tripKey, block, currentGarmentId, person, liveTier, \{ offerLayers: true \}\)/.test(src), 'the manual Swap picker offers layers');
ok((src.match(/offerLayers: true/g) || []).length === 1, 'only the manual picker offers layers');
console.log(`sweaterboth_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
