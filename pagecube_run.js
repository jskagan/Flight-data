
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let driveData = { tripsyPackingCubes: [] };
const TRIPSY_CUBE_SIZES = ['Large', 'Medium', 'Small', 'Extra small'];
const TRIPSY_CUBE_COLORS = ['Black', 'Blue', 'Purple', 'Orange', 'Yellow', 'Gray', 'Brown', 'Zebra'];
const TRIPSY_CUBE_COLOR_CSS = {
  Black: '#23262B', Blue: '#2E62C8', Purple: '#7B4BC9', Orange: '#E07A28',
  Yellow: '#E3C22B', Gray: '#8A9099', Brown: '#7A5230',
  Zebra: 'repeating-linear-gradient(135deg,#F2F2F2 0 7px,#1B1B1B 7px 14px)',
};
const TRIPSY_UNCUBED_TYPES = ['suit', 'tuxedo', 'blazer', 'jacket', 'dress', 'tie', 'cufflinks', 'sunglasses', 'shoes'];
const TRIPSY_CUBE_NONE = '__cube_none__';
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
function tripsyCubeById(id) {
  if (!id) return null;
  return (driveData.tripsyPackingCubes || []).find(c => c.id === id) || null;
}
function tripsyCubeName(cube) {
  if (!cube) return '';
  const base = [cube.color, cube.size].filter(Boolean).join(' ');
  if (!base) return cube.name || 'Cube';
  const twins = (driveData.tripsyPackingCubes || [])
    .filter(c => c && (c.color || '') === (cube.color || '') && (c.size || '') === (cube.size || ''));
  if (twins.length <= 1 || !cube.brand) return base;
  const distinctBrands = new Set(twins.map(c => c.brand || ''));
  return distinctBrands.size > 1 ? `${base} (${cube.brand})` : base;
}
function tripsyCubeTileHtml(cube, { size = 74, selected = false } = {}) {
  // No photo yet -> fall back to the cube's own COLOUR as a swatch. That is still a
  // real identifier (it is one of the three traits), so an unphotographed cube stays
  // tellable apart in the grid instead of being one of N identical suitcase glyphs.
  const swatch = TRIPSY_CUBE_COLOR_CSS[cube.color] || 'var(--panel-2)';
  const inner = cube.driveFileId
    ? `<img data-tw-cube-photo="${esc(cube.driveFileId)}" alt="" style="width:100%; height:100%; object-fit:cover; display:block;">`
    : `<div style="width:100%; height:100%; background:${swatch};"></div>`;
  return `<div style="width:${size}px; height:${size}px; border-radius:10px; overflow:hidden; background:var(--panel-2);
    border:${selected ? '3px solid var(--amber)' : '1px solid var(--line)'}; flex-shrink:0;">${inner}</div>`;
}
function tripsyCubeSlotLabel(cid) {
  if (cid === TRIPSY_CUBE_FLIGHT_WORN) return 'Wearing on the flight';
  if (cid === TRIPSY_CUBE_NONE) return 'No cube';
  const cube = tripsyCubeById(cid);
  return cube ? tripsyCubeName(cube) : '';
}
function tripsyCubeSlotGlyph(cid) {
  if (cid === TRIPSY_CUBE_FLIGHT_WORN) return '&#9992;&#65039;';
  if (cid === TRIPSY_CUBE_NONE) return '&#128092;';
  return '&#129523;';
}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
driveData.tripsyPackingCubes = [
  { id: 'c1', color: 'Yellow', size: 'Medium', brand: '', driveFileId: 'photoYellow' },
  { id: 'c2', color: 'Black', size: 'Small', brand: '', driveFileId: 'photoBlack' },
];
const run = (garmentItems, genItems) => {
  const pageCubeIds = [];
  const pageCubeCounts = new Map();
  const countCube = cid => {
    const key = cid || '';
    if (!pageCubeCounts.has(key)) { pageCubeCounts.set(key, 0); pageCubeIds.push(key); }
    pageCubeCounts.set(key, pageCubeCounts.get(key) + 1);
  };
  for (const it of garmentItems) {
    if (tripsyGarmentSkipsCube(it.g && it.g.name)) continue;
    for (const cid of (it.cubes || [])) countCube(cid);
  }
  for (const { x } of genItems) {
    if (tripsyGarmentSkipsCube(x.name, x.typeKey)) continue;
    for (const cid of (x.cubes || [])) countCube(cid);
  }
  // One cube for the whole page is the common case, and then the per-card thumbnails are
  // pure repetition -- the banner has already answered the question. With the page split
  // across cubes the banner can only say WHICH cubes are involved, so the per-card chips
  // stay: they are the only thing saying which garment went where.
  const pageCubesSplit = pageCubeIds.length > 1;
  const pageCubesHtml = !pageCubeIds.length ? '' : `
    <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start; margin-bottom:14px;">
      ${pageCubeIds.map(cid => {
        const cube = tripsyCubeById(cid);
        const special = cid === TRIPSY_CUBE_NONE || cid === TRIPSY_CUBE_FLIGHT_WORN;
        const n = pageCubeCounts.get(cid);
        const pic = cube
          ? tripsyCubeTileHtml(cube, { size: 96 })
          : `<div style="width:96px; height:96px; border-radius:10px; border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; font-size:34px; color:var(--muted); flex-shrink:0;">${tripsyCubeSlotGlyph(cid)}</div>`;
        const label = tripsyCubeSlotLabel(cid) || 'Cube not set';
        return `<div style="display:flex; flex-direction:column; gap:6px; align-items:center; width:96px;">
          ${pic}
          <div style="font-size:12.5px; font-weight:600; color:${(cube || special) ? 'var(--text)' : 'var(--amber)'}; text-align:center; line-height:1.3;">${esc(label)}</div>
          <div style="font-size:11.5px; color:var(--muted);">${n} item${n === 1 ? '' : 's'}</div>
        </div>`;
      }).join('')}
    </div>`;
  return { pageCubesHtml, pageCubesSplit, pageCubeIds, pageCubeCounts };
};
const G = (name, cubes) => ({ g: { id: name, name }, qty: cubes.length, packed: cubes.length, cubes });

