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
  if (start < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const consts = ['TRIPSY_CUBE_BRANDS','TRIPSY_CUBE_SIZES','TRIPSY_CUBE_COLORS'].map(extractConst).join('\n');
const src = consts + '\n' + ['tripsyCubesForEntry', 'tripsyCubeById', 'tripsyCubeName', 'tripsyCubeLabel', 'tripsyCubesSorted', 'tripsyNormalizeTripSelection'].map(extractFn).join('\n');
fs.writeFileSync('cubes_run.js', `
let driveData = { tripsyPackingCubes: [ {id:'c1', color:'Blue', size:'Medium', brand:'Eagle Creek'}, {id:'c2', color:'Black', size:'Small', brand:'Briggs & Riley'} ] };
${src}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

// The contract: cubes[] is ALWAYS exactly \`packed\` long, so the count and the
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
`);
