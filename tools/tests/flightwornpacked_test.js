// "Count all garments selected for wear on flight as having been packed" (2026-10-20).
// Synthetic fixtures only.
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
const api = new Function([constLine('TRIPSY_FLIGHT_WORN_SUFFIX'), constLine('TRIPSY_CUBE_FLIGHT_WORN'),
  fnSource('tripsyWardrobeLineIsFlightWorn'), fnSource('tripsyWardrobeFlightWornEntry'), fnSource('tripsyCubesForEntry'), fnSource('tripsyNormalizeTripSelection'),
  'return { normalize: tripsyNormalizeTripSelection, entry: tripsyWardrobeFlightWornEntry, FLIGHT: TRIPSY_CUBE_FLIGHT_WORN };'].join('\n'))();

const FW = ' — wearing on the flight';
{
  const [top, shoes, shirt] = api.normalize([
    { id: 'tee', category: 'casual', line: 'Top' + FW, qty: 1, packed: 0 },
    { id: 'sneak', category: 'casual', line: 'Shoes' + FW, qty: 1, packed: 1, cubes: ['c1'] },
    { id: 'shirt', category: 'formal', line: 'dress shirts', qty: 3, packed: 1, cubes: ['c1'] },
  ]);
  assert(top.packed === 1 && top.cubes.length === 1 && top.cubes[0] === api.FLIGHT, 'THE ASK: a pick on a "wearing on the flight" line reads as PACKED, located "Wear on flight" -- even one saved unpacked before this rule');
  assert(shoes.packed === 1 && shoes.cubes[0] === api.FLIGHT, 'a flight-worn pick someone had put in a real cube is still filed under Wear on flight (it is on your body)');
  assert(shirt.packed === 1 && shirt.cubes.join() === 'c1' && shirt.qty === 3, 'an ordinary line is untouched');
  assert(api.entry({ id: 'x', line: 'Bottoms' + FW, qty: 0 }).qty === 1, 'a flight-worn entry is at least one copy');
  assert(api.entry({ id: 'x', line: 'jeans', qty: 2, packed: 0 }).packed === 0, 'the helper leaves a non-flight line alone');
}
// Every reader loads entries through the normalizer, so the Packing Status tally ("N/X
// packed", summed over the normalized selEntries), the Cubes page and Garment Location
// (both read cubes through tripsyNormalizeTripSelection / tripsyCubesForEntry) all agree.
{
  const status = fnSource('tripsyWardrobePackingList');
  assert(/const selEntries = tripsyWardrobeResolveSelectionLines\(tripsyNormalizeTripSelection\(selectedRaw\)/.test(status), 'Packing Status loads through the normalizer, so its "N/X packed" counts the flight outfit as packed');
  assert(/return tripsyWardrobeLineIsFlightWorn\(entry\.line\) \? tripsyWardrobeFlightWornEntry\(entry\) : entry;/.test(fnSource('tripsyNormalizeTripSelection')), 'the rule lives in the one normalizer every reader shares');
}
