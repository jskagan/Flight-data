
let driveData = { tripsyPackingCubes: [ {id:'c1', color:'Blue', size:'Medium', brand:'Eagle Creek'}, {id:'c2', color:'Black', size:'Small', brand:'Briggs & Riley'} ] };
const TRIPSY_CUBE_BRANDS = ['Briggs & Riley', 'Eagle Creek Reveal', 'Eagle Creek Pack-It'];
const TRIPSY_CUBE_SIZES = ['Large', 'Medium', 'Small', 'Extra small'];
const TRIPSY_CUBE_COLORS = ['Black', 'Blue', 'Purple', 'Orange', 'Yellow', 'Gray', 'Brown', 'Zebra'];
const TRIPSY_CUBE_NONE = '__cube_none__';
const TRIPSY_CUBE_FLIGHT_WORN = '__cube_flight_worn__';
const TRIPSY_FLIGHT_WORN_SUFFIX = ' — wearing on the flight';
function tripsyWardrobeLineIsFlightWorn(name) { return String(name || '').endsWith(TRIPSY_FLIGHT_WORN_SUFFIX); }
function tripsyWardrobeFlightWornEntry(entry) {
  if (!entry || !tripsyWardrobeLineIsFlightWorn(entry.line)) return entry;
  const qty = Math.max(1, entry.qty || 1);
  return { ...entry, qty, packed: qty, cubes: Array.from({ length: qty }, () => TRIPSY_CUBE_FLIGHT_WORN) };
}
function tripsyCubesForEntry(entry, packed) {
  const raw = (entry && Array.isArray(entry.cubes)) ? entry.cubes : [];
  const out = [];
  for (let i = 0; i < packed; i++) out.push(typeof raw[i] === 'string' ? raw[i] : '');
  return out;
}
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
function tripsyCubeLabel(id) {
  return tripsyCubeSlotLabel(id);
}
function tripsyCubesSorted() {
  const sizeIdx = c => { const i = TRIPSY_CUBE_SIZES.indexOf(c.size); return i < 0 ? TRIPSY_CUBE_SIZES.length : i; };
  const colorIdx = c => { const i = TRIPSY_CUBE_COLORS.indexOf(c.color); return i < 0 ? TRIPSY_CUBE_COLORS.length : i; };
  return [...(driveData.tripsyPackingCubes || [])]
    .sort((a, b) => sizeIdx(a) - sizeIdx(b) || colorIdx(a) - colorIdx(b) || (a.brand || '').localeCompare(b.brand || ''));
}
function tripsyNormalizeTripSelection(arr) {
  return (arr || []).map(e => {
    if (typeof e === 'string') return { id: e, category: '', line: '', qty: 1, packed: 0, cubes: [] };
    const qty = Math.max(1, e.qty || 1);
    // `category` is the dress-code tier this allocation is for. Legacy entries (from
    // before per-category selection) have '' and are treated as unrecognized by the
    // per-category screens (the owner re-picks). See tripsyWardrobePackForTrip.
    // `line` is the NEED LINE within that tier (its name, not its index -- indices
    // shift whenever the guide is regenerated). '' means an entry saved before
    // per-line allocation; tripsyWardrobeResolveSelectionLines stamps one on.
    const packed = Math.max(0, Math.min(qty, e.packed || 0));
    // `cubes` is PER COPY: cubes[i] is the packing cube copy i went into, '' for a copy
    // that is packed but whose cube isn't known (an entry packed before cubes existed,
    // or one whose cube was later deleted). Length is always exactly `packed`, so
    // "how many are packed" and "where each one is" can never disagree -- see
    // tripsyCubesForEntry, which is the only place this is derived.
    const entry = { id: e.id, category: e.category || '', line: e.line || '', qty, packed, cubes: tripsyCubesForEntry(e, packed) };
    return tripsyWardrobeLineIsFlightWorn(entry.line) ? tripsyWardrobeFlightWornEntry(entry) : entry;
  }).filter(e => e.id);
}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

