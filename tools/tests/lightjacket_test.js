// "Create a category of 'Light Jacket' - and convert the Loro Piana jacket from a rain
// jacket to a light jacket." tripsyGarmentTypeKey previously folded every jacket/coat/
// raincoat/parka into ONE 'jacket' typeKey -- so a light, packable travel jacket (the
// owner's real garment: "Rust Loro Piana Traveler Jacket", Loro Piana's own product
// name for this kind of piece) was indistinguishable from a heavy coat, both for
// need-line matching AND for TRIPSY_UNCUBED_TYPES (which hangs every 'jacket'). A new
// 'light-jacket' type is split out, checked BEFORE the general jacket rule, and
// deliberately left OUT of TRIPSY_UNCUBED_TYPES -- a light jacket folds small and packs
// in a cube, unlike a heavy one that hangs.
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
  const start = html.indexOf(`const ${name} = `);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

eval(extractFn('tripsyGarmentTypeKey').replace(/^function/, 'var tripsyGarmentTypeKey = function'));

// ---- the real garment, by its real name, reclassifies with no data edit needed ----
assert(tripsyGarmentTypeKey('Rust Loro Piana Traveler Jacket') === 'light-jacket',
  "THE ASK: the owner's actual Loro Piana jacket reclassifies from 'jacket' to 'light-jacket'");

// ---- other light-jacket phrasing also lands in the new category ----
assert(tripsyGarmentTypeKey('Navy Light Jacket') === 'light-jacket', '"light jacket" matches');
assert(tripsyGarmentTypeKey('Packable travel jacket') === 'light-jacket', '"travel jacket" matches too');
assert(tripsyGarmentTypeKey('Lightweight Jacket') === 'light-jacket', '"lightweight jacket" matches');
assert(tripsyGarmentTypeKey('Packable Jacket') === 'light-jacket', '"packable jacket" matches');

// ---- a plain heavy jacket/coat/raincoat is UNCHANGED -- still the general bucket ----
assert(tripsyGarmentTypeKey('Navy Wool Overcoat') === 'jacket', 'a plain overcoat stays "jacket", unaffected');
assert(tripsyGarmentTypeKey('Black Rain Jacket') === 'jacket', 'a plain rain jacket stays "jacket" too');
assert(tripsyGarmentTypeKey('Down Parka') === 'jacket', 'and a parka');

// ---- the new type is registered everywhere the existing types are ----
assert(/'light-jacket': 'Light Jackets'/.test(html), 'has a display label');
assert(/'light-jacket'/.test(extractConst('TRIPSY_GARMENT_TYPE_ORDER')), 'is in the type-order list (used by Pack-For-Trip grouping)');
assert(/'light-jacket'/.test(extractConst('TRIPSY_WARDROBE_FILTER_ORDER')), 'is in the Wardrobe page\'s filter-order list');
assert(/'light-jacket': '🧥'/.test(html), 'has a glyph for its photoless packing slot');

// ---- THE POINT of splitting it out: unlike a heavy jacket, it is NOT hung -- it can
// go in a packing cube like an ordinary folded garment ----
const uncubedTypes = extractConst('TRIPSY_UNCUBED_TYPES');
assert(/'jacket'/.test(uncubedTypes), 'sanity: the general jacket type is still hung, unchanged');
assert(!/'light-jacket'/.test(uncubedTypes), "light-jacket is deliberately NOT in TRIPSY_UNCUBED_TYPES -- it's packed in a cube, not hung");

// ---- executed: tripsyGarmentSkipsCube actually reflects that split ----
{
  const TRIPSY_UNCUBED_TYPES = eval(uncubedTypes.replace('const TRIPSY_UNCUBED_TYPES = ', ''));
  eval(extractFn('tripsyGarmentSkipsCube').replace(/^function/, 'var tripsyGarmentSkipsCube = function'));
  assert(tripsyGarmentSkipsCube('Navy Wool Overcoat', 'jacket') === true, 'a heavy jacket still skips the cube (hangs)');
  assert(tripsyGarmentSkipsCube('Rust Loro Piana Traveler Jacket', 'light-jacket') === false,
    'the light jacket does NOT skip the cube -- it can be assigned one like any packed garment');
}
