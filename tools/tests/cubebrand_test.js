const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
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
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
// The selHtml under test is a local inside showTripsyCubeForm; lift it verbatim.
const m = html.match(/const selHtml = \(id, options, current, blank\) => \{[\s\S]*?\n    \};/);
if (!m) throw new Error('selHtml not found');

fs.writeFileSync('cubebrand_run.js', `
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
${extractConst('TRIPSY_CUBE_BRANDS')}
${extractConst('TRIPSY_CUBE_SIZES')}
${extractConst('TRIPSY_CUBE_COLORS')}
let driveData = { tripsyPackingCubes: [] };
${['tripsyCubeById','tripsyCubeName'].map(extractFn).join('\n')}
${m[0]}
const assert=(c,mm)=>{console.log((c?'ok   ':'FAIL ')+mm); if(!c) process.exitCode=1;};

assert(TRIPSY_CUBE_BRANDS.length === 3 && TRIPSY_CUBE_BRANDS.indexOf('Eagle Creek') < 0,
  'the bare "Eagle Creek" is gone, replaced by two lines');
assert(TRIPSY_CUBE_BRANDS.includes('Eagle Creek Reveal') && TRIPSY_CUBE_BRANDS.includes('Eagle Creek Pack-It'),
  'both Eagle Creek lines are offered');

// A NEW cube: blank selected, every brand offered, none pre-selected.
const fresh = selHtml('b', TRIPSY_CUBE_BRANDS, '', '—');
assert(/<option value=""selected|<option value="" selected/.test(fresh), 'a new cube starts on the blank option');
assert((fresh.match(/selected/g) || []).length === 1, 'and nothing else is selected');

// THE MIGRATION CASE: a cube saved under the old bare brand must still be selectable,
// or opening Edit and saving would silently blank it.
const legacy = selHtml('b', TRIPSY_CUBE_BRANDS, 'Eagle Creek', '—');
assert(legacy.includes('value="Eagle Creek" selected'), 'the legacy "Eagle Creek" value stays selected');
assert((legacy.match(/<option /g) || []).length === 5, 'it is appended, not swapped in -> blank + 3 + legacy');

// A current value that IS in the list is not duplicated.
const normal = selHtml('b', TRIPSY_CUBE_BRANDS, 'Eagle Creek Reveal', '—');
assert((normal.match(/<option /g) || []).length === 4, 'a known value adds no extra option');
assert(normal.includes('value="Eagle Creek Reveal" selected'), 'and is selected');

// Same protection covers size and colour, which share this helper.
const oldSize = selHtml('s', TRIPSY_CUBE_SIZES, 'Jumbo', '—');
assert(oldSize.includes('value="Jumbo" selected'), 'an unknown SIZE is preserved too');

// The label still appends the brand only to distinguish twins -- and the two Eagle Creek
// lines are now genuinely different brands, so twins are tellable apart.
driveData.tripsyPackingCubes = [
  { id: '1', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Reveal' },
  { id: '2', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Pack-It' },
  { id: '3', color: 'Black', size: 'Small', brand: 'Eagle Creek Reveal' },
];
assert(tripsyCubeName(driveData.tripsyPackingCubes[0]) === 'Blue Medium (Eagle Creek Reveal)', 'twin one names its line -> ' + tripsyCubeName(driveData.tripsyPackingCubes[0]));
assert(tripsyCubeName(driveData.tripsyPackingCubes[1]) === 'Blue Medium (Eagle Creek Pack-It)', 'twin two names its line');
assert(tripsyCubeName(driveData.tripsyPackingCubes[2]) === 'Black Small', 'an unambiguous cube stays short');
`);
