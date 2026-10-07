// "Let's make a one-step process for swapping one garment for another so the new one
// automatically replaces the old one everywhere the old one was used" (2026-10-07).
// Synthetic fixtures only.
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

// ---- scaffold: in-memory driveData + the real Store shapes these functions touch ----
function makeWorld({ failOutfits = false } = {}) {
  const driveData = {
    tripsyTripWardrobe: { t1: [
      { id: 'old', category: 'casual', line: 'Tops', qty: 2, packed: 2, cubes: ['c1', 'c2'] },
      { id: 'old', category: 'smart_casual', line: 'Tops', qty: 1, packed: 0, cubes: [] },
      { id: 'new', category: 'smart_casual', line: 'Tops', qty: 1, packed: 1, cubes: ['c3'] },
      { id: 'other', category: 'casual', line: 'Bottoms', qty: 1, packed: 1, cubes: ['c1'] },
    ] },
    tripsyTripOutfits: [
      { tripKey: 't1', person: 'him', blocks: [
        { dayKey: '2026-10-10', category: 'casual', garmentIds: ['old', 'other'] },
        { dayKey: '2026-10-11', category: 'smart_casual', garmentIds: ['new', 'old'] }, // new already there
        { dayKey: '2026-10-12', category: 'casual', garmentIds: ['other'] },
      ] },
      { tripKey: 't1', person: 'her', blocks: [{ dayKey: '2026-10-10', category: 'casual', garmentIds: ['old'] }] },
    ],
    tripsyShipHome: [
      { tripKey: 't1', person: 'him', dayKey: '2026-10-11', box: { 'g:old': 1, 'g:other': 1 }, shippedAt: null },
      { tripKey: 't1', person: 'him', dayKey: '2026-10-09', box: { 'g:old': 1 }, shippedAt: '2026-10-09T10:00:00Z' },
    ],
  };
  const syncCalls = [];
  const Store = {
    async getTripWardrobe(tripKey) { return [...((driveData.tripsyTripWardrobe || {})[tripKey] || [])]; },
    async setTripWardrobe(tripKey, ids) { driveData.tripsyTripWardrobe[tripKey] = [...ids]; return true; },
    async getTripsyTripOutfits(tripKey, person) { return driveData.tripsyTripOutfits.find(o => o.tripKey === tripKey && o.person === person) || null; },
    async saveTripsyTripOutfits(o) { if (failOutfits) return false; return true; },
    async getTripsyAttireGuide() { return { days: [] }; },
    listTripsyShipHome(tripKey) { return driveData.tripsyShipHome.filter(r => r.tripKey === tripKey); },
    async saveTripsyShipHome(tripKey, person, dayKey, box) {
      const prev = driveData.tripsyShipHome.find(r => r.tripKey === tripKey && r.person === person && r.dayKey === dayKey);
      driveData.tripsyShipHome = driveData.tripsyShipHome.filter(r => r !== prev).concat([{ tripKey, person, dayKey, box, shippedAt: prev && prev.shippedAt }]);
      return true;
    },
  };
  const api = new Function('driveData', 'Store', 'tripsyOutfitSyncFlightTransfers',
    [fnSource('tripsyCubesForEntry'), fnSource('tripsyNormalizeTripSelection'), fnSource('tripsyReplaceGarmentEverywhere'), fnSource('tripsyGarmentTripUsage'),
     'return { replace: tripsyReplaceGarmentEverywhere, usage: tripsyGarmentTripUsage };'].join('\n'))(
    driveData, Store, (guide, outfits, block) => syncCalls.push(block.dayKey));
  return { driveData, api, syncCalls };
}

