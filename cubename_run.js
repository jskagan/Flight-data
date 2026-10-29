
let driveData = { tripsyPackingCubes: [] };
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
function tripsyCubeLabel(id) {
  return tripsyCubeSlotLabel(id);
}
function tripsyCubeSlotLabel(cid) {
  if (cid === TRIPSY_CUBE_FLIGHT_WORN) return 'Wearing on the flight';
  if (cid === TRIPSY_CUBE_NONE) return 'No cube';
  const cube = tripsyCubeById(cid);
  return cube ? tripsyCubeName(cube) : '';
}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
const set = (...cubes) => { driveData.tripsyPackingCubes = cubes; };
const name = id => tripsyCubeLabel(id);

// TWO CUBES SHARING COLOUR+SIZE: BOTH must name their brand. Naming only one would leave
// the other reading as "the" Blue Medium.
set({ id:'a', color:'Blue', size:'Medium', brand:'Eagle Creek Reveal' },
    { id:'b', color:'Blue', size:'Medium', brand:'Eagle Creek Pack-It' });
assert(name('a') === 'Blue Medium (Eagle Creek Reveal)', 'twin A names its brand -> ' + name('a'));
assert(name('b') === 'Blue Medium (Eagle Creek Pack-It)', 'twin B names its brand -> ' + name('b'));

// THREE sharing colour+size, two of them the same brand: still ambiguous overall, so
// every one that HAS a brand says it.
set({ id:'a', color:'Blue', size:'Medium', brand:'Eagle Creek Reveal' },
    { id:'b', color:'Blue', size:'Medium', brand:'Eagle Creek Reveal' },
    { id:'c', color:'Blue', size:'Medium', brand:'Briggs & Riley' });
assert(name('a') === 'Blue Medium (Eagle Creek Reveal)', 'one of the matching pair still names its brand');
assert(name('c') === 'Blue Medium (Briggs & Riley)', 'and so does the odd one out');

// THE EXCEPTION: same colour, same size, SAME brand -> the brand distinguishes nothing,
// so it is noise on every label and is left off.
set({ id:'a', color:'Yellow', size:'Large', brand:'Briggs & Riley' },
    { id:'b', color:'Yellow', size:'Large', brand:'Briggs & Riley' });
assert(name('a') === 'Yellow Large', 'identical brands add nothing, so neither shows it -> ' + name('a'));
assert(name('b') === 'Yellow Large', 'both stay bare');

// A LONE cube never carries its brand, however distinctive.
set({ id:'a', color:'Black', size:'Small', brand:'Eagle Creek Pack-It' },
    { id:'b', color:'Blue', size:'Small', brand:'Briggs & Riley' });
assert(name('a') === 'Black Small', 'an unambiguous cube stays short');

// Different SIZE, same colour -> not twins.
set({ id:'a', color:'Blue', size:'Medium', brand:'Eagle Creek Reveal' },
    { id:'b', color:'Blue', size:'Small', brand:'Briggs & Riley' });
assert(name('a') === 'Blue Medium', 'same colour but a different size is not a twin');

// A twin with NO brand recorded has nothing to append; its partner still names its own.
set({ id:'a', color:'Gray', size:'Medium', brand:'Eagle Creek Reveal' },
    { id:'b', color:'Gray', size:'Medium', brand:'' });
assert(name('a') === 'Gray Medium (Eagle Creek Reveal)', 'the branded twin says which it is');
assert(name('b') === 'Gray Medium', 'the unbranded one shows the bare base, not "(undefined)" -> ' + name('b'));

// Legacy/degenerate records still resolve rather than throwing.
set({ id:'a', name:'Old cube' });
assert(name('a') === 'Old cube', 'a pre-traits cube falls back to its stored name');
assert(tripsyCubeName(null) === '', 'no cube -> empty string');
assert(name('missing') === '', 'a deleted id -> empty string');
