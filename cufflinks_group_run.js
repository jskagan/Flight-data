
const TRIPSY_GARMENT_TYPE_GLYPH = {
  tuxedo: '🤵', suit: '🤵', blazer: '🧥', 'dress-shirt': '👔', shirt: '👕', polo: '👕',
  tee: '👕', sweater: '🧥', jacket: '🧥', 'light-jacket': '🧥', dress: '👗', trousers: '👖', jeans: '👖', shorts: '🩳',
  skirt: '👗', swim: '🩳', tie: '👔', cufflinks: '💎', sunglasses: '🕶️', shoes: '👞', socks: '🧦', 'dress-socks': '🧦', underwear: '🩲', undershirt: '👕',
};
const TRIPSY_ATTIRE_GROUP_GLYPH = { dress_wear: '🧥', outerwear: '🧥', tops: '👕', pants: '👖', footwear: '👞', accessories: '💎', essentials: '🧦' };
const TRIPSY_GARMENT_TYPE_LABEL = {
  tuxedo: 'Tuxedos', suit: 'Suits', blazer: 'Blazers / Sport Coats', jacket: 'Jackets / Coats', 'light-jacket': 'Light Jackets', 'dress-shirt': 'Dress Shirts',
  shirt: 'Shirts', polo: 'Polos', tee: 'T-Shirts', sweater: 'Sweaters', dress: 'Dresses',
  trousers: 'Trousers', jeans: 'Jeans', shorts: 'Shorts', skirt: 'Skirts', swim: 'Swimwear', tie: 'Ties',
  shoes: 'Shoes', socks: 'Socks', 'dress-socks': 'Dress Socks', underwear: 'Underwear', undershirt: 'Undershirts', belt: 'Belts',
  cufflinks: 'Cufflinks', sunglasses: 'Sunglasses',
};
const TRIPSY_GARMENT_TYPE_ORDER = ['tuxedo', 'suit', 'blazer', 'jacket', 'light-jacket', 'sweater', 'dress-shirt', 'shirt', 'polo', 'tee', 'dress', 'trousers', 'jeans', 'shorts', 'skirt', 'swim', 'tie', 'cufflinks', 'sunglasses', 'shoes', 'dress-socks', 'socks', 'underwear', 'undershirt', 'belt'];
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
function tripsyAttirePackingGroupOf(item) {
  const stored = item && item.group;
  if (stored && TRIPSY_ATTIRE_PACKING_GROUPS.includes(stored)) return stored;
  const n = String((item && item.name) || '').toLowerCase();
  if (/\b(dress|formal|evening)\s+socks?\b/.test(n)) return 'dress_wear';
  // Swimwear BEFORE the tailoring rule below, which matches \bsuits?\b -- otherwise a
  // "bathing suit" is grouped as dress_wear (and "swim trunks"/"swimwear", matching
  // nothing at all, fell through to the accessories default). Same trap as the
  // type-key rule; keep the two in step.
  if (/\b(swim|bathing\s*suits?|bathing\s*costumes?|board\s*shorts?|boardies|bikinis?|speedos?|trunks|rash\s*guards?|wet\s*?suits?)/.test(n)) return 'pants';
  if (/\bcasual\s+(trousers?|pants?|slacks?)\b/.test(n)) return 'pants';
  if (/\b(shoes?|boots?|sneakers?|trainers?|loafers?|sandals?|heels?|pumps?|oxfords?|flip[- ]?flops?|slippers?)\b/.test(n)) return 'footwear';
  if (/\b(underwear|undershirts?|briefs?|boxers?|bras?|socks?|pajamas?|pyjamas?|sleepwear|nightwear)\b/.test(n)) return 'essentials';
  if (/\b(suits?|tuxedos?|tux|blazers?|sport\s*coats?|sportcoats?|dress\s+shirts?|ties?|bow\s*ties?|neckties?|gowns?|cocktail\s+dress(es)?|cummerbunds?|waistcoats?|tailcoats?|trousers?|slacks?)\b/.test(n)) return 'dress_wear';
  // Outerwear (worn OVER other clothes) -- after dress_wear so blazers/sport coats/tailcoats
  // stay tailoring; sweaters/cardigans live here (not tops).
  if (/\b(jackets?|coats?|overcoats?|raincoats?|rain\s*jackets?|windbreakers?|parkas?|anoraks?|puffers?|down\s+jackets?|fleeces?|vests?|gilets?|sweaters?|cardigans?|pullovers?|jumpers?|overshirts?|shackets?)\b/.test(n)) return 'outerwear';
  if (/\b(jeans?|shorts?|chinos?|khakis?|pants?|leggings?|skirts?)\b/.test(n)) return 'pants';
  if (/\b(shirts?|t-?shirts?|tees?|blouses?|polos?|tops?|turtlenecks?)\b/.test(n)) return 'tops';
  if (/\b(belts?|scarves|scarf|jewel(le)?ry|watch(es)?|hats?|caps?|sunglasses|bags?|purses?|clutch(es)?|cuff\s*links?|cufflinks?|pocket\s+squares?|gloves?|wraps?|shawls?)\b/.test(n)) return 'accessories';
  return 'accessories';
}
function tripsyGarmentGlyph(typeKey, group, name) {
  if (TRIPSY_GARMENT_TYPE_GLYPH[typeKey]) return TRIPSY_GARMENT_TYPE_GLYPH[typeKey];
  const n = String(name || '').toLowerCase();
  if (/cuff\s?link|jewel|necklace|bracelet|earring|stud\b/.test(n)) return '💎';
  if (/\bwatch\b/.test(n)) return '⌚';
  if (/scarf|wrap|shawl/.test(n)) return '🧣';
  if (/\bglove/.test(n)) return '🧤';
  if (/\bhat\b|\bcap\b|beanie/.test(n)) return '🎩';
  if (/sunglass|glasses|shades/.test(n)) return '🕶️';
  if (/pocket\s?square|handkerchief/.test(n)) return '🧣';
  return TRIPSY_ATTIRE_GROUP_GLYPH[group] || '👕';
}
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
assert(tripsyGarmentGlyph(tripsyGarmentTypeKey('Sunglasses'), 'accessories', 'Sunglasses') === '🕶️',
  'sunglasses still render the shades glyph');
assert(TRIPSY_GARMENT_TYPE_LABEL['sunglasses'] === 'Sunglasses', 'sunglasses have a display label');
// Shoes were ALREADY typed; excluding them from cubes must not have moved their group.
assert(tripsyAttirePackingGroupOf({ name: 'Loafers' }) === 'footwear', 'shoes stay in the footwear group');
assert(tripsyGarmentGlyph('shoes', 'footwear', 'Loafers') === '👞', 'shoes keep their glyph');
