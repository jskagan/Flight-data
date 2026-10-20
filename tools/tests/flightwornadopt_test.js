// "Wear on flight" picked in the cube picker moves that garment onto the Packing List's
// flight-worn line, so there is exactly ONE flight outfit whichever path chose it
// (2026-10-20). Synthetic fixtures only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const constLine = name => { const m = html.match(new RegExp(`const ${name} = [^\\n]*`)); if (!m) throw new Error('missing const ' + name); return m[0]; };
const adopt = new Function('tripsyAttirePackingGroupOf', [constLine('TRIPSY_FLIGHT_WORN_SUFFIX'), constLine('TRIPSY_CUBE_FLIGHT_WORN'), constLine('TRIPSY_FLIGHT_WORN_ROLE_LABEL'), constLine('TRIPSY_OUTFIT_ROLES'),
  fnSource('tripsyGarmentTypeKey'), fnSource('tripsyOutfitGarmentRoles'), fnSource('tripsyWardrobeLineIsFlightWorn'), fnSource('tripsyWardrobeAdoptFlightWornPick'),
  'return tripsyWardrobeAdoptFlightWornPick;'].join('\n'))(g => g.group || 'tops');

const FW = ' — wearing on the flight';
const FLIGHT = '__cube_flight_worn__';
const need = { casual: [{ name: 'casual tops', need: 3 }, { name: 'Top' + FW, need: 1, flightWorn: true }, { name: 'Bottoms' + FW, need: 1, flightWorn: true }], general: [] };
const polo = { id: 'polo', name: 'Grey polo', group: 'tops' }, tee = { id: 'tee', name: 'Black tee', group: 'tops' }, jeans = { id: 'jeans', name: 'Jeans', group: 'pants' };
{
  // The tee was the flight top (picked on the Packing List); the owner now marks one of two polos "Wear on flight" on the casual tops row.
  const entries = [
    { id: 'tee', category: 'casual', line: 'Top' + FW, qty: 1, packed: 1, cubes: [FLIGHT] },
    { id: 'polo', category: 'casual', line: 'casual tops', qty: 2, packed: 2, cubes: [FLIGHT, 'c1'] },
    { id: 'jeans', category: 'casual', line: 'jeans', qty: 1, packed: 1, cubes: ['c1'] },
  ];
  const out = adopt(entries, polo, 'casual', 'casual tops', need);
  assert(out && !out.some(e => e.id === 'tee'), 'THE ASK: the garment previously on the flight-worn line is replaced');
  const fw = out.find(e => e.line === 'Top' + FW);
  assert(fw && fw.id === 'polo' && fw.category === 'casual' && fw.qty === 1 && fw.packed === 1 && fw.cubes.join() === FLIGHT, 'THE ASK: the polo moves onto the flight-worn line, stored exactly as a Packing List pick there');
  const rest = out.find(e => e.id === 'polo' && e.line === 'casual tops');
  assert(rest && rest.qty === 1 && rest.packed === 1 && rest.cubes.join() === 'c1', 'the ordinary row keeps the other copy, minus the flight slot');
  assert(out.some(e => e.id === 'jeans' && e.cubes.join() === 'c1'), 'unrelated entries are untouched');
}
{
  const entries = [{ id: 'polo', category: 'casual', line: 'casual tops', qty: 1, packed: 1, cubes: [FLIGHT] }];
  const out = adopt(entries, polo, 'casual', 'casual tops', need);
  assert(out.length === 1 && out[0].line === 'Top' + FW, 'a single copy leaves its ordinary row entirely');
  assert(adopt(entries, polo, 'casual', 'Top' + FW, need) === null, 'already on the flight-worn line: nothing to move');
  assert(adopt(entries, jeans, 'casual', 'jeans', need).find(e => e.line === 'Bottoms' + FW).id === 'jeans', 'bottoms go to the Bottoms line');
  assert(adopt(entries, { id: 'tie', name: 'Silk tie', group: 'accessories' }, 'formal', 'ties', need) === null, 'a garment with no top/bottoms/shoes role never moves');
  assert(adopt(entries, polo, 'casual', 'casual tops', { casual: [{ name: 'casual tops', need: 3 }] }) === null, 'no flight-worn line (the trip does not start with a flight): the pick just stays a location');
}
// ---- wiring ----
{
  const status = fnSource('tripsyWardrobePackingList');
  assert(/if \(picked\.includes\(TRIPSY_CUBE_FLIGHT_WORN\)\) \{\n\s*const moved = tripsyWardrobeAdoptFlightWornPick\(selEntries, g, e\.category, e\.line, tripsyWardrobeNeedByTier\(guide, person\)\);\n\s*if \(moved\) \{\n\s*selEntries\.splice\(0, selEntries\.length, \.\.\.moved\);/.test(status),
    'THE ASK: Packing Status moves the garment on a "Wear on flight" pick, then persists through its ordinary save');
  assert(/is now the garment you wear on the flight\./.test(status), 'and says so');
}
