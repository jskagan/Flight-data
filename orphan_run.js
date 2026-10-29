
const TRIPSY_UNCUBED_TYPES = ['suit', 'tuxedo', 'blazer', 'jacket', 'dress', 'tie', 'cufflinks', 'sunglasses', 'shoes'];
const TRIPSY_FLIGHT_WORN_SUFFIX = ' — wearing on the flight';
const TRIPSY_CUBE_FLIGHT_WORN = '__cube_flight_worn__';
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
function tripsyCubesForEntry(entry, packed) {
  const raw = (entry && Array.isArray(entry.cubes)) ? entry.cubes : [];
  const out = [];
  for (let i = 0; i < packed; i++) out.push(typeof raw[i] === 'string' ? raw[i] : '');
  return out;
}
function tripsyWardrobeLineIsFlightWorn(name) { return String(name || '').endsWith(TRIPSY_FLIGHT_WORN_SUFFIX); }
function tripsyWardrobeFlightWornEntry(entry) {
  if (!entry || !tripsyWardrobeLineIsFlightWorn(entry.line)) return entry;
  const qty = Math.max(1, entry.qty || 1);
  return { ...entry, qty, packed: qty, cubes: Array.from({ length: qty }, () => TRIPSY_CUBE_FLIGHT_WORN) };
}
function tripsyNormalizeTripSelection(arr) {
  return (arr || []).map(e => {
    if (typeof e === 'string') return { id: e, category: '', line: '', qty: 1, packed: 0, cubes: [] };
    const qty = Math.max(1, e.qty || 1);
    // `category` is the dress-code tier this allocation is for. Legacy entries (from
    // before per-category selection) have '' and are treated as unrecognized by the
    // per-category screens (the owner re-picks). See tripsyWardrobePackForTrip.
    // `line` is the NEED LINE within that tier (its name, not its index -- indices
    // shift whenever the guide is regenerated). '' means an entry saved before
    // per-line allocation; tripsyWardrobeResolveSelectionLines stamps one on.
    const packed = Math.max(0, Math.min(qty, e.packed || 0));
    // `cubes` is PER COPY: cubes[i] is the packing cube copy i went into, '' for a copy
    // that is packed but whose cube isn't known (an entry packed before cubes existed,
    // or one whose cube was later deleted). Length is always exactly `packed`, so
    // "how many are packed" and "where each one is" can never disagree -- see
    // tripsyCubesForEntry, which is the only place this is derived.
    const entry = { id: e.id, category: e.category || '', line: e.line || '', qty, packed, cubes: tripsyCubesForEntry(e, packed) };
    return tripsyWardrobeLineIsFlightWorn(entry.line) ? tripsyWardrobeFlightWornEntry(entry) : entry;
  }).filter(e => e.id);
}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

// THE MECHANISM behind the bug: normalisation pads every PACKED copy to a cube slot,
// and an uncubed garment's slots are empty strings -- which is exactly what the
// "Cube not set" block collects.
const norm = tripsyNormalizeTripSelection([
  { id: 'suit1', category: 'formal', line: 'Suit', qty: 1, packed: 1, cubes: [] },
  { id: 'tie1',  category: 'formal', line: 'Ties', qty: 2, packed: 2, cubes: [] },
  { id: 'shirt1', category: 'formal', line: 'Dress shirts', qty: 2, packed: 2, cubes: ['cubeA'] },
]);
const by = Object.fromEntries(norm.map(e => [e.id, e]));
assert(JSON.stringify(by.suit1.cubes) === '[""]', 'a packed suit is padded to one empty slot -> ' + JSON.stringify(by.suit1.cubes));
assert(JSON.stringify(by.tie1.cubes) === '["",""]', 'a packed pair of ties -> two empty slots');
assert(JSON.stringify(by.shirt1.cubes) === '["cubeA",""]', 'a real shirt keeps its cube, second copy unknown');

// THE FIX, as the contents page now applies it: skip uncubed garments before collecting.
const names = { suit1: 'Navy suit', tie1: 'Silk neckties', shirt1: 'Dress shirts' };
const orphans = [];
for (const e of norm) {
  const name = names[e.id];
  if (tripsyGarmentSkipsCube(name)) continue;
  for (const cid of e.cubes) if (!cid) orphans.push(name);
}
assert(!orphans.includes('Navy suit'), 'the suit is no longer listed under "Cube not set"');
assert(!orphans.includes('Silk neckties'), 'the ties are no longer listed under "Cube not set"');
assert(orphans.length === 1 && orphans[0] === 'Dress shirts',
  'a genuinely unplaced foldable garment IS still listed -> ' + JSON.stringify(orphans));

// A generic ("No Picture") line carries its own typeKey, which wins over the name.
assert(tripsyGarmentSkipsCube('anything', 'tie'), 'a generic tie line is skipped by typeKey');
assert(!tripsyGarmentSkipsCube('Dress shirts', ''), 'an empty typeKey falls back to the name');
// An entry whose garment record is missing entirely must not crash the filter.
assert(tripsyGarmentSkipsCube(undefined) === false, 'a missing garment name is treated as cubed, not skipped');