// The contract: cubes[] is ALWAYS exactly `packed` long, so the count and the
// locations can never disagree no matter what is in the stored data.
assert(tripsyCubesForEntry({cubes:['c1','c2']}, 2).length === 2, 'exact match passes through');
assert(JSON.stringify(tripsyCubesForEntry({cubes:['c1','c2','c1']}, 2)) === JSON.stringify(['c1','c2']),
  'a list LONGER than packed is truncated (copies were un-packed)');
assert(JSON.stringify(tripsyCubesForEntry({cubes:['c1']}, 3)) === JSON.stringify(['c1','','']),
  'a list SHORTER than packed pads with unknown, never drops the count');
assert(JSON.stringify(tripsyCubesForEntry({}, 2)) === JSON.stringify(['','']),
  'packed before cubes existed -> unknown locations, still packed');
assert(tripsyCubesForEntry({cubes:['c1']}, 0).length === 0, 'nothing packed -> no slots');

// Normalisation of a whole selection entry.
const norm = tripsyNormalizeTripSelection([{ id:'g1', category:'formal', line:'shirts', qty:3, packed:2, cubes:['c1','c2'] }]);
assert(norm[0].packed === 2 && norm[0].cubes.length === 2, 'entry keeps packed + per-copy cubes');
const legacy = tripsyNormalizeTripSelection([{ id:'g1', category:'formal', line:'shirts', qty:2, packed:2 }]);
assert(JSON.stringify(legacy[0].cubes) === JSON.stringify(['','']), 'legacy entry: packed, locations unknown');
const strEntry = tripsyNormalizeTripSelection(['g9']);
assert(strEntry[0].packed === 0 && strEntry[0].cubes.length === 0, 'oldest string-only entry still normalises');

// A DELETED cube degrades to "not set" rather than showing a dangling id.
assert(tripsyCubeLabel('c1') === 'Blue Medium', 'label is colour + size, brand omitted when unambiguous');
assert(tripsyCubeLabel('gone') === '', 'deleted cube resolves to empty, so the UI says "cube not set"');
assert(tripsyCubeLabel('') === '', 'unknown slot resolves to empty');

// The picker's compaction rule: filled slots lead, packed == filled count.
const applyCubes = (target, picked) => {
  const filled = picked.filter(Boolean);
  target.cubes = filled;
  target.packed = Math.max(0, Math.min(target.qty, filled.length));
};
let t = { qty: 3, packed: 0, cubes: [] };
applyCubes(t, ['c1', '', 'c2']);
assert(t.packed === 2 && JSON.stringify(t.cubes) === JSON.stringify(['c1','c2']),
  'gaps compact away: 2 packed, both located');
applyCubes(t, ['', '', '']);
assert(t.packed === 0 && t.cubes.length === 0, 'clearing every slot unpacks the garment');

// BRAND only appears when it is doing work -- i.e. two cubes share colour + size.
driveData.tripsyPackingCubes.push({ id:'c3', color:'Blue', size:'Medium', brand:'Briggs & Riley' });
assert(tripsyCubeLabel('c1') === 'Blue Medium (Eagle Creek)', 'twins get their brand appended -> ' + tripsyCubeLabel('c1'));
assert(tripsyCubeLabel('c3') === 'Blue Medium (Briggs & Riley)', 'the other twin too');
assert(tripsyCubeLabel('c2') === 'Black Small', 'an unambiguous cube is left short');
driveData.tripsyPackingCubes.pop();

// A cube saved before the three-trait shape still reads sanely.
driveData.tripsyPackingCubes.push({ id:'old', name:'Shirts cube' });
assert(tripsyCubeLabel('old') === 'Shirts cube', 'legacy named cube falls back to its name');
driveData.tripsyPackingCubes.pop();

// Sort order is stable and biggest-first, so the grid does not reshuffle.
driveData.tripsyPackingCubes.push({ id:'c4', color:'Yellow', size:'Large' });
const order = tripsyCubesSorted().map(c => tripsyCubeName(c));
assert(order[0] === 'Yellow Large', 'largest sorts first -> ' + order.join(' | '));
assert(order.indexOf('Blue Medium') < order.indexOf('Black Small'), 'medium before small');
driveData.tripsyPackingCubes.pop();