(async () => {
  // ---- usage, for the picker's heading ----
  {
    const { api } = makeWorld();
    const u = await api.usage('t1', 'him', 'old');
    assert(u.lines === 2 && u.outfits === 2 && u.boxes === 1, `usage counts lines/outfits/PLANNED boxes (got ${JSON.stringify(u)})`);
    assert(u.tiers.sort().join(',') === 'casual,smart_casual', 'usage lists the tiers the garment is used at');
  }
  // ---- THE ASK: one call, every store ----
  {
    const { driveData, api, syncCalls } = makeWorld();
    const counts = await api.replace('t1', 'him', 'old', 'new');
    assert(counts.lines === 2 && counts.outfits === 2 && counts.boxes === 1, `THE ASK: reports what it touched (got ${JSON.stringify(counts)})`);
    const sel = driveData.tripsyTripWardrobe.t1;
    assert(!sel.some(e => e.id === 'old'), 'the old garment is gone from the Packing List');
    const casual = sel.find(e => e.id === 'new' && e.category === 'casual');
    assert(casual && casual.qty === 2 && casual.packed === 2 && casual.cubes.join(',') === 'c1,c2', 'a line allocation moves to the new garment with its qty, packed count and cubes intact');
    const sc = sel.filter(e => e.id === 'new' && e.category === 'smart_casual');
    assert(sc.length === 1 && sc[0].qty === 2 && sc[0].packed === 1 && sc[0].cubes.join(',') === 'c3', 'two allocations that collapse onto one key merge (qty summed, packed summed, cubes kept)');
    assert(sel.find(e => e.id === 'other'), 'unrelated allocations are untouched');
    const him = driveData.tripsyTripOutfits.find(o => o.person === 'him').blocks;
    assert(him[0].garmentIds.join(',') === 'new,other', 'an outfit wearing the old garment now wears the new one in its place');
    assert(him[1].garmentIds.join(',') === 'new', 'an outfit already holding the new garment just drops the old one, never duplicated');
    assert(him[2].garmentIds.join(',') === 'other', 'an outfit without the old garment is untouched');
    assert(syncCalls.sort().join(',') === '2026-10-10,2026-10-11', 'the flight/airport-ride sync re-runs on each changed block');
    const her = driveData.tripsyTripOutfits.find(o => o.person === 'her').blocks;
    assert(her[0].garmentIds.join(',') === 'old', "the other person's outfits are not touched");
    const planned = driveData.tripsyShipHome.find(r => r.dayKey === '2026-10-11');
    assert(planned.box['g:new'] === 1 && !planned.box['g:old'] && planned.box['g:other'] === 1, 'a PLANNED ship-home box holds the new garment instead');
    const shipped = driveData.tripsyShipHome.find(r => r.dayKey === '2026-10-09');
    assert(shipped.box['g:old'] === 1 && !shipped.box['g:new'], 'a box already SHIPPED is history and is left alone');
  }
  // ---- a failure rolls every store back ----
  {
    const { driveData, api } = makeWorld({ failOutfits: true });
    let threw = false;
    try { await api.replace('t1', 'him', 'old', 'new'); } catch (e) { threw = true; }
    assert(threw, 'a failed outfit save throws');
    assert(driveData.tripsyTripWardrobe.t1.filter(e => e.id === 'old').length === 2, 'the Packing List is restored to its snapshot');
    assert(driveData.tripsyTripOutfits.find(o => o.person === 'him').blocks[0].garmentIds.join(',') === 'old,other', 'the outfits are restored');
    assert(driveData.tripsyShipHome.find(r => r.dayKey === '2026-10-11').box['g:old'] === 1, 'the ship-home boxes are restored');
  }
  // ---- guards ----
  {
    const { api } = makeWorld();
    let threw = false;
    try { await api.replace('t1', 'him', 'old', 'old'); } catch (e) { threw = true; }
    assert(threw, 'replacing a garment with itself is refused');
    const counts = await api.replace('t1', 'him', 'nobody', 'new');
    assert(counts.lines === 0 && counts.outfits === 0 && counts.boxes === 0, 'a garment not in use touches nothing');
  }
  // ---- the entry points ----
  const modal = fnSource('showTripsyOutfitModal');
  assert(/data-tw-outfit-replace="\$\{esc\(g\.id\)\}"/.test(modal) && /tripsyRunReplaceGarment\(tripKey, person, old\)/.test(modal),
    'the outfit modal card has an owner-only Replace button that runs the one-step replace');
  assert(/isOwner \? `<button class="btn" data-tw-outfit-swap=[\s\S]*?data-tw-outfit-replace/.test(modal), 'Replace sits beside Swap, owner-only');
  const card = fnSource('tripsyWardrobeCardHtml');
  assert(/opts\.replaceable \? `<button class="btn" data-tw-replace=/.test(card), 'the shared garment card can carry a Replace button');
  const pack = fnSource('tripsyWardrobePackForTrip');
  assert(/replaceable: isOwner && sel\.has\(selKey\(g\.id, tier, ln\.name\)\) && !tripsyWardrobeGarmentIsPlaceholder\(g\)/.test(pack),
    'the Packing List offers Replace on a SELECTED real garment only');
  assert(/closest\('\[data-tw-replace\]'\)/.test(pack) && /tripsyWardrobePackForTrip\(tripKey, tripName, person, onClose, lnNow \? \{ tier: view\.tier, lineName: lnNow\.name \} : null\)/.test(pack),
    'after a replace the Packing List reopens on the same line from the saved stores');
  const picker = fnSource('tripsyReplaceGarmentPicker');
  assert(/tripsyAttirePackingGroupOf\(g\) === group/.test(picker) && /g\.id !== oldGarment\.id/.test(picker), 'the picker offers same-kind garments only, old one excluded');
  assert(/zIndex = '2147483099'/.test(picker), 'the picker clears the outfit modal and its pickers (below the confirm dialog)');
  assert(/Not tagged for/.test(picker), 'a candidate not tagged for a used tier says so rather than being hidden');
  const run = fnSource('tripsyRunReplaceGarment');
  assert(/toast\(`Could not replace the garment/.test(run) && /nothing was changed/.test(run), 'a failure is toasted with its reason');
})();
