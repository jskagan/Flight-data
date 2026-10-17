// "Why doesn't the app show which clothes are in which packing cubes? I set that when I
// packed" (2026-10-17). Cube assignments live on the per-trip selection entries (`cubes`,
// per copy), and every writer of that array replaces it WHOLE -- the Packing List's save
// (and the category drill-down's embedded pack panel) wrote `packed` back but not `cubes`,
// so one pick on either page erased every assignment made on Packing Status, leaving each
// packed copy reading "cube not set". Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const api = new Function([fnSource('tripsyCubesForEntry'), fnSource('tripsyNormalizeTripSelection'), fnSource('tripsyWardrobeCarryCubes'),
  'return { carry: tripsyWardrobeCarryCubes, normalize: tripsyNormalizeTripSelection };'].join('\n'))();

// ---- the carry helper ----
{
  const out = api.carry({ id: 'g1', category: 'casual', line: 'Tops', qty: 3, packed: 2 }, ['c1', 'c2']);
  assert(out.cubes.join(',') === 'c1,c2' && out.packed === 2 && out.qty === 3, 'THE ASK: the loaded cube ids ride along with the entry unchanged');
  const trimmed = api.carry({ id: 'g1', category: 'casual', line: 'Tops', qty: 1, packed: 1 }, ['c1', 'c2']);
  assert(trimmed.cubes.join(',') === 'c1', 'a copy no longer packed (qty reduced) drops its slot; the rest keep theirs');
  const none = api.carry({ id: 'g1', category: 'casual', line: 'Tops', qty: 2, packed: 1 }, undefined);
  assert(Array.isArray(none.cubes) && none.cubes.length === 0 && none.packed === 1, 'no known cubes writes an empty list (normalisation pads it to "cube not set"), never throws');
  const compact = api.carry({ id: 'g1', category: 'casual', line: 'Tops', qty: 3, packed: 2 }, ['', 'c2', 'c3']);
  assert(compact.cubes.join(',') === 'c2,c3', 'filled slots lead, as the stored shape requires');
  const sentinel = api.carry({ id: 'g1', category: 'casual', line: 'Tops', qty: 1, packed: 1 }, ['__cube_none__']);
  assert(sentinel.cubes[0] === '__cube_none__', 'the "No cube" / "Wear on flight" choices are kept like any cube id');
  const over = api.carry({ id: 'g1', category: 'casual', line: 'Tops', qty: 2, packed: 5 }, ['c1', 'c2', 'c3']);
  assert(over.packed === 2 && over.cubes.join(',') === 'c1,c2', 'packed is clamped to qty and the cubes with it');
}
// ---- round trip: load (normalise) -> save (carry) -> load again keeps every cube ----
{
  const stored = [{ id: 'g1', category: 'casual', line: 'Tops', qty: 2, packed: 2, cubes: ['c1', 'c2'] }, { id: 'g2', category: 'formal', line: 'Suits', qty: 1, packed: 1, cubes: ['__cube_flight_worn__'] }];
  const loaded = api.normalize(stored);
  const saved = loaded.map(e => api.carry({ id: e.id, category: e.category, line: e.line, qty: e.qty, packed: e.packed }, e.cubes));
  const again = api.normalize(saved);
  assert(JSON.stringify(again) === JSON.stringify(loaded), 'a Packing List save that touches nothing else leaves every cube assignment exactly as loaded');
}
// ---- the two writers that used to drop cubes now carry them ----
{
  const plan = fnSource('tripsyWardrobePackForTrip');
  assert(/const cubesByKey = new Map\(\);/.test(plan) && /cubesByKey\.set\(k, e\.cubes \|\| \[\]\);/.test(plan), 'the Packing List loads each entry\'s cubes beside its packed count');
  assert(/const persistChosen = \(\) => Store\.setTripWardrobe\(tripKey, \[\.\.\.sel\]\.map\(\(\[k, qty\]\) => \{[^\n]*tripsyWardrobeCarryCubes\(\{ id, category, line, qty, packed: Math\.min\(qty, packedByKey\.get\(k\) \|\| 0\) \}, cubesByKey\.get\(k\)\)/.test(plan),
    'THE FIX: the Packing List\'s save writes the cubes back through the carry helper');
  assert((plan.match(/packedByKey\.delete\((k|key)\); cubesByKey\.delete\(\1\);/g) || []).length === 2, 'a deselect on the Packing List drops the cube entry together with the packed count');
  const drill = fnSource('showTripsyAttireCategoryEvents');
  assert(/cubesByKey\.set\(k, e\.cubes \|\| \[\]\);/.test(drill) && /tripsyWardrobeCarryCubes\(\{ id, category: c, line, qty, packed: Math\.min\(qty, packedByKey\.get\(k\) \|\| 0\) \}, cubesByKey\.get\(k\)\)/.test(drill),
    'the category drill-down\'s embedded pack panel carries cubes the same way');
  assert((drill.match(/packedByKey\.delete\((k|key)\); cubesByKey\.delete\(\1\);/g) || []).length === 2, 'and its deselects drop the cube entry too');
  // Every setTripWardrobe writer names `cubes` -- a new one that forgets is the bug again.
  const writers = [...html.matchAll(/Store\.setTripWardrobe\([^\n]*/g)].map(m => m[0]).filter(l => !/async setTripWardrobe/.test(l));
  assert(writers.length >= 4 && writers.every(l => /cubes|tripsyWardrobeCarryCubes/.test(l)), `every Store.setTripWardrobe call site carries cubes (${writers.length} sites)`);
}
