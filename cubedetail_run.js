
// --- minimal DOM + app stubs: enough to run the real render and read its markup ---
const mkEl = () => ({ innerHTML: '', style: {}, onclick: null, id: '', className: '',
  querySelectorAll: () => [], appendChild(){}, setAttribute(){}, getAttribute(){ return null; } });
const nodes = {};
global.document = {
  getElementById: id => nodes[id] || null,
  createElement: () => mkEl(),
  body: { appendChild: el => { nodes[el.id] = el; } },
};
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let driveData = { tripsyPackingCubes: [] };
const tripsyCubePhotoUrlCache = new Map();
const tripsyPaintCubePhotos = () => {};
let photosPainted = 0;
const tripsyWardrobeLoadPhotos = () => { photosPainted++; };
const tripsyConfirmDialog = async () => false;
const Store = { deletePackingCube: async () => true };
const showTripsyCubeForm = async () => null;

const TRIPSY_CUBE_BRANDS = ['Briggs & Riley', 'Eagle Creek Reveal', 'Eagle Creek Pack-It'];
const TRIPSY_CUBE_SIZES = ['Large', 'Medium', 'Small', 'Extra small'];
const TRIPSY_CUBE_COLORS = ['Black', 'Blue', 'Purple', 'Orange', 'Yellow', 'Gray', 'Brown', 'Zebra'];
const TRIPSY_CUBE_COLOR_CSS = {
  Black: '#23262B', Blue: '#2E62C8', Purple: '#7B4BC9', Orange: '#E07A28',
  Yellow: '#E3C22B', Gray: '#8A9099', Brown: '#7A5230',
  Zebra: 'repeating-linear-gradient(135deg,#F2F2F2 0 7px,#1B1B1B 7px 14px)',
};
const TRIPSY_UNCUBED_TYPES = ['suit', 'tuxedo', 'blazer', 'jacket', 'dress', 'tie', 'cufflinks', 'sunglasses', 'shoes'];
const TRIPSY_GARMENT_TYPE_GLYPH = {
  tuxedo: '🤵', suit: '🤵', blazer: '🧥', 'dress-shirt': '👔', shirt: '👕', polo: '👕',
  tee: '👕', sweater: '🧥', jacket: '🧥', 'light-jacket': '🧥', dress: '👗', trousers: '👖', jeans: '👖', shorts: '🩳',
  skirt: '👗', swim: '🩳', tie: '👔', cufflinks: '💎', sunglasses: '🕶️', shoes: '👞', socks: '🧦', 'dress-socks': '🧦', underwear: '🩲', undershirt: '👕',
};
const TRIPSY_ATTIRE_GROUP_GLYPH = { dress_wear: '🧥', outerwear: '🧥', tops: '👕', pants: '👖', footwear: '👞', accessories: '💎', essentials: '🧦' };
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
function tripsyCubesSorted() {
  const sizeIdx = c => { const i = TRIPSY_CUBE_SIZES.indexOf(c.size); return i < 0 ? TRIPSY_CUBE_SIZES.length : i; };
  const colorIdx = c => { const i = TRIPSY_CUBE_COLORS.indexOf(c.color); return i < 0 ? TRIPSY_CUBE_COLORS.length : i; };
  return [...(driveData.tripsyPackingCubes || [])]
    .sort((a, b) => sizeIdx(a) - sizeIdx(b) || colorIdx(a) - colorIdx(b) || (a.brand || '').localeCompare(b.brand || ''));
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
function tripsyCubeContentsMap(selEntries, generics, garmentById) {
  const contents = new Map();
  const add = (cubeId, item) => {
    if (!contents.has(cubeId)) contents.set(cubeId, new Map());
    const m = contents.get(cubeId);
    const cur = m.get(item.key);
    if (cur) cur.count += 1;
    else m.set(item.key, { key: item.key, name: item.name, driveFileId: item.driveFileId, typeKey: item.typeKey, group: item.group, count: 1 });
  };
  for (const e of (selEntries || [])) {
    const g = garmentById.get(e.id);
    if (tripsyGarmentSkipsCube(g && g.name)) continue;
    const name = (g && g.name) || 'Garment';
    const item = { key: 'g:' + e.id, name, driveFileId: (g && g.driveFileId) || '', typeKey: tripsyGarmentTypeKey(name), group: (g && g.group) || '' };
    for (const cid of (e.cubes || [])) add(cid || '', item);
  }
  for (const x of (generics || [])) {
    if (tripsyGarmentSkipsCube(x.name, x.typeKey)) continue;
    // A generic ("No Picture") line has no wardrobe record and so never has a photo --
    // it renders its type glyph in the drill-down, exactly as it does everywhere else.
    const name = x.name || 'Item';
    const item = { key: 'x:' + name, name, driveFileId: '', typeKey: x.typeKey || tripsyGarmentTypeKey(name), group: '' };
    for (const cid of (x.cubes || [])) add(cid || '', item);
  }
  return contents;
}
function showTripsyCubeContents(getState, onChanged) {
  let ov = document.getElementById('tw-cube-contents-overlay');
  if (!ov) { ov = document.createElement('div'); ov.id = 'tw-cube-contents-overlay'; ov.className = 'tw-modal'; document.body.appendChild(ov); }
  ov.style.zIndex = '2147483140';
  // 'list' = every cube; { mode:'cube', id } = one cube's garments with their photos.
  // Opened by tapping a cube's picture or its name; '' is the "Cube not set" pseudo-cube,
  // which drills down the same way so an unplaced copy is as inspectable as a placed one.
  let view = { mode: 'list' };
  const render = () => {
    const { selEntries, generics, garmentById } = getState();
    const cubes = tripsyCubesSorted();
    // cubeId -> Map(key -> {name, count, driveFileId, typeKey, group}). A garment
    // allocated across several tiers contributes each of its entries, which is right:
    // those are genuinely separate copies in the bag. Keyed by garment ID rather than
    // name so the drill-down can find each one's photo, and so two wardrobe garments
    // that happen to share a name stay separate.
    const contents = tripsyCubeContentsMap(selEntries, generics, garmentById);
    const itemsIn = cubeId => [...(contents.get(cubeId) || new Map()).values()];
    const listFor = cubeId => {
      const items = itemsIn(cubeId);
      if (!items.length) return `<div style="font-size:12.5px; color:var(--muted);">Empty</div>`;
      return `<div style="font-size:13px; color:var(--text); line-height:1.5;">`
        + items.map(it => `${esc(it.name)}${it.count > 1 ? ` <span style="color:var(--muted);">x${it.count}</span>` : ''}`).join('<br>')
        + `</div>`;
    };
    // One cube's garments, with pictures. Same card shape the wardrobe and packing grids
    // use, so a photo here looks like the same garment there; tripsyWardrobeLoadPhotos
    // fills each .tw-photo from Drive after the markup lands.
    if (view.mode === 'cube') {
      const cube = tripsyCubeById(view.id);
      const items = itemsIn(view.id);
      const title = cube ? tripsyCubeName(cube) : (tripsyCubeSlotLabel(view.id) || 'Cube not set');
      const cards = items.map(it => `
        <div class="tw-card">
          <div class="tw-photo${it.driveFileId ? '' : ' tw-photo-glyph'}"${it.driveFileId ? ` data-tw-photo="${esc(it.driveFileId)}"` : ''}>${it.driveFileId ? '' : tripsyGarmentGlyph(it.typeKey, it.group, it.name)}</div>
          <div class="tw-info"><div class="tw-name">${esc(it.name)}${it.count > 1 ? ` <span style="color:var(--muted);">×${it.count}</span>` : ''}</div></div>
        </div>`).join('');
      const total = items.reduce((n, it) => n + it.count, 0);
      ov.innerHTML = `
        <div class="tw-modal-paper" style="max-width:520px;">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:10px; min-width:0;">
              ${cube ? tripsyCubeTileHtml(cube, { size: 46 }) : ''}
              <div style="min-width:0;">
                <h2 style="margin:0; font-size:18px; overflow:hidden; text-overflow:ellipsis;">${esc(title)}</h2>
                <div style="font-size:12px; color:var(--muted);">${total} item${total === 1 ? '' : 's'}${cube && cube.brand ? ` · ${esc(cube.brand)}` : ''}</div>
              </div>
            </div>
            <button class="tripsy-close-x" data-tw-cubes-close aria-label="Close" title="Close">&#10005;</button>
          </div>
          ${cards ? `<div class="tw-grid">${cards}</div>` : `<div class="empty-state" style="margin-top:12px;">Nothing packed in this cube yet.</div>`}
        </div>`;
      tripsyPaintCubePhotos(ov);
      tripsyWardrobeLoadPhotos(ov);
      return;
    }
    // The picture and the name are both drill-down triggers (wrapped rather than made
    // buttons, so the tile keeps its own markup). Edit/Delete sit inside the same row and
    // are matched FIRST in the click handler, so tapping them never opens the cube.
    const cubeBlocks = cubes.map(c => `
      <div style="display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--line);">
        <span data-tw-open-cube="${esc(c.id)}" style="cursor:pointer; flex-shrink:0;">${tripsyCubeTileHtml(c, { size: 64 })}</span>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
            <span data-tw-open-cube="${esc(c.id)}" style="font-weight:700; font-size:14px; cursor:pointer; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px;">${esc(tripsyCubeName(c))}</span>
            ${c.brand ? `<span style="font-size:11.5px; color:var(--muted);">${esc(c.brand)}</span>` : ''}
            <button class="btn" data-tw-edit-cube="${esc(c.id)}" style="font-size:11px; padding:3px 8px;">Edit</button>
            <button class="btn" data-tw-del-cube="${esc(c.id)}" style="font-size:11px; padding:3px 8px; border-color:var(--red); color:var(--red);">Delete</button>
          </div>
          ${listFor(c.id)}
        </div>
      </div>`).join('');
    // Two explicit non-cube blocks, same shape as the orphan block below, for the
    // "No cube"/"Wear on flight" picks made from the cube picker -- each is a real,
    // deliberate choice, so it gets its own named row rather than being lumped in
    // with genuinely-undecided copies.
    const specialBlock = (id, label, glyph) => {
      const bucket = contents.get(id);
      if (!bucket || !bucket.size) return '';
      return `
      <div style="display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--line);">
        <div data-tw-open-cube="${id}" style="width:64px; height:64px; border-radius:10px; border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; font-size:26px; color:var(--muted); flex-shrink:0; cursor:pointer;">${glyph}</div>
        <div style="flex:1; min-width:0;">
          <div data-tw-open-cube="${id}" style="font-weight:700; font-size:14px; margin-bottom:4px; color:var(--text); cursor:pointer; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:3px;">${esc(label)}</div>
          ${listFor(id)}
        </div>
      </div>`;
    };
    const noCubeBlock = specialBlock(TRIPSY_CUBE_NONE, 'No cube', tripsyCubeSlotGlyph(TRIPSY_CUBE_NONE));
    const flightWornBlock = specialBlock(TRIPSY_CUBE_FLIGHT_WORN, 'Wearing on the flight', tripsyCubeSlotGlyph(TRIPSY_CUBE_FLIGHT_WORN));
    // Copies that are packed but whose cube is unknown, shown as their own block so they
    // are visible and fixable rather than quietly missing from every cube.
    const orphan = contents.get('');
    const orphanBlock = (orphan && orphan.size) ? `
      <div style="display:flex; gap:12px; align-items:flex-start; padding:10px 0; border-bottom:1px solid var(--line);">
        <div data-tw-open-cube="" style="width:64px; height:64px; border-radius:10px; border:1px dashed var(--line); display:flex; align-items:center; justify-content:center; font-size:26px; color:var(--muted); flex-shrink:0; cursor:pointer;">?</div>
        <div style="flex:1; min-width:0;">
          <div data-tw-open-cube="" style="font-weight:700; font-size:14px; margin-bottom:4px; color:var(--amber); cursor:pointer;">Cube not set</div>
          ${listFor('')}
        </div>
      </div>` : '';
    const extraBlocks = noCubeBlock + flightWornBlock + orphanBlock;
    ov.innerHTML = `
      <div class="tw-modal-paper" style="max-width:520px;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
          <h2 style="margin:0; font-size:18px;">Packing cubes</h2>
          <div style="display:flex; gap:8px;">
            <button class="btn" data-tw-add-cube>Add cube</button>
            <button class="tripsy-close-x" data-tw-cubes-close aria-label="Close" title="Close">&#10005;</button>
          </div>
        </div>
        ${cubes.length || extraBlocks ? (cubeBlocks + extraBlocks) : `<div class="empty-state" style="margin-top:12px;">No cubes yet — add one, or create one while packing a garment.</div>`}
      </div>`;
    tripsyPaintCubePhotos(ov);
  };
  render();
  ov.style.display = 'flex';
  ov.onclick = async e => {
    // One contextual Close, the same shape the packing screens use: on a cube's
    // drill-down it goes back to the list of cubes; on the list it closes the page.
    if (e.target.closest('[data-tw-cubes-close]') || e.target === ov) {
      if (view.mode === 'cube') { view = { mode: 'list' }; render(); return; }
      ov.style.display = 'none'; ov.onclick = null; return;
    }
    // The photo lands in the background after the form closes; repaint when it does.
    const repaint = () => { if (ov.style.display !== 'none') render(); };
    if (e.target.closest('[data-tw-add-cube]')) { if (await showTripsyCubeForm(null, repaint)) { render(); onChanged && onChanged(); } return; }
    const editBtn = e.target.closest('[data-tw-edit-cube]');
    if (editBtn) {
      const cube = tripsyCubeById(editBtn.dataset.twEditCube);
      if (cube && await showTripsyCubeForm(cube, repaint)) { render(); onChanged && onChanged(); }
      return;
    }
    const delBtn = e.target.closest('[data-tw-del-cube]');
    if (delBtn) {
      const cube = tripsyCubeById(delBtn.dataset.twDelCube);
      if (!cube) return;
      const ok = await tripsyConfirmDialog(
        `Delete “${tripsyCubeName(cube) || 'this cube'}”? Anything packed in it stays packed, but its location is forgotten and will read “cube not set”.`,
        { title: 'Delete packing cube', yes: 'Delete', no: 'Keep' });
      if (!ok) return;
      await Store.deletePackingCube(cube.id);
      render();
      onChanged && onChanged();
      return;
    }
    // Last, so Edit/Delete (which sit inside the same tappable row) win over it.
    const openEl = e.target.closest('[data-tw-open-cube]');
    if (openEl) { view = { mode: 'cube', id: openEl.getAttribute('data-tw-open-cube') || '' }; render(); }
  };
}

const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

driveData.tripsyPackingCubes = [
  { id: 'c1', color: 'Blue', size: 'Medium', brand: 'Eagle Creek Reveal', driveFileId: 'cubephoto1' },
  { id: 'c2', color: 'Black', size: 'Small', brand: '' },
];
const garments = [
  { id: 'g1', name: 'Dress shirts', driveFileId: 'photoA', group: 'tops' },
  { id: 'g2', name: 'Chinos', driveFileId: '', group: 'pants' },
  { id: 'g3', name: 'Navy suit', driveFileId: 'photoC', group: 'dress_wear' },
];
const garmentById = new Map(garments.map(g => [g.id, g]));
const state = {
  garmentById,
  // g1 appears under TWO tiers, both in c1 -- the drill-down must total them as x3.
  selEntries: [
    { id: 'g1', category: 'formal', line: 'Dress shirts', qty: 2, packed: 2, cubes: ['c1','c1'] },
    { id: 'g1', category: 'cocktail', line: 'Dress shirts', qty: 1, packed: 1, cubes: ['c1'] },
    { id: 'g2', category: 'casual', line: 'Trousers', qty: 1, packed: 1, cubes: ['c2'] },
    { id: 'g3', category: 'formal', line: 'Suit', qty: 1, packed: 1, cubes: [''] },   // uncubed
    { id: 'g2', category: 'smart_casual', line: 'Trousers', qty: 1, packed: 1, cubes: [''] }, // genuinely unplaced
  ],
  generics: [
    { category: 'casual', typeKey: 'tee', name: 'T-shirts', qty: 3, packed: 2, cubes: ['c2','c2'] },
  ],
};
showTripsyCubeContents(() => state, null);
const ov = nodes['tw-cube-contents-overlay'];
const listHtml = ov.innerHTML;

assert(/Blue Medium/.test(listHtml), 'the list names each cube');
assert((listHtml.match(/data-tw-open-cube="c1"/g) || []).length === 2,
  'each cube exposes TWO triggers -- its picture and its name');
assert(/data-tw-open-cube=""/.test(listHtml), 'the "Cube not set" block is drillable too');
assert(!/Navy suit/.test(listHtml), 'an uncubed suit is still absent from "Cube not set"');
assert(/Chinos/.test(listHtml), 'but a genuinely unplaced garment is listed');

// --- drill into c1 ---
const click = target => ov.onclick({ target: { closest: sel => {
  const m = sel.match(/^\[([a-z-]+)(?:="(.*)")?\]$/);
  const attr = m[1], want = m[2];
  if (target.attr !== attr) return null;
  if (want !== undefined && target.val !== want) return null;
  return { getAttribute: () => target.val, dataset: {} };
} } });

photosPainted = 0;
click({ attr: 'data-tw-open-cube', val: 'c1' });
const detail = ov.innerHTML;
assert(/<h2[^>]*>Blue Medium/.test(detail), 'the drill-down is titled with the cube -> ' + (detail.match(/<h2[^>]*>([^<]*)/)||[])[1]);
assert(/Dress shirts/.test(detail), 'it lists the garment inside');
assert(/×3/.test(detail), 'and totals copies across tiers as x3');
assert(/data-tw-photo="photoA"/.test(detail), 'a real garment renders its PHOTO slot');
assert(photosPainted === 1, 'and the photo loader is invoked');
assert(/3 items/.test(detail), 'the header counts the items');
assert(!/Chinos/.test(detail), 'a garment in another cube is not shown');

// --- Close returns to the LIST, it does not shut the page ---
click({ attr: 'data-tw-cubes-close' });
assert(ov.style.display !== 'none', 'Close from a drill-down does not close the overlay');
assert(/data-tw-open-cube="c1"/.test(ov.innerHTML), 'it returns to the list of cubes');
// --- Close again from the list DOES shut it ---
click({ attr: 'data-tw-cubes-close' });
assert(ov.style.display === 'none', 'Close from the list closes the page');

// --- a photoless garment falls back to its glyph, and the unplaced pseudo-cube opens ---
showTripsyCubeContents(() => state, null);
ov.onclick && click({ attr: 'data-tw-open-cube', val: '' });
const orphanDetail = ov.innerHTML;
assert(/Cube not set/.test(orphanDetail), 'the unplaced pseudo-cube drills down');
assert(/Chinos/.test(orphanDetail) && !/Navy suit/.test(orphanDetail),
  'showing the unplaced chinos but not the uncubed suit');
assert(/tw-photo-glyph/.test(orphanDetail), 'a photoless garment falls back to a glyph');
