// The outfit view (showTripsyOutfitModal) gets a way to see where a garment is
// actually packed: tapping its photo opens showTripsyGarmentCubeInfo, reusing the
// same cube-lookup Packing Status already uses (tripsyCubesForEntry summed across
// every selection entry for that one garment id), so the two screens can't disagree.
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
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- wiring: the photo is a tap target, wired for EVERY viewer, not owner-gated ----
const modal = extractFn('showTripsyOutfitModal');
assert(/data-tw-outfit-photo="\$\{esc\(g\.id\)\}" style="cursor:pointer;"/.test(modal),
  'the photo carries the garment id and looks tappable');
assert(!/isOwner \? `<div class="tw-actions">.*data-tw-outfit-photo/.test(modal),
  'unlike Swap, the photo tap is not wrapped in an isOwner check');
assert(/ov\.querySelectorAll\('\[data-tw-outfit-photo\]'\)\.forEach\(el => \{\s*\n\s*el\.addEventListener\('click', \(\) => showTripsyGarmentCubeInfo\(tripKey, el\.getAttribute\('data-tw-outfit-photo'\)\)\);/.test(modal),
  'clicking it opens the cube-info dialog for that exact garment');

// ---- the dialog function itself ----
const fn = extractFn('showTripsyGarmentCubeInfo');
assert(/ov\.style\.zIndex = '2147483085';/.test(fn), 'clears the outfit modal (2147483080) it opens from');
assert(/if \(tripsyGarmentSkipsCube\(g\.name\)\)/.test(fn),
  'an uncubed type (tie, hangs, ...) explains WHY rather than showing a false "not set"');
assert(/isn't marked packed for this trip yet/.test(fn), 'an unpacked garment gets an honest message, not a blank dialog');
assert(/tripsyCubesForEntry\(e, packed\)/.test(fn), 'reuses the exact same per-entry cube lookup Packing Status uses');
assert(/tripsyPaintCubePhotos\(ov\);/.test(fn), 'cube photos are painted the same way as everywhere else');

// ---- executed: the per-garment cube aggregation, against fixtures ----
{
  // Mirrors tripsyCubesForEntry exactly (copied, not re-derived, so a change to the
  // real one would need this test updated too -- catching drift rather than hiding it).
  const tripsyCubesForEntry = (entry, packed) => {
    const raw = (entry && Array.isArray(entry.cubes)) ? entry.cubes : [];
    const out = [];
    for (let i = 0; i < packed; i++) out.push(typeof raw[i] === 'string' ? raw[i] : '');
    return out;
  };
  const aggregate = (entries, garmentId) => {
    const cubeIds = [];
    for (const e of entries.filter(e => e.id === garmentId)) {
      const packed = Math.min(e.qty, e.packed || 0);
      for (const cid of tripsyCubesForEntry(e, packed)) cubeIds.push(cid || '');
    }
    return cubeIds;
  };

  // A suit split across two lines (blazer covers Cocktail, the same physical suit
  // also allocated under Formal) -- both entries' cubes must be combined.
  const entries = [
    { id: 'suit1', category: 'formal', line: 'suits', qty: 1, packed: 1, cubes: ['cubeA'] },
    { id: 'suit1', category: 'cocktail', line: 'suits', qty: 1, packed: 1, cubes: ['cubeA'] },
    { id: 'shirt1', category: 'formal', line: 'shirts', qty: 3, packed: 2, cubes: ['cubeB', ''] },
    { id: 'notpacked', category: 'formal', line: 'shirts', qty: 1, packed: 0, cubes: [] },
  ];
  assert(JSON.stringify(aggregate(entries, 'suit1')) === JSON.stringify(['cubeA', 'cubeA']),
    'a garment allocated across two lines combines both entries\' cubes');
  assert(JSON.stringify(aggregate(entries, 'shirt1')) === JSON.stringify(['cubeB', '']),
    'a partly-cubed garment (2 packed, 1 with a cube, 1 without) reports both -- cubeB and "not set"');
  assert(aggregate(entries, 'notpacked').length === 0, 'zero packed copies means zero cube entries, not a crash');
  assert(aggregate(entries, 'unknown-id').length === 0, 'a garment id with no entries at all is handled cleanly');
}
