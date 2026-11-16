// "Add a menu item to the attire guide for each trip before the refresh option called
// 'Garment Location'. When the user presses it it should pull up a list of each packing
// cube used on that trip plus an option for 'Laundry'. If the user selects a cube, it
// should show every garment in that packing cube. If he selects laundry it should show
// all garments marked as needing cleaning" (2026-10-17). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const constLine = name => { const m = html.match(new RegExp(`const ${name} = [^\\n]*`)); if (!m) throw new Error('missing const ' + name); return m[0]; };

// ---- scaffold: the pure pieces, with the cube library + type helpers stubbed ----
const driveData = { tripsyPackingCubes: [
  { id: 'c1', color: 'Blue', size: 'Medium', brand: '' },
  { id: 'c2', color: 'Black', size: 'Large', brand: '' },
  { id: 'c3', color: 'Gray', size: 'Small', brand: '' }, // owned, unused on this trip
] };
const api = new Function('driveData', 'tripsyGarmentSkipsCube', 'tripsyGarmentTypeKey', [
  constLine('TRIPSY_CUBE_NONE'), constLine('TRIPSY_CUBE_FLIGHT_WORN'), constLine('TRIPSY_LOCATION_LAUNDRY'),
  fnSource('tripsyCubeById'), fnSource('tripsyCubeName'), fnSource('tripsyCubeContentsMap'),
  fnSource('tripsyGarmentLocationRows'), fnSource('tripsyGarmentLocationLaundryDay'), fnSource('tripsyGarmentLocationLaundryItems'),
  'return { contents: tripsyCubeContentsMap, rows: tripsyGarmentLocationRows, day: tripsyGarmentLocationLaundryDay, laundry: tripsyGarmentLocationLaundryItems, LAUNDRY: TRIPSY_LOCATION_LAUNDRY, NONE: TRIPSY_CUBE_NONE };',
].join('\n'))(driveData, name => /suit|tie/i.test(name || ''), name => (/shirt/i.test(name || '') ? 'shirt' : ''));

const garmentById = new Map([
  ['g1', { id: 'g1', name: 'Blue shirt', driveFileId: 'f1', group: 'tops' }],
  ['g2', { id: 'g2', name: 'Chinos', driveFileId: 'f2', group: 'pants' }],
  ['g3', { id: 'g3', name: 'Navy suit', driveFileId: 'f3', group: 'dress_wear' }],
]);
const selEntries = [
  { id: 'g1', category: 'casual', line: 'Tops', qty: 2, packed: 2, cubes: ['c1', 'c1'] },
  { id: 'g1', category: 'smart_casual', line: 'Tops', qty: 1, packed: 1, cubes: ['c2'] },
  { id: 'g2', category: 'casual', line: 'Bottoms', qty: 1, packed: 1, cubes: [''] },     // packed, cube never set
  { id: 'g3', category: 'formal', line: 'Suits', qty: 1, packed: 1, cubes: [''] },       // hangs -- never in a cube
];
const generics = [{ category: 'general', typeKey: 'socks', name: 'Socks', qty: 3, packed: 3, cubes: ['c1', 'c1', api.NONE], person: 'him' }];

