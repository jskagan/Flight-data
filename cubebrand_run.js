
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const TRIPSY_CUBE_BRANDS = ['Briggs & Riley', 'Eagle Creek Reveal', 'Eagle Creek Pack-It'];
const TRIPSY_CUBE_SIZES = ['Large', 'Medium', 'Small', 'Extra small'];
const TRIPSY_CUBE_COLORS = ['Black', 'Blue', 'Purple', 'Orange', 'Yellow', 'Gray', 'Brown', 'Zebra'];
let driveData = { tripsyPackingCubes: [] };
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
const selHtml = (id, options, current, blank) => {
      const opts = (current && options.indexOf(current) < 0) ? options.concat([current]) : options;
      return `<select id="${id}" class="btn"
      style="width:100%; font-size:15px; padding:9px; text-align:left; margin-bottom:12px;">
      <option value=""${current ? '' : ' selected'}>${esc(blank)}</option>
      ${opts.map(o => `<option value="${esc(o)}"${o === current ? ' selected' : ''}>${esc(o)}</option>`).join('')}
    </select>`;
    };
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
