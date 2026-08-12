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
// cubeLineHtml is a local inside the packing-status render; lift it verbatim.
const m = html.match(/    const cubeLineHtml = cubes => \{[\s\S]*?\n    \};/);
if (!m) throw new Error('cubeLineHtml not found');

fs.writeFileSync('cubechip_run.js', `
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let driveData = { tripsyPackingCubes: [] };
${extractConst('TRIPSY_CUBE_SIZES')}
${extractConst('TRIPSY_CUBE_COLORS')}
${extractConst('TRIPSY_CUBE_COLOR_CSS')}
${extractConst('TRIPSY_CUBE_NONE')}
${extractConst('TRIPSY_CUBE_FLIGHT_WORN')}
${['tripsyCubeById','tripsyCubeName','tripsyCubeTileHtml','tripsyCubeSlotLabel','tripsyCubeSlotGlyph'].map(extractFn).join('\n')}
${m[0].replace(/^    /gm, '')}
const assert=(c,mm)=>{console.log((c?'ok   ':'FAIL ')+mm); if(!c) process.exitCode=1;};

driveData.tripsyPackingCubes = [
  { id: 'c1', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Reveal', driveFileId: 'photoBlue' },
  { id: 'c2', color: 'Black', size: 'Small', brand: '' },  // no photo yet
  { id: 'c3', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Pack-It', driveFileId: 'photoBlue2' },
];

// A garment packed in a photographed cube: the picture rides along with the name, and
// the img carries the attribute tripsyPaintCubePhotos looks for.
let h = cubeLineHtml(['c1']);
assert(/Blue Medium \\(Eagle Creek Reveal\\)/.test(h), 'the cube NAME is shown -> ' + (h.match(/>([^<]*Blue[^<]*)</)||[])[1]);
assert(/data-tw-cube-photo="photoBlue"/.test(h), 'and its PICTURE is requested');

// Two copies in the same cube collapse to one chip with a count.
h = cubeLineHtml(['c1','c1']);
assert((h.match(/data-tw-cube-photo/g) || []).length === 1, 'two copies in one cube draw ONE picture');
assert(/x2/.test(h), 'with a x2 count');

// Copies split across cubes get a chip each, in the order encountered.
h = cubeLineHtml(['c1','c2']);
assert((h.match(/data-tw-cube-photo/g) || []).length === 1, 'the photographed cube draws its picture');
assert(/Black Small/.test(h), 'the unphotographed cube is still named');
assert(/background:#111/.test(h) || /background:/.test(h), 'and falls back to its colour swatch');

// An unknown/deleted cube has no picture to show -- plain glyph, never a broken image.
h = cubeLineHtml(['']);
assert(/cube not set/.test(h) && !/data-tw-cube-photo/.test(h), 'an unplaced copy shows the glyph, no picture');
h = cubeLineHtml(['zzz']);
assert(/cube not set/.test(h) && !/data-tw-cube-photo/.test(h), 'a DELETED cube degrades the same way');

// Mixed: one placed, two unknown.
h = cubeLineHtml(['c1','','']);
assert(/x2/.test(h) && /Blue Medium/.test(h), 'placed and unplaced copies both reported -> ' + h.replace(/<[^>]*>/g,'|'));

// Nothing packed -> nothing rendered at all (no empty row).
assert(cubeLineHtml([]) === '', 'an unpacked garment renders no cube line');
assert(cubeLineHtml(null) === '', 'and a missing array is safe');

// Twins stay distinguishable: same colour+size, different line, so the brand is appended.
h = cubeLineHtml(['c1','c3']);
assert(/Eagle Creek Reveal/.test(h) && /Eagle Creek Pack-It/.test(h), 'same-colour twins are told apart by line');
assert((h.match(/data-tw-cube-photo/g) || []).length === 2, 'each twin shows its own picture');
`);
