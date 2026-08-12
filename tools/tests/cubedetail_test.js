const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`function ${name}(`);
  if (start < 0) start = html.indexOf(`async function ${name}(`);
  // Body starts at the first '{' AFTER the parameter list closes -- starting at the
  // first '{' anywhere breaks on a destructured default like ({ size = 74 } = {}).
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

fs.writeFileSync('cubedetail_run.js', `
// --- minimal DOM + app stubs: enough to run the real render and read its markup ---
const mkEl = () => ({ innerHTML: '', style: {}, onclick: null, id: '', className: '',
  querySelectorAll: () => [], appendChild(){}, setAttribute(){}, getAttribute(){ return null; } });
const nodes = {};
global.document = {
  getElementById: id => nodes[id] || null,
  createElement: () => mkEl(),
  body: { appendChild: el => { nodes[el.id] = el; } },
};
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let driveData = { tripsyPackingCubes: [] };
const tripsyCubePhotoUrlCache = new Map();
const tripsyPaintCubePhotos = () => {};
let photosPainted = 0;
const tripsyWardrobeLoadPhotos = () => { photosPainted++; };
const tripsyConfirmDialog = async () => false;
const Store = { deletePackingCube: async () => true };
const showTripsyCubeForm = async () => null;

${extractConst('TRIPSY_CUBE_BRANDS')}
${extractConst('TRIPSY_CUBE_SIZES')}
${extractConst('TRIPSY_CUBE_COLORS')}
${extractConst('TRIPSY_CUBE_COLOR_CSS')}
${extractConst('TRIPSY_UNCUBED_TYPES')}
${extractConst('TRIPSY_GARMENT_TYPE_GLYPH')}
${extractConst('TRIPSY_ATTIRE_GROUP_GLYPH')}
${extractConst('TRIPSY_CUBE_NONE')}
${extractConst('TRIPSY_CUBE_FLIGHT_WORN')}
${['tripsyGarmentTypeKey','tripsyGarmentSkipsCube','tripsyGarmentGlyph','tripsyCubeById',
   'tripsyCubeName','tripsyCubesSorted','tripsyCubeTileHtml','tripsyCubeSlotLabel','tripsyCubeSlotGlyph',
   'showTripsyCubeContents'].map(extractFn).join('\n')}

const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

driveData.tripsyPackingCubes = [
  { id: 'c1', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Reveal', driveFileId: 'cubephoto1' },
  { id: 'c2', color: 'Black', size: 'Small', brand: '' },
];
const garments = [
  { id: 'g1', name: 'Dress shirts', driveFileId: 'photoA', group: 'tops' },
  { id: 'g2', name: 'Chinos', driveFileId: '', group: 'pants' },
  { id: 'g3', name: 'Navy suit', driveFileId: 'photoC', group: 'dress_wear' },
];
const garmentById = new Map(garments.map(g => [g.id, g]));
const state = {
  garmentById,
  // g1 appears under TWO tiers, both in c1 -- the drill-down must total them as x3.
  selEntries: [
    { id: 'g1', category: 'formal', line: 'Dress shirts', qty: 2, packed: 2, cubes: ['c1','c1'] },
    { id: 'g1', category: 'cocktail', line: 'Dress shirts', qty: 1, packed: 1, cubes: ['c1'] },
    { id: 'g2', category: 'casual', line: 'Trousers', qty: 1, packed: 1, cubes: ['c2'] },
    { id: 'g3', category: 'formal', line: 'Suit', qty: 1, packed: 1, cubes: [''] },   // uncubed
    { id: 'g2', category: 'smart_casual', line: 'Trousers', qty: 1, packed: 1, cubes: [''] }, // genuinely unplaced
  ],
  generics: [
    { category: 'casual', typeKey: 'tee', name: 'T-shirts', qty: 3, packed: 2, cubes: ['c2','c2'] },
  ],
};
showTripsyCubeContents(() => state, null);
const ov = nodes['tw-cube-contents-overlay'];
const listHtml = ov.innerHTML;

assert(/Blue Medium/.test(listHtml), 'the list names each cube');
assert((listHtml.match(/data-tw-open-cube="c1"/g) || []).length === 2,
  'each cube exposes TWO triggers -- its picture and its name');
assert(/data-tw-open-cube=""/.test(listHtml), 'the "Cube not set" block is drillable too');
assert(!/Navy suit/.test(listHtml), 'an uncubed suit is still absent from "Cube not set"');
assert(/Chinos/.test(listHtml), 'but a genuinely unplaced garment is listed');

// --- drill into c1 ---
const click = target => ov.onclick({ target: { closest: sel => {
  const m = sel.match(/^\\[([a-z-]+)(?:="(.*)")?\\]$/);
  const attr = m[1], want = m[2];
  if (target.attr !== attr) return null;
  if (want !== undefined && target.val !== want) return null;
  return { getAttribute: () => target.val, dataset: {} };
} } });

photosPainted = 0;
click({ attr: 'data-tw-open-cube', val: 'c1' });
const detail = ov.innerHTML;
assert(/<h2[^>]*>Blue Medium/.test(detail), 'the drill-down is titled with the cube -> ' + (detail.match(/<h2[^>]*>([^<]*)/)||[])[1]);
assert(/Dress shirts/.test(detail), 'it lists the garment inside');
assert(/×3/.test(detail), 'and totals copies across tiers as x3');
assert(/data-tw-photo="photoA"/.test(detail), 'a real garment renders its PHOTO slot');
assert(photosPainted === 1, 'and the photo loader is invoked');
assert(/3 items/.test(detail), 'the header counts the items');
assert(!/Chinos/.test(detail), 'a garment in another cube is not shown');

// --- Close returns to the LIST, it does not shut the page ---
click({ attr: 'data-tw-cubes-close' });
assert(ov.style.display !== 'none', 'Close from a drill-down does not close the overlay');
assert(/data-tw-open-cube="c1"/.test(ov.innerHTML), 'it returns to the list of cubes');
// --- Close again from the list DOES shut it ---
click({ attr: 'data-tw-cubes-close' });
assert(ov.style.display === 'none', 'Close from the list closes the page');

// --- a photoless garment falls back to its glyph, and the unplaced pseudo-cube opens ---
showTripsyCubeContents(() => state, null);
ov.onclick && click({ attr: 'data-tw-open-cube', val: '' });
const orphanDetail = ov.innerHTML;
assert(/Cube not set/.test(orphanDetail), 'the unplaced pseudo-cube drills down');
assert(/Chinos/.test(orphanDetail) && !/Navy suit/.test(orphanDetail),
  'showing the unplaced chinos but not the uncubed suit');
assert(/tw-photo-glyph/.test(orphanDetail), 'a photoless garment falls back to a glyph');
`);
