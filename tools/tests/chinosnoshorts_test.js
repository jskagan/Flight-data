// "Do not include shorts as potential garments for chinos" / "Do not use jeans or
// trousers as shorts" (2026-10-05).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  if (!m) throw new Error('missing ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', html.indexOf(')', m.index)); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const { fills } = new Function(
  [extractFn('tripsyGarmentTypeKey'), extractFn('tripsyWardrobeGarmentFillsLine')].join('\n')
  + '\nfunction tripsyAttirePackingGroupOf(){ return "pants"; }\nfunction tripsyWardrobeLosesAccessoryLine(){ return false; }'
  + '\nreturn { fills: tripsyWardrobeGarmentFillsLine };')();

const line = name => ({ name, group: 'pants', typeKey: '' });
const g = name => ({ name, group: 'pants' });
const chinos = line('Chinos');
const lines = [chinos];
assert(!fills(g('Navy Swim Shorts'), chinos, lines) && !fills(g('Khaki Chino Shorts'), chinos, lines),
  'THE ASK: shorts (swim shorts included) are never offered on a chinos line');
assert(!fills(g('Linen Shorts'), line('trousers/chinos'), [line('trousers/chinos')])
  && !fills(g('Linen Shorts'), line('Jeans'), [line('Jeans')]),
  'nor on a trousers/chinos or jeans line');
assert(fills(g('Stone Chinos'), chinos, lines) && fills(g('Dark Jeans'), chinos, lines),
  'long trousers and jeans still fill a chinos line (mix-and-match substitution kept)');
assert(fills(g('Linen Shorts'), line('Shorts'), [line('Shorts')]) && fills(g('Linen Shorts'), line('bottoms'), [line('bottoms')]),
  'a shorts line, or a generic bottoms line, still offers shorts');
assert(!fills(g('Stone Chinos'), line('Shorts'), [line('Shorts')]) && !fills(g('Dark Jeans'), line('Shorts'), [line('Shorts')]),
  'THE ASK (reverse): jeans and trousers are never offered on a shorts line');
assert(fills(g('Dark Jeans'), line('bottoms'), [line('bottoms')]), 'a generic bottoms line still offers jeans');
