// "Why isn't the Loro Piana Traveler Jacket listed as a rain jacket" (2026-10-05):
// `light-jacket` (split out so a packable jacket goes in a cube) stopped matching the
// `jacket`-typed "rain jacket" need lines. Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  let depth = 0;
  for (let j = html.indexOf('{', html.indexOf(')', m.index)); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
const { fills, typeKey } = new Function(
  ['tripsyGarmentTypeKey', 'tripsyGarmentLineMatchType', 'tripsyWardrobeGarmentFillsLine'].map(extractFn).join('\n')
  + '\nfunction tripsyAttirePackingGroupOf(){ return "outerwear"; }\nfunction tripsyWardrobeLosesAccessoryLine(){ return false; }'
  + '\nreturn { fills: tripsyWardrobeGarmentFillsLine, typeKey: tripsyGarmentTypeKey };')();
const line = name => ({ name, group: 'outerwear', typeKey: typeKey(name) });
const traveler = { name: 'Tan Traveler Jacket', group: 'outerwear' };
assert(typeKey(traveler.name) === 'light-jacket', 'fixture: a traveler jacket still types as light-jacket (so it still packs in a cube)');
// A "rain jacket" line now types as light-jacket itself (packable outerwear, 2026-10-06);
// a plain "coat" line is still the hanging 'jacket' type -- the fold makes both match.
for (const [n, t] of [['rain jacket', 'light-jacket'], ['packable rain jacket', 'light-jacket'], ['warm coat', 'jacket']]) {
  const ln = line(n);
  assert(ln.typeKey === t && fills(traveler, ln, [ln]), `THE ASK: a light jacket is offered on a "${n}" line`);
}
const warm = line('warm packable jacket');
assert(warm.typeKey === 'light-jacket' && fills({ name: 'Navy Wool Overcoat', group: 'outerwear' }, warm, [warm]),
  'and the reverse: an ordinary (hanging) jacket fills a light-jacket-typed line');
assert(!fills(traveler, line('sport coat/blazer'), [line('sport coat/blazer')]), 'it still does not fill an unrelated typed line (blazer)');
const assign = extractFn('tripsyWardrobeAssignGarments');
assert(/tripsyGarmentLineMatchType\(ln\.typeKey\) === tripsyGarmentLineMatchType\(gType\)/.test(assign),
  'the packed-count assignment uses the same match, so a picked light jacket COUNTS toward the rain-jacket line');
