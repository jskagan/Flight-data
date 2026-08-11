const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
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
fs.writeFileSync('cufflinks_group_run.js', `
${extractConst('TRIPSY_GARMENT_TYPE_GLYPH')}
${extractConst('TRIPSY_ATTIRE_GROUP_GLYPH')}
${extractConst('TRIPSY_GARMENT_TYPE_LABEL')}
${extractConst('TRIPSY_GARMENT_TYPE_ORDER')}
${['tripsyGarmentTypeKey','tripsyAttirePackingGroupOf','tripsyGarmentGlyph'].map(extractFn).join('\n')}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// Guard against the mistake this file already made once: tripsyAttirePackingGroupOf takes
// an ITEM OBJECT, so passing a bare string reads item.name as undefined and EVERY call
// returns the 'accessories' default -- making every assertion below silently vacuous.
assert(tripsyAttirePackingGroupOf({ name: 'Loafers' }) !== tripsyAttirePackingGroupOf('Loafers'),
  'the helper is being called with an item object, not a string');
// CLAUDE.md's rule: tripsyAttirePackingGroupOf must AGREE with tripsyGarmentTypeKey.
// Typing cufflinks must not move them out of the accessories group.
for (const n of ['Cufflinks','Cuff links','Gold cufflink']) {
  assert(tripsyAttirePackingGroupOf({ name: n }) === 'accessories', n + ' stays in the accessories group');
}
// The glyph must not regress: it was 💎 via the NAME fallback, and the new typeKey
// entry has to produce the same thing (the typeKey branch is checked FIRST).
assert(tripsyGarmentGlyph(tripsyGarmentTypeKey('Cufflinks'), 'accessories', 'Cufflinks') === '💎',
  'cufflinks still render the gem glyph');
// A generic line carrying the typeKey but a vague name also gets the gem now.
assert(tripsyGarmentGlyph('cufflinks', 'accessories', '') === '💎', 'typeKey alone is enough for the glyph');
// The bucket label is a real word, not the raw key.
assert(TRIPSY_GARMENT_TYPE_LABEL['cufflinks'] === 'Cufflinks', 'the type has a display label');
assert(TRIPSY_GARMENT_TYPE_ORDER.includes('cufflinks'), 'and a place in the display order');
// Sunglasses: same contract -- typed for the cube rule only, group and glyph unchanged.
assert(tripsyAttirePackingGroupOf({ name: 'Sunglasses' }) === 'accessories', 'sunglasses stay in the accessories group');
assert(tripsyGarmentGlyph(tripsyGarmentTypeKey('Sunglasses'), 'accessories', 'Sunglasses') === '\u{1F576}\u{FE0F}',
  'sunglasses still render the shades glyph');
assert(TRIPSY_GARMENT_TYPE_LABEL['sunglasses'] === 'Sunglasses', 'sunglasses have a display label');
// Shoes were ALREADY typed; excluding them from cubes must not have moved their group.
assert(tripsyAttirePackingGroupOf({ name: 'Loafers' }) === 'footwear', 'shoes stay in the footwear group');
assert(tripsyGarmentGlyph('shoes', 'footwear', 'Loafers') === '\u{1F45E}', 'shoes keep their glyph');
`);
