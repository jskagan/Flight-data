
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let driveData = { tripsyPackingCubes: [] };
const TRIPSY_CUBE_SIZES = ['Large', 'Medium', 'Small', 'Extra small'];
const TRIPSY_CUBE_COLORS = ['Black', 'Blue', 'Purple', 'Orange', 'Yellow', 'Gray', 'Brown', 'Zebra'];
const TRIPSY_CUBE_COLOR_CSS = {
  Black: '#23262B', Blue: '#2E62C8', Purple: '#7B4BC9', Orange: '#E07A28',
  Yellow: '#E3C22B', Gray: '#8A9099', Brown: '#7A5230',
  Zebra: 'repeating-linear-gradient(135deg,#F2F2F2 0 7px,#1B1B1B 7px 14px)',
};
const TRIPSY_CUBE_NONE = '__cube_none__';
const TRIPSY_CUBE_FLIGHT_WORN = '__cube_flight_worn__';
function tripsyCubeById(id) {
  if (!id) return null;
  return (driveData.tripsyPackingCubes || []).find(c => c.id === id) || null;
}
function tripsyCubeName(cube) {
  if (!cube) return '';
  const base = [cube.color, cube.size].filter(Boolean).join(' ');
  if (!base) return cube.name || 'Cube';
  const twins = (driveData.tripsyPackingCubes || [])
    .filter(c => c && (c.color || '') === (cube.color || '') && (c.size || '') === (cube.size || ''));
  if (twins.length <= 1 || !cube.brand) return base;
  const distinctBrands = new Set(twins.map(c => c.brand || ''));
  return distinctBrands.size > 1 ? `${base} (${cube.brand})` : base;
}
function tripsyCubeTileHtml(cube, { size = 74, selected = false } = {}) {
  // No photo yet -> fall back to the cube's own COLOUR as a swatch. That is still a
  // real identifier (it is one of the three traits), so an unphotographed cube stays
  // tellable apart in the grid instead of being one of N identical suitcase glyphs.
  const swatch = TRIPSY_CUBE_COLOR_CSS[cube.color] || 'var(--panel-2)';
  const inner = cube.driveFileId
    ? `<img data-tw-cube-photo="${esc(cube.driveFileId)}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;">`
    : `<div style="width:100%; height:100%; background:${swatch};"></div>`;
  return `<div style="width:${size}px; height:${size}px; border-radius:10px; overflow:hidden; background:var(--panel-2);
    border:${selected ? '3px solid var(--amber)' : '1px solid var(--line)'}; flex-shrink:0;">${inner}</div>`;
}
function tripsyCubeSlotLabel(cid) {
  if (cid === TRIPSY_CUBE_FLIGHT_WORN) return 'Wearing on the flight';
  if (cid === TRIPSY_CUBE_NONE) return 'No cube';
  const cube = tripsyCubeById(cid);
  return cube ? tripsyCubeName(cube) : '';
}
function tripsyCubeSlotGlyph(cid) {
  if (cid === TRIPSY_CUBE_FLIGHT_WORN) return '&#9992;&#65039;';
  if (cid === TRIPSY_CUBE_NONE) return '&#128092;';
  return '&#129523;';
}
const cubeLineHtml = cubes => {
  const filled = (cubes || []).filter(Boolean);
  const unknown = (cubes || []).length - filled.length;
  const counts = new Map();
  for (const cid of filled) counts.set(cid, (counts.get(cid) || 0) + 1);
  const chip = (inner, label, n) => `<span style="display:inline-flex; align-items:center; gap:5px; min-width:0; max-width:100%;">${inner}<span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(label)}${n > 1 ? ` x${n}` : ''}</span></span>`;
  const parts = [...counts].map(([cid, n]) => {
    const cube = tripsyCubeById(cid);
    const label = tripsyCubeSlotLabel(cid) || 'cube not set';
    const pic = cube ? tripsyCubeTileHtml(cube, { size: 26 }) : `<span>${tripsyCubeSlotGlyph(cid)}</span>`;
    return chip(pic, label, n);
  });
  if (unknown > 0) parts.push(chip('<span>&#129523;</span>', 'cube not set', unknown));
  if (!parts.length) return '';
  return `<div class="tw-meta" style="color:var(--muted); display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px;">${parts.join('')}</div>`;
};
const assert=(c,mm)=>{console.log((c?'ok   ':'FAIL ')+mm); if(!c) process.exitCode=1;};

driveData.tripsyPackingCubes = [
  { id: 'c1', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Reveal', driveFileId: 'photoBlue' },
  { id: 'c2', color: 'Black', size: 'Small', brand: '' },  // no photo yet
  { id: 'c3', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Pack-It', driveFileId: 'photoBlue2' },
];

// A garment packed in a photographed cube: the picture rides along with the name, and
// the img carries the attribute tripsyPaintCubePhotos looks for.
let h = cubeLineHtml(['c1']);
assert(/Blue Medium \(Eagle Creek Reveal\)/.test(h), 'the cube NAME is shown -> ' + (h.match(/>([^<]*Blue[^<]*)</)||[])[1]);
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
