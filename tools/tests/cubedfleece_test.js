// "I packed a light fleece and rain jacket in a cube, but the app does not allow me to
// show them as packed in a cube" (2026-10-06). tripsyGarmentTypeKey filed fleeces and rain
// jackets under the HANGING 'jacket' type (TRIPSY_UNCUBED_TYPES), so the cube picker was
// never offered for them. Packable outerwear is now 'light-jacket' -- the type the Loro
// Piana split created precisely so a folding jacket could take a cube -- and the
// need-line fold keeps a "rain jacket" line offering and counting all of it.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const constSource = name => {
  const start = html.indexOf(`const ${name} = `);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
};
const api = new Function(
  [constSource('TRIPSY_UNCUBED_TYPES'), fnSource('tripsyGarmentTypeKey'), fnSource('tripsyGarmentSkipsCube'),
   fnSource('tripsyGarmentLineMatchType'), fnSource('tripsyAttirePackingGroupOf'),
   "const TRIPSY_ATTIRE_PACKING_GROUPS = ['tops','pants','dress_wear','outerwear','footwear','essentials','accessories'];",
   'return { typeKey: tripsyGarmentTypeKey, skips: tripsyGarmentSkipsCube, fold: tripsyGarmentLineMatchType, group: tripsyAttirePackingGroupOf };'].join('\n'))();

// ---- THE ASK: the two real garments take a cube ----
for (const n of ['Light fleece', 'Rain jacket', 'Grey Light Fleece', 'Black Rain Jacket']) {
  assert(api.typeKey(n) === 'light-jacket' && api.skips(n) === false, `THE ASK: "${n}" is packable outerwear and may be assigned a cube`);
}
// ---- the other packable kinds, by name and by prefix ----
for (const n of ['Fleece', 'Windbreaker', 'Anorak', 'Puffer', 'Puffer jacket', 'Gilet', 'Overshirt', 'Shacket',
  'Lightweight coat', 'Packable raincoat', 'Packable travel coat', 'Travel jacket', 'Light down jacket']) {
  assert(api.typeKey(n) === 'light-jacket' && api.skips(n) === false, `"${n}" packs in a cube`);
}
// ---- what still hangs ----
for (const n of ['Navy Jacket', 'Wool coat', 'Overcoat', 'Tan Raincoat', 'Down Parka', 'Leather jacket']) {
  assert(api.typeKey(n) === 'jacket' && api.skips(n) === true, `"${n}" still hangs (no cube)`);
}
// ---- agreement with the rest of the app ----
assert(api.fold('light-jacket') === 'jacket', 'need-line matching folds light-jacket to jacket, so a "rain jacket" line still offers and counts a fleece or rain jacket');
for (const n of ['Light fleece', 'Rain jacket', 'Packable travel coat']) {
  assert(api.group({ name: n }) === 'outerwear', `"${n}" keeps the outerwear packing group (the type and group rules must agree)`);
}
assert(!/'light-jacket'/.test(constSource('TRIPSY_UNCUBED_TYPES')), 'light-jacket stays out of TRIPSY_UNCUBED_TYPES');
// The light-jacket rules sit BEFORE the hanging-jacket rule, or "rain jacket" would be
// swept up by \bjackets?\b first.
const tk = fnSource('tripsyGarmentTypeKey');
assert(tk.indexOf("return 'light-jacket'") < tk.indexOf("return 'jacket'"), 'the light-jacket rules precede the hanging jacket rule');
