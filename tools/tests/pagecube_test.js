const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
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
// The banner block, lifted verbatim from renderDetail (declaration through pageCubesHtml).
const block = html.match(/    const pageCubeIds = \[\];[\s\S]*?\n      <\/div>`;/);
if (!block) throw new Error('page cube block not found');

fs.writeFileSync('pagecube_run.js', `
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let driveData = { tripsyPackingCubes: [] };
${extractConst('TRIPSY_CUBE_SIZES')}
${extractConst('TRIPSY_CUBE_COLORS')}
${extractConst('TRIPSY_CUBE_COLOR_CSS')}
${extractConst('TRIPSY_UNCUBED_TYPES')}
${['tripsyGarmentTypeKey','tripsyGarmentSkipsCube','tripsyCubeById','tripsyCubeName','tripsyCubeTileHtml'].map(extractFn).join('\n')}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
driveData.tripsyPackingCubes = [
  { id: 'c1', color: 'Yellow', size: 'Medium', brand: '', driveFileId: 'photoYellow' },
  { id: 'c2', color: 'Black', size: 'Small', brand: '', driveFileId: 'photoBlack' },
];
const run = (garmentItems, genItems) => {
${block[0].replace(/^    /gm, '  ')}
  return { pageCubesHtml, pageCubesSplit, pageCubeIds, pageCubeCounts };
};
const G = (name, cubes) => ({ g: { id: name, name }, qty: cubes.length, packed: cubes.length, cubes });

// THE COMMON CASE: everything on the page in one cube -> ONE large picture, and the
// per-card chips are suppressed as pure repetition.
let r = run([G('Charcoal Rhone Gym Shirt', ['c1']), G('Blue Rhone Gym Shirt', ['c1'])], []);
assert(!r.pageCubesSplit, 'one cube for the whole page is not a split');
assert((r.pageCubesHtml.match(/data-tw-cube-photo/g) || []).length === 1, 'exactly ONE cube picture is drawn');
assert(/width:96px; height:96px/.test(r.pageCubesHtml) || /size: 96/.test('') || /96px/.test(r.pageCubesHtml), 'and it is the LARGE size, not a 26px thumbnail');
assert(/Yellow Medium/.test(r.pageCubesHtml), 'named under the picture');
assert(/2 items/.test(r.pageCubesHtml), 'with the count of packed copies -> ' + (r.pageCubesHtml.match(/\\d+ items?/)||[])[0]);

// SPLIT ACROSS CUBES: every cube gets its own large picture AND text, and the per-card
// chips stay, since only they say which garment went where.
r = run([G('Charcoal Rhone Gym Shirt', ['c1']), G('Blue Rhone Gym Shirt', ['c2'])], []);
assert(r.pageCubesSplit, 'two cubes on one page IS a split');
assert((r.pageCubesHtml.match(/data-tw-cube-photo/g) || []).length === 2, 'both cubes are pictured');
assert(/Yellow Medium/.test(r.pageCubesHtml) && /Black Small/.test(r.pageCubesHtml), 'and both named');

// Copies of one garment split across two cubes also counts as a split.
r = run([G('Chinos', ['c1','c2'])], []);
assert(r.pageCubesSplit, 'one garment split across two cubes is a split too');
assert(r.pageCubeCounts.get('c1') === 1 && r.pageCubeCounts.get('c2') === 1, 'each copy counted once');

// UNCUBED types contribute nothing: their card already says why they have no cube.
r = run([G('Navy suit', ['']), G('Silk neckties', ['','']), G('Black oxfords', [''])], []);
assert(r.pageCubeIds.length === 0 && r.pageCubesHtml === '', 'a page of uncubed garments shows no cube banner');

// A packed copy with no cube recorded still shows -- as its own "Cube not set" entry --
// rather than vanishing from the banner.
r = run([G('Chinos', ['']), G('Jeans', ['c1'])], []);
assert(/Cube not set/.test(r.pageCubesHtml), 'an unplaced copy is called out');
assert(r.pageCubesSplit, 'and counts as a split, so the cards say which is which');
assert((r.pageCubesHtml.match(/data-tw-cube-photo/g) || []).length === 1, 'only the real cube has a picture');

// Nothing packed at all -> no banner (not an empty box).
r = run([G('Chinos', [])], []);
assert(r.pageCubesHtml === '', 'an unpacked page shows no banner');

// Generic ("No Picture") lines are counted too, and their typeKey decides uncubed-ness.
r = run([], [{ x: { name: 'T-shirts', typeKey: 'tee', packed: 2, qty: 2, cubes: ['c1','c1'] } }]);
assert(/2 items/.test(r.pageCubesHtml), 'generic lines count toward the banner');
r = run([], [{ x: { name: 'Ties', typeKey: 'tie', packed: 1, qty: 1, cubes: [''] } }]);
assert(r.pageCubesHtml === '', 'an uncubed generic line contributes nothing');
`);