// ---- the cube contents (shared with the Cubes page) ----
{
  const c = api.contents(selEntries, generics, garmentById);
  assert([...c.get('c1').values()].map(it => `${it.name}x${it.count}`).join(',') === 'Blue shirtx2,Socksx2', 'a cube lists every copy in it, real garments and generics alike');
  assert(c.get('c2').get('g:g1').count === 1, 'the same garment packed in a second cube shows there too');
  assert(c.get('').size === 1 && c.get('').has('g:g2'), 'a packed copy with no cube set lands in the unset bucket');
  assert(![...c.values()].some(m => m.has('g:g3')), 'a hanging garment (a suit) is never listed in any cube');
  assert(c.get(api.NONE).get('x:Socks').count === 1, 'the "No cube" choice is its own location');
  const page = fnSource('showTripsyCubeContents');
  assert(/const contents = tripsyCubeContentsMap\(selEntries, generics, garmentById\);/.test(page), 'the Cubes page reads the SAME map, so the two pages cannot disagree');
}
// ---- THE ASK: the list is each cube USED on the trip, plus Laundry ----
{
  const c = api.contents(selEntries, generics, garmentById);
  const rows = api.rows(c, driveData.tripsyPackingCubes);
  const ids = rows.map(r => r.id);
  assert(ids[0] === 'c1' && ids[1] === 'c2', 'cubes holding something list first, in library order');
  assert(!ids.includes('c3'), 'a cube the owner owns but has not used on this trip is NOT listed');
  assert(ids.includes(api.NONE) && ids.includes(''), 'the deliberate "No cube" choice and the unset bucket list when they hold something');
  assert(ids[ids.length - 1] === api.LAUNDRY, 'Laundry is always the last option');
  assert(rows[0].label === 'Blue Medium' && rows[0].count === 4, 'a row carries the cube\'s everyday name and how many items it holds');
  const empty = api.rows(new Map(), driveData.tripsyPackingCubes);
  assert(empty.length === 1 && empty[0].id === api.LAUNDRY, 'with nothing packed, Laundry is still offered');
}
// ---- the laundry day: the trip's own today, clamped to the trip ----
{
  const keys = ['2026-10-10', '2026-10-11', '2026-10-12'];
  assert(api.day(keys, '2026-10-11') === '2026-10-11', 'mid-trip: today');
  assert(api.day(keys, '2026-10-20') === '2026-10-12', 'after the trip: its last day (the final state of the laundry)');
  assert(api.day(keys, '2026-10-01') === null, 'before the trip: no day -- nothing has been worn');
  assert(api.day([], '2026-10-11') === null && api.day(keys, null) === null, 'no guide days or no today: no day');
}
// ---- laundry items merge a garment\'s "needed again" and "not needed" halves ----
{
  const items = api.laundry([
    { key: 'g:g1', name: 'Blue shirt', driveFileId: 'f1', typeKey: 'shirt', group: 'tops', count: 2, neededAgain: true },
    { key: 'g:g1::nn', name: 'Blue shirt', driveFileId: 'f1', typeKey: 'shirt', group: 'tops', count: 1, neededAgain: false },
    { key: 'x:Socks', name: 'Socks', driveFileId: '', typeKey: 'socks', group: '', count: 1, neededAgain: true },
  ]);
  assert(items.length === 2 && items[0].key === 'g:g1' && items[0].count === 3, 'THE ASK: a garment needing cleaning shows once, with every dirty copy counted');
  assert(items[1].key === 'x:Socks' && items[1].count === 1, 'generic lines count too');
}
// ---- the page and its menu item ----
{
  const page = fnSource('showTripsyGarmentLocation');
  assert(/tripsyLaundryItemsForDay\(tripKey, dayKey, p\)/.test(page) && /for \(const p of \['him', 'her'\]\)/.test(page),
    'Laundry uses the Daily Dress Guide\'s own dirty-garment judgement, for both people');
  assert(/tripsyTravelViewTodayKey\(trip, /.test(page), 'today is the TRIP\'s local today');
  assert(/view\.mode === 'cube' \|\| view\.mode === 'laundry'\) \{ view = \{ mode: 'list' \}; render\(\); return; \}/.test(page), 'Close is contextual: a drill-down goes back to the list');
  // "When a user selects garment location, bring up an option. Say location or search" (2026-11-16).
  assert(/let view = \{ mode: 'choose' \}/.test(page) && /opt\('list', '📦', 'By Bag'/.test(page) && /opt\('search', '🔍', 'Search'/.test(page), 'THE ASK: the page opens on By Bag / Search');
  assert(/view\.mode === 'list' \|\| view\.mode === 'search'\) \{ view = \{ mode: 'choose' \}; render\(\); return; \}/.test(page), 'Back from Location or Search returns to the choice');
  assert(/data-tw-location-search/.test(page) && /chipRow\('Type'/.test(page) && /chipRow\('Dress category'/.test(page), 'Search has a text box plus Type and Dress category filters');
  assert(/showTripsyGarmentCubeInfo\(tripKey, garmentEl\.getAttribute\('data-tw-location-garment'\), \{ zIndex: 2147483145, /.test(page), 'tapping a result shows its cube, above this page');
  // "also include a button that says change location" (2026-11-16)
  assert(/allowChange: true, onChanged: reloadContents/.test(page), 'the search result dialog offers Change location and refreshes By Bag after');
  {
    const info = fnSource('showTripsyGarmentCubeInfo');
    assert(/opts\.allowChange && isOwner && !tripsyGarmentSkipsCube\(g\.name\)/.test(info) && />Change location</.test(info), 'Change location: owner only, cubed garments only');
    assert(/showTripsyCubePicker\(g\.name, tripsyGarmentRelocateSlots\(entries, garmentId\), /.test(info), 'it opens the cube picker over every copy on the trip');
    assert(/const shape = list => list\.map\(e => \(\{ id: e\.id, category: e\.category, line: e\.line, qty: e\.qty, packed: [^}]*cubes:/.test(info) && /Store\.setTripWardrobe\(tripKey, shape\(next\)\)/.test(info), 'the save carries cubes');
    assert(!/await Store\.setTripWardrobe/.test(info) && /saving\.then\(ok => \{\s*if \(ok\) return;\s*driveData\.tripsyTripWardrobe\[tripKey\] = shape\(entries\);/.test(info), 'optimistic: repaint at once, save behind, undo on failure');
    assert(/onlyCubeIds: onTrip/.test(info) && /cubes = tripsyCubesSorted\(\)\.filter\(c => !only \|\| only\.has\(c\.id\)\)/.test(fnSource('showTripsyCubePicker')), 'only cubes in use on the trip are offered, and no New cube');
    const ids = new Function('tripsyCubeById', fnSource('tripsyTripCubeIds') + 'return tripsyTripCubeIds;')(id => (id === 'c1' || id === 'c2') ? { id } : null);
    assert([...ids([{ cubes: ['c1', ''] }, { cubes: ['__none__'] }], [{ cubes: ['c2'] }])].sort().join() === 'c1,c2', 'trip cubes: real cubes from garments and generic lines');
    const r = new Function('tripsyWardrobeLineIsFlightWorn', fnSource('tripsyGarmentRelocateSlots') + fnSource('tripsyGarmentRelocateApply') + 'return { s: tripsyGarmentRelocateSlots, a: tripsyGarmentRelocateApply };')(l => /flight/.test(l || ''));
    const entries = [
      { id: 'a', category: 'casual', line: 'Tops', qty: 2, packed: 1, cubes: ['c1'] },
      { id: 'b', category: 'casual', line: 'Tops', qty: 1, packed: 1, cubes: ['c1'] },
      { id: 'a', category: 'smart', line: 'Tops', qty: 1, packed: 0, cubes: [] },
      { id: 'a', category: 'casual', line: 'Top — wearing on the flight', qty: 1, packed: 1, cubes: ['f'] },
    ];
    assert(JSON.stringify(r.s(entries, 'a')) === '["c1","","" ]'.replace(' ', ''), 'slots: every copy across lines, the flight-worn copy left out');
    const next = r.a(entries, 'a', ['c2', '', 'c3']);
    assert(JSON.stringify(next[0].cubes) === '["c2"]' && next[0].packed === 1 && JSON.stringify(next[2].cubes) === '["c3"]' && next[2].packed === 1, 'the picks go back to their own lines');
    assert(next[1] === entries[1] && next[3] === entries[3], 'other garments and the flight-worn copy are untouched');
  }
  assert(/ov\.oninput = /.test(page) && /paintSearchResults\(\)/.test(page), 'typing refills only the results (the box keeps focus)');
  {
    const m = new Function('tripsyGarmentPackingGroups', 'tripsyWardrobeGarmentTiers', fnSource('tripsyGarmentSearchMatches') + fnSource('tripsyGarmentWhereText') + 'return { m: tripsyGarmentSearchMatches, w: tripsyGarmentWhereText };')(
      g => (/sweater/i.test(g.name) ? ['tops', 'outerwear'] : [g.group]), g => ((g.tiers || []).length ? g.tiers : ['general']));
    const polo = { name: 'Blue Polo', color: 'navy', group: 'tops', tiers: ['casual', 'gym'], person: 'him' };
    const sweater = { name: 'Gray Sweater', group: 'tops', tiers: ['smart_casual'], person: 'him' };
    const socks = { name: 'Socks', group: 'essentials', tiers: [], person: 'her' };
    assert(m.m(polo, {}) && m.m(socks, {}), 'no terms and no filters match everything');
    assert(m.m(polo, { text: 'polo BLUE' }) && !m.m(polo, { text: 'blue shirt' }), 'every typed word must appear in the name');
    assert(m.m(polo, { text: 'navy' }), 'the color is searched too');
    assert(m.m(polo, { groups: new Set(['tops']) }) && !m.m(polo, { groups: new Set(['pants']) }), 'Type filter');
    assert(m.m(sweater, { groups: new Set(['outerwear']) }), 'a sweater is found under outerwear as well as tops');
    assert(m.m(polo, { tiers: new Set(['gym']) }) && !m.m(sweater, { tiers: new Set(['gym']) }), 'Dress category filter (Gym)');
    assert(m.m(socks, { tiers: new Set(['general']) }), 'an untagged garment reads as General');
    assert(!m.m(socks, { person: 'him' }) && m.m(socks, { person: 'her' }), 'Whose filter');
    assert(m.w('Blue Polo', [{ label: 'Blue Medium', isCube: true, count: 1 }]) === 'Blue Polo: in the Blue Medium cube.', 'the dialog describes the cube');
    assert(m.w('Socks', [{ label: 'Blue Medium', isCube: true, count: 2 }, { label: 'No cube', isCube: false, count: 1 }]) === 'Socks: 2 in the Blue Medium cube; 1 no cube.', 'several places are counted');
  }
  assert(/tripsyBackOrCloseHtml\('data-tw-location-close', !!back\)/.test(page), 'the list closes with the red ✕; a drill-down shows ‹ Back');
  assert(/data-tw-photo=/.test(page) && /tripsyWardrobeLoadPhotos\(ov\)/.test(page), 'garments are shown as photo cards');
  const menuAt = html.indexOf(`data-tripsy-attire-nav="location"`);
  const refreshAt = html.indexOf(`data-tripsy-attire-nav="refresh"`);
  // Only the Laundry rows (2026-10-19) sit between it and Refresh now.
  const between = html.slice(menuAt, refreshAt);
  assert(menuAt > 0 && refreshAt > menuAt && !/data-tripsy-attire-nav="(?!laundry|laundryback)/.test(between.slice(40)), 'THE ASK: the 👔 menu item sits directly before Refresh (the Laundry rows aside)');
  assert(/attireHasGuide \? menuListButtonHtml\(`data-tripsy-attire-nav="location"[^`]*`, '📍', 'Garment Location'\)/.test(html), 'labelled "Garment Location", shown once a guide exists (any viewer)');
  assert(/case 'location': showTripsyGarmentLocation\(key, name\); break;/.test(html), 'pressing it opens the page');
}
