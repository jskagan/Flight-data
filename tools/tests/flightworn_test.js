const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
function extractConst(name) {
  const start = html.indexOf(`const ${name} = `);
  if (start < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const consts = ['TRIPSY_ATTIRE_CATEGORY_ORDER', 'TRIPSY_ATTIRE_CATEGORY_LABEL', 'TRIPSY_ATTIRE_ITEMIZED_CATEGORIES',
  'TRIPSY_ATTIRE_CAMEL_KEY', 'TRIPSY_WARDROBE_GENERAL_TIER', 'TRIPSY_FLIGHT_WORN_SUFFIX', 'TRIPSY_FLIGHT_WORN_ROLE_LABEL', 'TRIPSY_ATTIRE_PACKING_GROUPS',
  ].map(extractConst).join('\n');
const fns = ['tripsyGarmentTypeKey', 'tripsyAttirePackingGroupOf', 'tripsyAttireIsExcludedPackingItem',
  'tripsyAttireDisplayCategory', 'tripsyWardrobeFlightDepartureEvent', 'tripsyWardrobeFirstFlightBlockTier', 'tripsyWardrobeFlightWornClaimer',
  'tripsyWardrobeLineIsFlightWorn', 'tripsyWardrobePackedNeedLines', 'tripsyWardrobeNeedByTier'].map(extractFn).join('\n');

const item = (name, quantity, category, group) => ({ name, quantity, category, group });
// A trip that STARTS with a flight, dressed casual, then a formal evening.
const guide = {
  tripKey: 'T1',
  counts: { casual: 4, formal: 2 },
  days: [
    { dayKey: '2026-08-05', events: [
      { id: 'e1', resource: 'transportation', name: 'Flight from LAX to LHR • BA 268', category: 'casual', displayCategory: 'casual' },
    ] },
    { dayKey: '2026-08-06', events: [
      { id: 'e2', resource: 'activity', name: 'Concert', category: 'formal', displayCategory: 'formal' },
    ] },
  ],
  packingList: { him: [
    item('casual tops', '5', 'casual', 'tops'),
    item('casual shorts', '2', 'casual', 'pants'),
    item('casual bottoms', '1', 'casual', 'pants'),
    item('casual sneakers', '1', 'casual', 'footwear'),
    item('dress shirts', '2', 'formal', 'tops'),
    item('suits', '1', 'formal', 'pants'),
    item('formal dress shoes', '1', 'formal', 'footwear'),
    item('underwear', '8', '', 'essentials'),
    item('socks', '8', '', 'essentials'),
  ] },
};

const code = `
${consts}
${fns}
const guide = ${JSON.stringify(guide)};
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const need = tripsyWardrobeNeedByTier(guide, 'him');
const names = t => (need[t] || []).map(l => l.name + ' x' + l.need);
console.log('casual :', names('casual'));
console.log('formal :', names('formal'));
console.log('general:', names(${JSON.stringify('general')}));

// The flight block is casual, so casual top/bottom/shoes are each deducted one...
const flightLines = (need['casual'] || []).filter(l => l.flightWorn);
assert(flightLines.length === 3, 'three casual roles become "wearing on the flight" lines -> ' + flightLines.length);
assert(flightLines.every(l => l.need === 1), 'each flight-worn line needs exactly 1');
assert(flightLines.every(l => tripsyWardrobeLineIsFlightWorn(l.name)), 'flight-worn lines are recognised by name');
// ...and the packed side drops by one. A line reduced to nothing disappears from the BAG
// but still has its worn companion -- which is the whole point: the jeans exist again.
const casualBottoms = (need['casual'] || []).filter(l => /^Bottoms/.test(l.name));
assert(casualBottoms.length === 1 && casualBottoms[0].flightWorn,
  'the 1-pair casual bottoms line survives ONLY as the flight-worn pick -> ' + JSON.stringify(casualBottoms.map(l => l.name)));
const casualTops = (need['casual'] || []).filter(l => /tops/i.test(l.name) || /^Top /.test(l.name));
assert(casualTops.length === 2, 'casual tops splits into packed + flight-worn -> ' + casualTops.map(l => l.name + ' x' + l.need).join(' | '));
assert(casualTops.some(l => !l.flightWorn && l.need === 4), 'packed casual tops drops 5 -> 4');

// Essentials are worn, not styled: deducted, never offered as a pick.
assert(!(need['general'] || []).some(l => l.flightWorn), 'no flight-worn line for underwear/socks');
assert((need['general'] || []).some(l => /underwear/i.test(l.name) && l.need === 7), 'underwear 8 -> 7');

// Formal is a different tier and is untouched by the casual departure.
assert(!(need['formal'] || []).some(l => l.flightWorn), 'no flight-worn lines in another tier');
assert((need['formal'] || []).some(l => /dress shirts/.test(l.name) && l.need === 2), 'formal dress shirts untouched');

// Packing Status sees only what goes IN THE BAG.
const packed = tripsyWardrobePackedNeedLines(need);
assert(!Object.keys(packed).some(t => packed[t].some(l => l.flightWorn)), 'Packing Status strips every flight-worn line');
assert(!(packed['casual'] || []).some(l => /bottoms/i.test(l.name)), 'nothing to pack for the bottoms you fly in');
assert((packed['casual'] || []).length === (need['casual'] || []).length - 3, 'exactly the 3 companions are stripped');
assert(JSON.stringify(packed['formal']) === JSON.stringify(need['formal']), 'unaffected tiers pass through unchanged');

// THE BOTTOM YOU FLY IN IS NEVER SHORTS while the tier has a real trouser line, even
// though "casual shorts" is listed FIRST in the guide.
assert((packed['casual'] || []).some(l => /shorts/.test(l.name) && l.need === 2), 'shorts are NOT the deducted bottom: both pairs still get packed');
// Every companion is named for its ROLE, never for the line it was deducted from.
assert(JSON.stringify(flightLines.map(l => l.name).sort()) === JSON.stringify([
  'Bottoms — wearing on the flight', 'Shoes — wearing on the flight', 'Top — wearing on the flight'].sort()),
  'companions are named by role -> ' + flightLines.map(l => l.name).join(' | '));

// A tier with ONLY shorts still claims one, rather than claiming nothing.
const g3 = JSON.parse(JSON.stringify(guide));
g3.packingList.him = g3.packingList.him.filter(i => i.name !== 'casual bottoms');
const need3 = tripsyWardrobeNeedByTier(g3, 'him');
const b3 = (need3['casual'] || []).filter(l => l.flightWorn && l.group === 'pants');
assert(b3.length === 1 && /^Bottoms/.test(b3[0].name), 'with only shorts, one IS claimed -- and still reads "Bottoms" -> ' + JSON.stringify(b3.map(l => l.name)));
assert((need3['casual'] || []).some(l => !l.flightWorn && /shorts/.test(l.name) && l.need === 1), 'and the shorts line is what got deducted, 2 -> 1');

// A trip that does NOT start with a flight gets no companions at all.
const g2 = JSON.parse(JSON.stringify(guide));
g2.days[0].events[0].name = 'Car from home to LAX';
const need2 = tripsyWardrobeNeedByTier(g2, 'him');
assert(!Object.keys(need2).some(t => need2[t].some(l => l.flightWorn)), 'no flight, no flight-worn lines');
assert((need2['casual'] || []).some(l => /casual bottoms/.test(l.name) && l.need === 1), 'and the bottoms line is packed as normal');
`;
fs.writeFileSync(__dirname + '/flightworn_run.js', code);
