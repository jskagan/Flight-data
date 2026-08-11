const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
function extractConst(name) {
  const start = html.indexOf(`const ${name} = `);
  if (start < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const src = extractConst('TRIPSY_UNCUBED_TYPES') + '\n'
  + ['tripsyGarmentTypeKey', 'tripsyGarmentSkipsCube'].map(extractFn).join('\n');

const HANGS = ['Navy suit', 'Charcoal Suit', 'Tuxedo', 'Black tuxedos', 'Blue blazer',
  'Sport coat', 'Sportcoat', 'Rain jacket', 'Raincoat', 'Packable travel coat',
  'Puffer jacket', 'Windbreaker', 'Overcoat',
  'Black dress', 'Cocktail dresses', 'Evening gown', 'Gowns',
  // Ties are uncubed too -- rolled or laid flat rather than folded into a cube.
  'Tie', 'Ties', 'Black bow tie', 'Bowties', 'Necktie', 'Silk neckties',
  // Cufflinks travel in a case, never a cube.
  'Cufflinks', 'Cuff links', 'Gold cufflink', 'Mother-of-pearl cuff links',
  // Sunglasses live in a case; shoes are packed separately from the cubes.
  'Sunglasses', 'Sun glasses', 'Shades',
  'Loafers', 'Sneakers', 'Dress shoes', 'Black oxfords', 'Boots', 'Sandals', 'Heels', 'Brogues'];
const CUBED = ['Dress shirts', 'Casual tops', 'Chinos', 'Distressed Blue Boss Jeans',
  'Shorts', 'Socks', 'Dress socks', 'Underwear', 'T-shirts', 'Polo', 'Sweater',
  'Swim trunks', 'Bathing suit', 'Swimwear',
  // The near-collisions with the new bare 'dress' rule -- all of these contain the
  // word "dress" but fold, so every one must STILL go in a cube.
  'Dress pants', 'Formal socks', 'Evening socks',
  // Near-collisions with the new 'tie' entry: none of these is a necktie, and the \\b
  // word boundary in the tie rule is what keeps them out of it.
  'Booties', 'Chelsea booties', 'Panties', 'Tights',
  // "link" is REQUIRED by the cufflinks rule, so a French-cuff shirt is not swept up.
  'French cuff shirt', 'Double cuff shirts'];

fs.writeFileSync('uncubed_run.js', `
${src}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
const HANGS = ${JSON.stringify(HANGS)};
const CUBED = ${JSON.stringify(CUBED)};
let bad = [];
for (const n of HANGS) if (!tripsyGarmentSkipsCube(n)) bad.push(n);
assert(bad.length === 0, 'everything that hangs is kept out of cubes' + (bad.length ? ' -> MISSED ' + bad.join(', ') : ''));
bad = [];
for (const n of CUBED) if (tripsyGarmentSkipsCube(n)) bad.push(n);
assert(bad.length === 0, 'everything foldable still goes in a cube' + (bad.length ? ' -> WRONGLY EXCLUDED ' + bad.join(', ') : ''));
// The specific ordering trap tripsyGarmentTypeKey documents: swimwear is matched
// BEFORE 'suit', so a bathing suit must not be treated as tailoring.
assert(tripsyGarmentTypeKey('Bathing suit') === 'swim', 'bathing suit types as swim, not suit');
assert(!tripsyGarmentSkipsCube('Bathing suit'), 'so it is NOT excluded from cubes');
// The same class of trap for the new 'dress' entry: dress-shirt/socks/shoes are all
// matched BEFORE the bare 'dress' rule, so none is mistaken for a gown.
assert(tripsyGarmentTypeKey('Dress shirts') === 'dress-shirt', 'dress shirt types as dress-shirt');
assert(tripsyGarmentTypeKey('Dress socks') === 'dress-socks', 'dress socks type as dress-socks');
assert(tripsyGarmentTypeKey('Dress shoes') === 'shoes', 'dress shoes type as shoes');
assert(tripsyGarmentTypeKey('Evening gown') === 'dress', 'a gown types as dress');
// A generic ("No Picture") item carries its own typeKey -- that wins over the name.
assert(tripsyGarmentSkipsCube('anything', 'blazer'), 'explicit typeKey is honoured');
assert(!tripsyGarmentSkipsCube('Navy suit', 'shirt'), 'an explicit typeKey overrides the name');
// Ties: typed as 'tie' and therefore uncubed, while lookalike words are not.
assert(tripsyGarmentTypeKey('Silk neckties') === 'tie', 'a necktie types as tie');
assert(tripsyGarmentTypeKey('Black bow tie') === 'tie', 'a bow tie types as tie');
assert(tripsyGarmentSkipsCube('Ties'), 'ties are excluded from cubes');
assert(tripsyGarmentTypeKey('Booties') !== 'tie', 'booties do not type as tie');
assert(tripsyGarmentTypeKey('Panties') === 'underwear', 'panties stay underwear');
// Cufflinks: typed only so the uncubed rule (which is type-keyed) can reach them.
assert(tripsyGarmentTypeKey('Cuff links') === 'cufflinks', 'cuff links type as cufflinks');
assert(tripsyGarmentTypeKey('Gold cufflink') === 'cufflinks', 'singular cufflink types too');
assert(tripsyGarmentSkipsCube('Cufflinks'), 'cufflinks are excluded from cubes');
assert(tripsyGarmentTypeKey('French cuff shirt') === 'shirt', 'a French-cuff shirt is still a shirt');
assert(!tripsyGarmentSkipsCube('Double cuff shirts'), 'so it still goes in a cube');
// Shoes and sunglasses: both now uncubed.
assert(tripsyGarmentTypeKey('Sunglasses') === 'sunglasses', 'sunglasses get their own type');
assert(tripsyGarmentSkipsCube('Shades'), 'shades are excluded from cubes');
assert(tripsyGarmentSkipsCube('Black oxfords'), 'shoes are excluded from cubes');
assert(tripsyGarmentTypeKey('Dress shoes') === 'shoes', 'dress shoes still type as shoes, not a gown');
// The sunglasses rule is narrow on purpose: it must not swallow other eyewear or a
// garment that merely has "shade" in its name.
assert(tripsyGarmentTypeKey('Reading glasses') !== 'sunglasses', 'reading glasses are left untyped');
assert(tripsyGarmentTypeKey('Shade of blue shirt') === 'shirt', 'a "shade" in a shirt name is still a shirt');
`);
