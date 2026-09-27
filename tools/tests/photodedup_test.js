// "There are many duplicate photos on the partial itinerary for Singapore
// GP. When a photo has already been used for an event other than a
// transportation event or ps reservation, we should not re-use a photo
// unless the event is exactly the same as the prior event using the photo
// except on a different day." (2026-09-27). Duplicates piled up because the
// dedup only ever ran on a photo's FIRST fetch: two events cached the same
// photo in different generations (or concurrently in one -- the build fans
// out via Promise.all) and the cached branch then showed both verbatim
// forever. Three changes: the used-photo Sets became MAPS of name/hash ->
// owning cacheKey; buildTripsyPrintHtml pre-claims every cached photo in
// DOCUMENT order before any card builds (so ownership is deterministic no
// matter how the async builds interleave); and the cached branch now swaps
// a photo owned by a DIFFERENT event to an unused alternative during a
// generation-time render. The "same event on another day" exemption falls
// out of the cacheKey itself (name/address/title/hint -- no day), and the
// transportation/P/S exceptions are structural: those cards never route
// through tripsyDedupedPlacePhotoUrl at all.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) return null;
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

// ---- source shape ----
assert(/const usedPlacePhotoNames = new Map\(\);\s*\n\s*const usedPlacePhotoHashes = new Map\(\);/.test(html),
  'the used-photo registries are MAPS (name/hash -> owning cacheKey), so a collision can tell "same event again" from "different event"');
assert(/for \(const preDayKey of dayKeys\) \{/.test(html)
  && /if \(item\.isLayover \|\| item\.psReservation\) continue;/.test(html)
  && /if \(!raw \|\| \(raw\.resource !== 'hosting' && raw\.resource !== 'activity'\)\) continue;/.test(html)
  && /if \(ev\._splitHalf === 'end'\) continue;/.test(html),
  'THE FIX: a document-order pre-pass claims cached photos before the concurrent card builds -- skipping layovers, P/S rows, transportation (repeats by design) and split -end halves, exactly like the card dispatch');
const dedup = extractFn('tripsyDedupedPlacePhotoUrl');
assert(/collidesWithOtherEvent && _tripsyAllowPhotoFetch\) \{/.test(dedup) && !/_tripsyAllowPhotoFetch \|\| isOwner/.test(dedup),
  'the swap runs ONLY under the fetch gate -- the owner\'s opens get it via the BACKGROUND maintenance rebuild (tripsyBackgroundPhotoMaintenance), never in front of the first paint ("Why is there a delay when I open my partial itinerary?")');
assert(/_tripsyDedupExhausted\.has\(cacheKey\)\) return null;/.test(dedup) && /_tripsyDedupExhausted\.add\(cacheKey\);/.test(dedup),
  'an exhausted candidate pool is remembered for the session -- the icon stays without re-running the fruitless search on every rebuild');
// The fourth report's two structural holes: the cover header and
// transportation cards, whose photos never routed through the dedup maps.
assert(/const coverKey = tripsyPlacePhotoCacheKey\(hr\.name \|\| heroEvent\.summary, hr\.address \|\| '', heroEvent\.summary, ''\);/.test(html)
  && html.indexOf('const coverKey = tripsyPlacePhotoCacheKey') < html.indexOf('// Deterministic ownership pre-pass'),
  'the COVER header claims its photo before the pre-pass -- the most prominent image keeps it, and the hotel\'s own card is the one that swaps');
