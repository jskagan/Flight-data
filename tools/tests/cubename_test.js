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
fs.writeFileSync('cubename_run.js', `
let driveData = { tripsyPackingCubes: [] };
${['tripsyCubeById','tripsyCubeName','tripsyCubeLabel'].map(extractFn).join('\n')}
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
`);
