const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
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
const src = extractConst('TRIPSY_UNCUBED_TYPES') + '\n'
  + ['tripsyGarmentTypeKey', 'tripsyGarmentSkipsCube', 'tripsyCubesForEntry',
     'tripsyNormalizeTripSelection'].map(extractFn).join('\n');

fs.writeFileSync('orphan_run.js', `
${src}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

// THE MECHANISM behind the bug: normalisation pads every PACKED copy to a cube slot,
// and an uncubed garment's slots are empty strings -- which is exactly what the
// "Cube not set" block collects.
const norm = tripsyNormalizeTripSelection([
  { id: 'suit1', category: 'formal', line: 'Suit', qty: 1, packed: 1, cubes: [] },
  { id: 'tie1',  category: 'formal', line: 'Ties', qty: 2, packed: 2, cubes: [] },
  { id: 'shirt1', category: 'formal', line: 'Dress shirts', qty: 2, packed: 2, cubes: ['cubeA'] },
]);
const by = Object.fromEntries(norm.map(e => [e.id, e]));
assert(JSON.stringify(by.suit1.cubes) === '[""]', 'a packed suit is padded to one empty slot -> ' + JSON.stringify(by.suit1.cubes));
assert(JSON.stringify(by.tie1.cubes) === '["",""]', 'a packed pair of ties -> two empty slots');
assert(JSON.stringify(by.shirt1.cubes) === '["cubeA",""]', 'a real shirt keeps its cube, second copy unknown');

// THE FIX, as the contents page now applies it: skip uncubed garments before collecting.
const names = { suit1: 'Navy suit', tie1: 'Silk neckties', shirt1: 'Dress shirts' };
const orphans = [];
for (const e of norm) {
  const name = names[e.id];
  if (tripsyGarmentSkipsCube(name)) continue;
  for (const cid of e.cubes) if (!cid) orphans.push(name);
}
assert(!orphans.includes('Navy suit'), 'the suit is no longer listed under "Cube not set"');
assert(!orphans.includes('Silk neckties'), 'the ties are no longer listed under "Cube not set"');
assert(orphans.length === 1 && orphans[0] === 'Dress shirts',
  'a genuinely unplaced foldable garment IS still listed -> ' + JSON.stringify(orphans));

// A generic ("No Picture") line carries its own typeKey, which wins over the name.
assert(tripsyGarmentSkipsCube('anything', 'tie'), 'a generic tie line is skipped by typeKey');
assert(!tripsyGarmentSkipsCube('Dress shirts', ''), 'an empty typeKey falls back to the name');
// An entry whose garment record is missing entirely must not crash the filter.
assert(tripsyGarmentSkipsCube(undefined) === false, 'a missing garment name is treated as cubed, not skipped');
`);