assert(/const ownedByPlace = entryNow && !entryNow\.ownerPinned && \(/.test(html)
  && /Transportation place-collision swap failed \(keeping photo\)/.test(html),
  'a transportation card whose photo is OWNED by a place/cover swaps to a different company candidate (livery-checked, serialized, never over a pinned pick) -- same-company repeats across legs stay by design');
assert(/if \(photoDataUrl && _tripsyAllowPhotoFetch && !_tripsyDedupExhausted\.has\(cacheKey\)\)/.test(html),
  'the transport collision check runs only in the maintenance pass and honors the session exhaustion memory');
assert(/async function tripsyBackgroundPhotoMaintenance\(tripKey, buildOpts, firstHtml, applyRepaint\)/.test(html)
  && /tripsyBackgroundPhotoMaintenance\(tripKey, undefined, html, freshHtml => \{/.test(html)
  && /tripsyBackgroundPhotoMaintenance\(tripKey, \{ partialKeys: keys, summaryOnly: false \}, html, freshHtml => \{/.test(html),
  'both owner surfaces (Preview and the partial overlay) run the maintenance rebuild AFTER their cached fast paint, repainting only if it changed something');
assert(/let _tripsyPhotoClaimChain = Promise\.resolve\(\);/.test(html)
  && (dedup.match(/tripsyClaimPlacePhotoSerially\(async \(\) => \{/g) || []).length === 2,
  'THE THIRD-REPORT FIX: both claim paths (collision swap AND first-fetch decision) run through ONE serial chain -- parallel siblings were all picking the same "first unused" candidate');
assert(/\(nameOwner !== undefined && nameOwner !== cacheKey\)/.test(dedup),
  'THE ASK\'s exemption: a photo owned by this SAME event (same cacheKey -- same name/title/address, any day) is never a collision');

// ---- executed: the cached-branch collision logic ----
(async () => {
  const src = extractFn('tripsyDedupedPlacePhotoUrl').replace(/^async function /, 'var tripsyDedupedPlacePhotoUrl = async function ');
  // The claim chain the function routes its swaps/decisions through.
  const chainHelperSrc = html.match(/let _tripsyPhotoClaimChain = Promise\.resolve\(\);[\s\S]*?\n\}/)[0]
    .replace('let _tripsyPhotoClaimChain', 'var _tripsyPhotoClaimChain')
    .replace('function tripsyClaimPlacePhotoSerially', 'var tripsyClaimPlacePhotoSerially = function ');

  const run = async ({ cached, names = [], hashes = [], allowFetch = true, owner = true, alt = null, fresh = null }) => {
    const calls = { recached: [], altSearches: 0 };
    let entry = cached;
    const usedNames = new Map(names);
    const usedHashes = new Map(hashes);
    const f = new Function('nameArg', 'usedNames', 'usedHashes', 'calls', 'entryRef', 'altArg', 'freshArg',
      '_tripsyAllowPhotoFetch', 'isOwner', 'tripsyPlacePhotoCacheKey', 'Store', 'fetchTripsyPlacePhoto',
      'tripsyFindUnusedPlacePhoto', 'tripsyHashBlob', 'console',
      'var tripsyPlacePhotoCacheDirty = false;\nvar _tripsyDedupExhausted = new Set();\n' + chainHelperSrc + '\n' + src
      + '\nreturn tripsyDedupedPlacePhotoUrl(nameArg, "addr", "title", "", usedNames, usedHashes);');
    const url = await f('Place', usedNames, usedHashes, calls, null, alt, fresh,
      allowFetch, owner,
      (n, a, t, h) => `key:${n}|${a}|${t}|${h}`,
      {
        getTripsyPlacePhoto: async () => (entry && entry.driveFileId ? entry : (fresh || entry)),
        cacheTripsyPlacePhotoLocal: (k, fields) => { calls.recached.push(fields); entry = fields; },
      },
      async () => 'cached-url',
      async () => { calls.altSearches++; return alt; },
      async () => 'h-x', console);
    return { url, calls, usedNames, usedHashes };
  };

  const KEY = 'key:Place|addr|title|';
  const cached = { driveFileId: 'd1', photoName: 'P1', contentHash: 'H1', triedPhotoNames: ['P1'] };
  const altPhoto = { driveFileId: 'd2', photoName: 'P9', contentHash: 'H9', photoDataUrl: 'alt-url' };

  // THE LIVE BUG: another event already owns this cached photo -> swap to an
  // unused alternative from this place's own pool, re-cached so every later
  // open shows the new photo with no further work.
  let r = await run({ cached, names: [['P1', 'key:OTHER']], alt: altPhoto });
  assert(r.url === 'alt-url' && r.calls.recached.length === 1 && r.calls.recached[0].photoName === 'P9'
    && r.usedNames.get('P9') === KEY,
    'THE FIX: a cached photo already used by a DIFFERENT event swaps to an unused alternative and claims it');
  assert(r.calls.recached[0].triedPhotoNames.includes('P1'),
    'the rejected duplicate is remembered as tried, so Try Another cannot bounce straight back to it');

  // Same photo, same EVENT (the pre-pass claimed it under this very key --
  // e.g. the same titled activity on three different days): kept verbatim.
  r = await run({ cached, names: [['P1', KEY]], hashes: [['H1', KEY]] });
  assert(r.url === 'cached-url' && r.calls.recached.length === 0 && r.calls.altSearches === 0,
    'THE ASK\'s exemption: the exact same event on a different day keeps its photo -- no swap, no search');

  // Hash collision catches what the name token misses (two tokens, same bytes).
  r = await run({ cached, hashes: [['H1', 'key:OTHER']], alt: altPhoto });
  assert(r.url === 'alt-url', 'a byte-identical photo under a different Places token is still a collision (contentHash)');

  // Collision but every candidate for this place is already used elsewhere:
  // icon fallback beats repeating another event's photo.
  r = await run({ cached, names: [['P1', 'key:OTHER']], alt: null });
  assert(r.url === null && r.calls.recached.length === 0,
    'with no unused candidate left, the card falls back to its icon rather than repeat another event\'s photo');

  // With the gate off (a FAST cached paint -- the owner's, or any viewer's)
  // the duplicate shows verbatim and costs nothing; the owner's background
  // maintenance rebuild (gate on) is where it heals, off the critical path.
  r = await run({ cached, names: [['P1', 'key:OTHER']], allowFetch: false, alt: altPhoto });
  assert(r.url === 'cached-url' && r.calls.altSearches === 0,
    'the fast first paint never pays for a swap -- "There should be nothing to generate on an open"');
})();

// ---- executed: CONCURRENT colliding cards take DIFFERENT alternatives ----
// The live third-report shape: five Four Seasons Tented Camp activities all
// cached with one photo; the heal ran, but the swaps raced (Promise.all card
// building) and every one picked the same "first unused" candidate -- the
// duplicates just moved to a new photo. Serialized claims fix it: each swap
// sees every earlier swap's registration.
(async () => {
  const chainSrc = html.match(/let _tripsyPhotoClaimChain = Promise\.resolve\(\);[\s\S]*?\n\}/)[0]
    .replace('let _tripsyPhotoClaimChain', 'var _tripsyPhotoClaimChain')
    .replace('function tripsyClaimPlacePhotoSerially', 'var tripsyClaimPlacePhotoSerially = function ');
  const dedupSrc = extractFn('tripsyDedupedPlacePhotoUrl').replace(/^async function /, 'var tripsyDedupedPlacePhotoUrl = async function ');
  const factory = new Function('deps',
    'var { tripsyPlacePhotoCacheKey, Store, fetchTripsyPlacePhoto, tripsyFindUnusedPlacePhoto, tripsyHashBlob } = deps;\n'
    + 'var _tripsyAllowPhotoFetch = true, isOwner = true, tripsyPlacePhotoCacheDirty = false;\nvar _tripsyDedupExhausted = new Set();\n'
    + 'var console = deps.console;\n'
    + chainSrc + '\n' + dedupSrc + '\nreturn tripsyDedupedPlacePhotoUrl;');

  const entries = {
    'key:hike|camp|hike|': { driveFileId: 'd2', photoName: 'SHARED', contentHash: 'H-SHARED', fetchedAt: new Date().toISOString() },
    'key:dinner|camp|dinner|': { driveFileId: 'd3', photoName: 'SHARED', contentHash: 'H-SHARED', fetchedAt: new Date().toISOString() },
    'key:tour|camp|tour|': { driveFileId: 'd4', photoName: 'SHARED', contentHash: 'H-SHARED', fetchedAt: new Date().toISOString() },
  };
  const pool = ['ALT-A', 'ALT-B', 'ALT-C']; // the camp listing's other photos
  const usedNames = new Map([['SHARED', 'key:first|camp|first|']]); // pre-pass: the first card owns the shared photo
  const usedHashes = new Map([['H-SHARED', 'key:first|camp|first|']]);
  const dedup = factory({
    tripsyPlacePhotoCacheKey: (n, a, t, h) => `key:${n}|${a}|${t}|${h}`,
    Store: {
      getTripsyPlacePhoto: async k => entries[k] || null,
      cacheTripsyPlacePhotoLocal: (k, fields) => { entries[k] = fields; },
    },
    fetchTripsyPlacePhoto: async () => 'cached-url',
    // Mimics the real pool walk against the LIVE maps, with a real await so
    // the race is genuine: without serialization all three see the same
    // snapshot and all return ALT-A.
    tripsyFindUnusedPlacePhoto: async (n, a, t, h, names, hashes) => {
      await new Promise(res => setTimeout(res, 5));
      const pick = pool.find(p => !names.has(p) && !hashes.has('H-' + p));
      return pick ? { photoName: pick, contentHash: 'H-' + pick, driveFileId: 'D-' + pick, photoDataUrl: 'url-' + pick } : null;
    },
    tripsyHashBlob: async () => 'h-x',
    console,
  });
  const [u1, u2, u3] = await Promise.all([
    dedup('hike', 'camp', 'hike', '', usedNames, usedHashes),
    dedup('dinner', 'camp', 'dinner', '', usedNames, usedHashes),
    dedup('tour', 'camp', 'tour', '', usedNames, usedHashes),
  ]);
  const got = [u1, u2, u3].sort().join(',');
  assert(got === 'url-ALT-A,url-ALT-B,url-ALT-C',
    `THE THIRD-REPORT FIX: three concurrent colliding cards take three DIFFERENT alternatives (got: ${got})`);
  assert(usedNames.get('ALT-A') !== usedNames.get('ALT-B') && usedNames.get('ALT-B') !== usedNames.get('ALT-C'),
    'each alternative is claimed by its own event, so later builds keep the assignment stable');
})();
