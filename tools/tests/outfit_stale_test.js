const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const names = ['tripsyAttireDisplayCategory','tripsyOutfitsUncoveredBlocks','tripsyOutfitBlockTierMoved','tripsyEnumerateAttireBlocks'];
const src = names.map(extractFn).join('\n');
const code = `
${src}
// computeTripsyAttireBlocks is stubbed: displayCategory is pre-stamped in the fixtures,
// which is what it would produce.
function computeTripsyAttireBlocks() { return { blocks: [], counts: {} }; }
const A = (id,name,cat) => ({ id, name, displayCategory: cat, category: cat });
// Baseline day: brunch(casual) -> museum(casual) | evening gala(formal)
const baseGuide = { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','casual'), A('b','Museum','casual'), A('c','Gala','formal')] }] };
const savedBlocks = tripsyEnumerateAttireBlocks(baseGuide).map(b => ({ dayKey:b.dayKey, category:b.category, eventIds:b.eventIds }));
const outfits = { blocks: savedBlocks };
console.log('baseline blocks:', savedBlocks.map(b=>b.dayKey+'|'+b.category+'['+b.eventIds.join(',')+']').join('  '));
const check = (label, guide, expectFlag) => {
  const un = tripsyOutfitsUncoveredBlocks(guide, outfits);
  const got = un.length > 0;
  console.log((got===expectFlag?'ok  ':'FAIL') + ' ' + label + ' -> flag=' + got + (un.length?(' uncovered='+un.map(b=>b.dayKey+'|'+b.category).join(',')):''));
  if (got!==expectFlag) process.exitCode = 1;
};
// 1. ADD adjacent lunch at the SAME level (casual) between brunch & museum -> no flag
check('add casual lunch adjacent to casual block',
  { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','casual'), A('n','Lunch','casual'), A('b','Museum','casual'), A('c','Gala','formal')] }] }, false);
// 2. ADD an event at a DIFFERENT level that forms its own block -> flag
check('add cocktail reception forming a new block',
  { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','casual'), A('b','Museum','casual'), A('n','Reception','cocktail'), A('c','Gala','formal')] }] }, true);
// 3. DELETE an event -> never flag
check('delete the museum (block shrinks)',
  { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','casual'), A('c','Gala','formal')] }] }, false);
check('delete the whole casual block',
  { days: [{ dayKey:'2026-08-14', events: [A('c','Gala','formal')] }] }, false);
// 4. MOVE within the same day/level (reorder) -> no flag
check('move museum before brunch (same level, same day)',
  { days: [{ dayKey:'2026-08-14', events: [A('b','Museum','casual'), A('a','Brunch','casual'), A('c','Gala','formal')] }] }, false);
// 5. MOVE to a different day -> flag (that day needs an outfit)
check('move gala to the next day',
  { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','casual'), A('b','Museum','casual')] },
           { dayKey:'2026-08-15', events: [A('c','Gala','formal')] }] }, true);
// 6. Tier override changes a block's level -> flag
check('override the casual block to smart_casual',
  { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','smart_casual'), A('b','Museum','smart_casual'), A('c','Gala','formal')] }] }, true);
// 7. A SECOND casual block on the same day (isolated later) -> flag
check('second separate casual block same day',
  { days: [{ dayKey:'2026-08-14', events: [A('a','Brunch','casual'), A('b','Museum','casual'), A('c','Gala','formal'), A('n','Nightcap','casual')] }] }, true);
// Per-block modal check
const blk = savedBlocks[0]; // casual block a,b
const tm = (label, guide, expect) => {
  const got = tripsyOutfitBlockTierMoved(guide, blk);
  console.log((got===expect?'ok  ':'FAIL') + ' [modal] ' + label + ' -> stale=' + got);
  if (got!==expect) process.exitCode = 1;
};
tm('adjacent casual lunch added', { days: [{ dayKey:'2026-08-14', events: [A('a','B','casual'), A('n','L','casual'), A('b','M','casual')] }] }, false);
tm('its events deleted', { days: [{ dayKey:'2026-08-14', events: [A('c','Gala','formal')] }] }, false);
tm('block level overridden', { days: [{ dayKey:'2026-08-14', events: [A('a','B','cocktail'), A('b','M','cocktail')] }] }, true);
console.log('DONE');
`;
fs.writeFileSync('outfit_stale_run.js', code);
