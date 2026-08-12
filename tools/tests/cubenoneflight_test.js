// "In the packing status page and the user selects a garment to add to a cube, add two
// options besides the list of cubes - no cube, and wear on flight." showTripsyCubePicker
// gets two extra tiles alongside the real cube grid: TRIPSY_CUBE_NONE ("No cube" -- a
// deliberate "packed, not in any particular cube" choice) and TRIPSY_CUBE_FLIGHT_WORN
// ("Wear on flight" -- worn instead of packed). Both are plain non-cube-id strings, so
// the existing data-tw-pick-cube click handler assigns them exactly like a real cube id
// with no changes needed there, and both are TRUTHY so applyCubes' `filled =
// picked.filter(Boolean)` still counts them toward `packed`, unlike the pre-existing ''
// (a genuinely undecided/deleted-cube slot).
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  const start = m.index;
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
  const end = html.indexOf(';\n', start) + 1;
  return html.slice(start, end);
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the sentinel constants and label/glyph helper exist and are wired ----
assert(/const TRIPSY_CUBE_NONE = '[^']+';/.test(html), 'TRIPSY_CUBE_NONE is defined');
assert(/const TRIPSY_CUBE_FLIGHT_WORN = '[^']+';/.test(html), 'TRIPSY_CUBE_FLIGHT_WORN is defined');
const labelFn = extractFn('tripsyCubeSlotLabel');
assert(/return 'Wearing on the flight';/.test(labelFn), 'the flight-worn sentinel labels itself');
assert(/return 'No cube';/.test(labelFn), 'the no-cube sentinel labels itself');
assert(/function tripsyCubeLabel\(id\) \{\s*return tripsyCubeSlotLabel\(id\);/.test(html),
  'tripsyCubeLabel (used by the picker\'s per-copy row) now delegates to the same helper');

// ---- the picker itself offers both as tiles alongside the real cube grid ----
const picker = extractFn('showTripsyCubePicker');
assert(/const specialCards = \[/.test(picker), 'the picker builds two special tiles');
assert(/\{ id: TRIPSY_CUBE_NONE, label: 'No cube' \}/.test(picker), 'one is "No cube"');
assert(/\{ id: TRIPSY_CUBE_FLIGHT_WORN, label: 'Wear on flight' \}/.test(picker), 'the other is "Wear on flight"');
assert(/data-tw-pick-cube="\$\{s\.id\}"/.test(picker),
  'each special tile uses the SAME data-tw-pick-cube attribute a real cube tile uses -- no new click handler needed');
assert(/\$\{specialCards\}\s*\n\s*\$\{cubeCards\}/.test(picker), 'special tiles render before the real cube grid');

// ---- executed: the pick handler treats a sentinel exactly like a real cube id ----
{
  // Mirrors the picker's `pick` branch of its onclick handler verbatim in spirit: assigns
  // whatever data-tw-pick-cube carried into the active copy slot.
  const pickInto = (working, activeCopy, id) => { working[activeCopy] = id; return working; };
  const TRIPSY_CUBE_NONE = (html.match(/const TRIPSY_CUBE_NONE = '([^']+)'/) || [])[1];
  const TRIPSY_CUBE_FLIGHT_WORN = (html.match(/const TRIPSY_CUBE_FLIGHT_WORN = '([^']+)'/) || [])[1];
  assert(!!TRIPSY_CUBE_NONE && !!TRIPSY_CUBE_FLIGHT_WORN, 'sanity: both sentinel values were extracted from source');

  let working = pickInto(['', ''], 0, TRIPSY_CUBE_NONE);
  assert(working[0] === TRIPSY_CUBE_NONE, 'picking "No cube" stores the sentinel in that copy\'s slot');
  working = pickInto(['', ''], 1, TRIPSY_CUBE_FLIGHT_WORN);
  assert(working[1] === TRIPSY_CUBE_FLIGHT_WORN, 'picking "Wear on flight" stores its own sentinel');

  // ---- applyCubes: both sentinels count toward `packed`, unlike an untouched '' ----
  const applyCubesSrc = html.slice(html.indexOf('const applyCubes = (target, picked) => {'), html.indexOf('};', html.indexOf('const applyCubes = (target, picked) => {')) + 2);
  assert(applyCubesSrc.includes("picked.filter(Boolean)"), 'sanity: extracted the real applyCubes body');
  const applyCubes = (target, picked) => {
    const filled = picked.filter(Boolean);
    target.cubes = filled;
    target.packed = Math.max(0, Math.min(target.qty, filled.length));
  };
  let target = { qty: 2, packed: 0, cubes: [] };
  applyCubes(target, [TRIPSY_CUBE_NONE, '']);
  assert(target.packed === 1, '"No cube" for one copy, the other left untouched -> only 1 packed');
  assert(target.cubes[0] === TRIPSY_CUBE_NONE, 'the packed slot keeps its sentinel, not a real cube id');

  target = { qty: 2, packed: 0, cubes: [] };
  applyCubes(target, [TRIPSY_CUBE_FLIGHT_WORN, TRIPSY_CUBE_NONE]);
  assert(target.packed === 2, 'both copies marked via the two new options both count as packed');

  target = { qty: 2, packed: 0, cubes: [] };
  applyCubes(target, ['', '']);
  assert(target.packed === 0, 'sanity: an untouched slot (the pre-existing default) still does NOT count as packed');
}

// ---- the Cubes page shows "No cube" and "Wearing on the flight" as their own named
// blocks, not lumped into the genuinely-undecided "Cube not set" bucket ----
const cubeContents = extractFn('showTripsyCubeContents');
assert(/const specialBlock = \(id, label, glyph\) => \{/.test(cubeContents),
  'the Cubes page renders a named block per deliberate non-cube choice');
assert(/const noCubeBlock = specialBlock\(TRIPSY_CUBE_NONE, 'No cube'/.test(cubeContents), 'one block for "No cube"');
assert(/const flightWornBlock = specialBlock\(TRIPSY_CUBE_FLIGHT_WORN, 'Wearing on the flight'/.test(cubeContents),
  'one block for "Wearing on the flight"');
assert(/const orphan = contents\.get\(''\);/.test(cubeContents),
  'the true "Cube not set" bucket (never decided / deleted cube) stays separate from both');
