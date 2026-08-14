// "In the show outfit box, when you display images or cards for individual garments,
// add a wear days button to each garment box." Each garment card in showTripsyOutfitModal
// gets a "Wear Days" button, available to every viewer (read-only, same as the existing
// photo-tap-to-see-where-it's-packed lookup right next to it) -- unlike Swap, which stays
// owner-gated. Tapping it opens the SAME showTripsyWearDaysOverlay the Plan Packing
// List/Packing Status pages already use.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  const start = m.index;
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') paren++;
    else if (html[i] === ')') { paren--; if (!paren) { i++; break; } }
  }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const modal = extractFn('showTripsyOutfitModal');
assert(modal.includes('const cardHtml = cards.length'), 'sanity: extracted the real function');

// ---- source-pattern checks: the button renders on every card, unconditionally ----
assert(/<button class="btn" data-tw-outfit-weardays="\$\{esc\(g\.id\)\}">Wear Days<\/button>/.test(modal),
  'THE ASK: a Wear Days button is on every garment card');
const cardBlock = modal.slice(modal.indexOf('const cardHtml = cards.length'), modal.indexOf('No garments were assigned'));
assert(!/\$\{isOwner \? `<button class="btn" data-tw-outfit-weardays/.test(cardBlock),
  'unlike Swap, the Wear Days button is NOT behind the isOwner gate -- every viewer gets it');
assert(/\$\{isOwner \? `<button class="btn" data-tw-outfit-swap="\$\{esc\(g\.id\)\}">Swap<\/button>` : ''\}/.test(cardBlock),
  'Swap right next to it stays owner-gated, unchanged');

// ---- source-pattern checks: wiring closes the outfit modal before opening Wear Days ----
const wireBlock = modal.slice(modal.indexOf("data-tw-outfit-weardays]"), modal.indexOf('tripsyWardrobeLoadPhotos(ov);'));
assert(/const g = byId\.get\(btn\.dataset\.twOutfitWeardays\);/.test(wireBlock), 'looks up the real garment by id from the same byId map the cards were built from');
assert(/if \(!g\) return;/.test(wireBlock), 'a missing garment is a safe no-op');
assert(/close\(\);\s*\n\s*showTripsyWearDaysOverlay\(tripKey, g, person\);/.test(wireBlock),
  'THE FIX: closes this outfit modal FIRST, then opens Wear Days -- avoids the z-index cycle (Wear Days can itself reopen this same outfit-modal node)');

// ---- executed: the click-handler logic itself, against fixtures ----
(async () => {
  const run = async (garmentId, byIdMap) => {
    const calls = { closed: false, opened: null };
    const close = () => { calls.closed = true; };
    const showTripsyWearDaysOverlay = (tripKey, g, person) => { calls.opened = { tripKey, g, person }; };
    const byId = byIdMap;
    const tripKey = 'T1', person = 'him';

    // Mirrors the real handler's control flow exactly (pinned by the source-pattern
    // assertions above to this same shape).
    const g = byId.get(garmentId);
    if (!g) return calls;
    close();
    showTripsyWearDaysOverlay(tripKey, g, person);
    return calls;
  };

  const byId = new Map([['g1', { id: 'g1', name: 'Blue Polo' }]]);
  let r = await run('g1', byId);
  assert(r.closed === true, 'the outfit modal is closed before Wear Days opens');
  assert(r.opened && r.opened.g.name === 'Blue Polo', `THE ASK: Wear Days opens for the tapped garment -> ${JSON.stringify(r.opened)}`);

  r = await run('missing', byId);
  assert(r.closed === false && r.opened === null, 'a garment id not found in byId is a safe no-op -- nothing closes or opens');
})();