// THE COMMON CASE: everything on the page in one cube -> ONE large picture, and the
// per-card chips are suppressed as pure repetition.
let r = run([G('Charcoal Rhone Gym Shirt', ['c1']), G('Blue Rhone Gym Shirt', ['c1'])], []);
assert(!r.pageCubesSplit, 'one cube for the whole page is not a split');
assert((r.pageCubesHtml.match(/data-tw-cube-photo/g) || []).length === 1, 'exactly ONE cube picture is drawn');
assert(/width:96px; height:96px/.test(r.pageCubesHtml) || /size: 96/.test('') || /96px/.test(r.pageCubesHtml), 'and it is the LARGE size, not a 26px thumbnail');
assert(/Yellow Medium/.test(r.pageCubesHtml), 'named under the picture');
assert(/2 items/.test(r.pageCubesHtml), 'with the count of packed copies -> ' + (r.pageCubesHtml.match(/\d+ items?/)||[])[0]);

// SPLIT ACROSS CUBES: every cube gets its own large picture AND text, and the per-card
// chips stay, since only they say which garment went where.
r = run([G('Charcoal Rhone Gym Shirt', ['c1']), G('Blue Rhone Gym Shirt', ['c2'])], []);
assert(r.pageCubesSplit, 'two cubes on one page IS a split');
assert((r.pageCubesHtml.match(/data-tw-cube-photo/g) || []).length === 2, 'both cubes are pictured');
assert(/Yellow Medium/.test(r.pageCubesHtml) && /Black Small/.test(r.pageCubesHtml), 'and both named');

// Copies of one garment split across two cubes also counts as a split.
r = run([G('Chinos', ['c1','c2'])], []);
assert(r.pageCubesSplit, 'one garment split across two cubes is a split too');
assert(r.pageCubeCounts.get('c1') === 1 && r.pageCubeCounts.get('c2') === 1, 'each copy counted once');

// UNCUBED types contribute nothing: their card already says why they have no cube.
r = run([G('Navy suit', ['']), G('Silk neckties', ['','']), G('Black oxfords', [''])], []);
assert(r.pageCubeIds.length === 0 && r.pageCubesHtml === '', 'a page of uncubed garments shows no cube banner');

// A packed copy with no cube recorded still shows -- as its own "Cube not set" entry --
// rather than vanishing from the banner.
r = run([G('Chinos', ['']), G('Jeans', ['c1'])], []);
assert(/Cube not set/.test(r.pageCubesHtml), 'an unplaced copy is called out');
assert(r.pageCubesSplit, 'and counts as a split, so the cards say which is which');
assert((r.pageCubesHtml.match(/data-tw-cube-photo/g) || []).length === 1, 'only the real cube has a picture');

// Nothing packed at all -> no banner (not an empty box).
r = run([G('Chinos', [])], []);
assert(r.pageCubesHtml === '', 'an unpacked page shows no banner');

// Generic ("No Picture") lines are counted too, and their typeKey decides uncubed-ness.
r = run([], [{ x: { name: 'T-shirts', typeKey: 'tee', packed: 2, qty: 2, cubes: ['c1','c1'] } }]);
assert(/2 items/.test(r.pageCubesHtml), 'generic lines count toward the banner');
r = run([], [{ x: { name: 'Ties', typeKey: 'tie', packed: 1, qty: 1, cubes: [''] } }]);
assert(r.pageCubesHtml === '', 'an uncubed generic line contributes nothing');
