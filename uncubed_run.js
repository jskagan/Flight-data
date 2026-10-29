
const TRIPSY_UNCUBED_TYPES = ['suit', 'tuxedo', 'blazer', 'jacket', 'dress', 'tie', 'cufflinks', 'sunglasses', 'shoes'];
function tripsyGarmentTypeKey(name) {
  const n = String(name || '').toLowerCase();
  if (/\bdress shirt/.test(n)) return 'dress-shirt';
  if (/\b(tux|tuxes|tuxedos?|tuxedoes)\b/.test(n)) return 'tuxedo';
  // Swimwear BEFORE "suit" -- a "bathing suit"/"swimsuit" contains the word "suit"
  // but is a swim garment, not tailoring. Matched as a PREFIX (no trailing \b): a
  // whole-word test missed "swimwear"/"swimshorts"/"bikinis", which left the need
  // line untyped -- and an untyped line falls back to GROUP matching, so gym shorts
  // were offered to fill it. The line and the garments must share the 'swim' type.
  if (/\b(swim|bathing\s*suits?|bathing\s*costumes?|board\s*shorts?|boardies|bikinis?|speedos?|trunks|rash\s*guards?|wet\s*?suits?)/.test(n)) return 'swim';
  if (/\bsuit/.test(n)) return 'suit';
  if (/\b(blazer|sport ?coat|sportcoat)/.test(n)) return 'blazer';
  // LIGHT JACKET is split out from the general jacket/coat bucket below and must be
  // checked FIRST, or "Traveler Jacket" would already match the generic \bjackets?\b
  // rule. Unlike heavy jackets/coats/raincoats/parkas (TRIPSY_UNCUBED_TYPES -- they
  // hang), a light/packable travel jacket folds small and is meant to go IN a cube, so
  // giving it its own type is what lets it skip that uncubed treatment. "Traveler
  // jacket" is Loro Piana's own product name for exactly this kind of piece.
  // PACKABLE outerwear is light-jacket too ("I packed a light fleece and rain jacket in a
  // cube, but the app does not allow me to show them as packed in a cube," 2026-10-06):
  // a fleece, rain jacket, windbreaker, anorak, puffer, gilet or overshirt/shacket folds
  // into a cube like any ordinary garment, so it must not be typed as the HANGING kind.
  // Two forms: the packable KINDS by name, and a "light"/"lightweight"/"packable"/
  // "travel" word in front of ANY outerwear word (a "packable travel coat" packs, however
  // it is spelled). What stays 'jacket' (hung): a plain jacket, coat, overcoat, raincoat
  // (a trench) or parka. tripsyGarmentLineMatchType folds both back to 'jacket' for
  // need-line matching, so a "rain jacket" line still offers and counts all of these.
  if (/\b(light(weight)?|packable|travel(er)?)\s+(\w+\s+)?(jackets?|coats?|overcoats?|raincoats?|parkas?|fleeces?|windbreakers?|anoraks?|puffers?|gilets?|overshirts?|shackets?)\b/.test(n)) return 'light-jacket';
  if (/\b(rain ?jackets?|windbreakers?|anoraks?|puffers?|fleeces?|gilets?|overshirts?|shackets?)\b/.test(n)) return 'light-jacket';
  if (/\b(jackets?|coats?|overcoats?|raincoats?|parkas?)\b/.test(n)) return 'jacket';
  // Underwear and undershirts get distinct types (and socks, below) so the three
  // essentials need lines stop being interchangeable -- they're all group 'essentials'
  // with no type, so before this each line's picker offered all of them. Ahead of the
  // generic shirt rule, and "vests" is deliberately NOT here: the packing-group rules
  // read a vest as outerwear, and the two must not disagree.
  if (/\b(undershirts?|under\s*shirts?|singlets?|base\s*layers?)\b/.test(n)) return 'undershirt';
  if (/\b(underwear|underpants?|boxers?|boxer\s*briefs?|briefs?|knickers?|panties|thongs?)\b/.test(n)) return 'underwear';
  if (/\bpolo/.test(n)) return 'polo';
  // Must stay AHEAD of the generic shirt rule below: "t-shirts" used to miss this
  // whole-word test and get caught by that rule instead, typing a tee as 'shirt'.
  if (/\b(t-?shirts?|tees?)\b/.test(n)) return 'tee';
  if (/\b(sweater|pullover|cardigan|jumper|hoodie)/.test(n)) return 'sweater';
  if (/\b(button-?up|button-?down|linen shirt|casual shirt|oxford shirt|shirt|blouse)/.test(n)) return 'shirt';
  if (/\b(chinos|trousers|slacks|dress pants|khakis|pants)/.test(n)) return 'trousers';
  if (/\bjeans/.test(n)) return 'jeans';
  if (/\bshorts/.test(n)) return 'shorts';
  if (/\bskirt/.test(n)) return 'skirt';
  // Socks BEFORE the dress/gown rule at the end, which matches the bare word "dress" --
  // without this "dress socks" typed as 'dress', i.e. a gown. Harmless for him (the need
  // line and the garment mistyped identically, so they still matched each other), but on
  // Hers an actual dress could fill a dress-socks line.
  // Dress socks are their own type, exactly as dress shirts are separate from shirts:
  // General is tier-agnostic, so without this a tagged "Dress socks" garment was also
  // offered on the casual-socks line (same 'socks' type, no dress-code test to stop it).
  // Must precede the generic socks rule.
  if (/\b(dress|formal|evening|tuxedo)\s*socks?\b/.test(n)) return 'dress-socks';
  if (/\bsocks?\b/.test(n)) return 'socks';
  if (/\b(bow ?ties?|neckties?|ties?)\b/.test(n)) return 'tie';
  // Cufflinks are typed only so they can be excluded from packing cubes, which is a
  // TYPE-keyed rule (TRIPSY_UNCUBED_TYPES). "link" is required, so a shirt described as
  // having French cuffs is not swept up. Everything else about them is unchanged: their
  // packing GROUP stays 'accessories' and their glyph stays the same gem.
  if (/\bcuff\s*links?\b/.test(n)) return 'cufflinks';
  // Sunglasses, same story as cufflinks: typed only so the cube-exclusion rule can reach
  // them. Deliberately narrow -- "sunglasses"/"shades" and nothing else, so prescription
  // glasses or a "shade of blue" in some other garment's name are left untyped as before.
  if (/\b(sunglasses|sun\s*glasses|shades)\b/.test(n)) return 'sunglasses';
  // Every alternative carries its own plural -- without it "loafers"/"sneakers"/
  // "sandals"/"brogues"/"oxfords" fell through to '' (untyped) while the singular
  // typed fine, so a plural-named pair never matched a Shoes line. "derby" pluralizes
  // irregularly, hence derb(y|ies).
  if (/\b(oxfords?|loafers?|derb(y|ies)|brogues?|dress\s*shoes?|shoes?|boots?|sneakers?|sandals?|heels?)\b/.test(n)) return 'shoes';
  if (/\bbelt/.test(n)) return 'belt';
  if (/\b(dress(es)?|gowns?)\b/.test(n)) return 'dress'; // after dress-shirt/pants/shoe, so this is a real dress/gown
  return '';
}
function tripsyGarmentSkipsCube(name, typeKey) {
  return TRIPSY_UNCUBED_TYPES.includes(typeKey || tripsyGarmentTypeKey(name || ''));
}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
const HANGS = ["Navy suit","Charcoal Suit","Tuxedo","Black tuxedos","Blue blazer","Sport coat","Sportcoat","Raincoat","Overcoat","Down Parka","Navy Jacket","Wool coat","Black dress","Cocktail dresses","Evening gown","Gowns","Tie","Ties","Black bow tie","Bowties","Necktie","Silk neckties","Cufflinks","Cuff links","Gold cufflink","Mother-of-pearl cuff links","Sunglasses","Sun glasses","Shades","Loafers","Sneakers","Dress shoes","Black oxfords","Boots","Sandals","Heels","Brogues"];
const CUBED = ["Dress shirts","Casual tops","Chinos","Distressed Blue Boss Jeans","Shorts","Socks","Dress socks","Underwear","T-shirts","Polo","Sweater","Swim trunks","Bathing suit","Swimwear","Light fleece","Rain jacket","Packable travel coat","Puffer jacket","Windbreaker","Fleece","Anorak","Gilet","Lightweight coat","Travel jacket","Dress pants","Formal socks","Evening socks","Booties","Chelsea booties","Panties","Tights","French cuff shirt","Double cuff shirts"];
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
