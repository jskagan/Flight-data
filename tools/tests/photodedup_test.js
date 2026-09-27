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
assert(/collidesWithOtherEvent && \(_tripsyAllowPhotoFetch \|\| isOwner\)/.test(dedup),
  'a cached duplicate swaps on any OWNER render -- "There are still duplicate photos" came from the plain Preview open, which never runs under the generation gate; a viewer\'s open stays untouched');
assert(/\(nameOwner !== undefined && nameOwner !== cacheKey\)/.test(dedup),
  'THE ASK\'s exemption: a photo owned by this SAME event (same cacheKey -- same name/title/address, any day) is never a collision');

// ---- executed: the cached-branch collision logic ----
(async () => {
  const src = extractFn('tripsyDedupedPlacePhotoUrl').replace(/^async function /, 'var tripsyDedupedPlacePhotoUrl = async function ');

  const run = async ({ cached, names = [], hashes = [], allowFetch = true, owner = true, alt = null, fresh = null }) => {
    const calls = { recached: [], altSearches: 0 };
    let entry = cached;
    const usedNames = new Map(names);
    const usedHashes = new Map(hashes);
    const f = new Function('nameArg', 'usedNames', 'usedHashes', 'calls', 'entryRef', 'altArg', 'freshArg',
      '_tripsyAllowPhotoFetch', 'isOwner', 'tripsyPlacePhotoCacheKey', 'Store', 'fetchTripsyPlacePhoto',
      'tripsyFindUnusedPlacePhoto', 'tripsyHashBlob', 'console',
      'var tripsyPlacePhotoCacheDirty = false;\n' + src
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

  // The OWNER's plain open (no fetch gate) swaps too -- the live "still
  // duplicate photos" report was the fully-generated itinerary's Preview,
  // which never runs under the generation gate.
  r = await run({ cached, names: [['P1', 'key:OTHER']], allowFetch: false, owner: true, alt: altPhoto });
  assert(r.url === 'alt-url' && r.calls.recached.length === 1,
    'THE FIX (round 2): the owner\'s plain Preview open heals a duplicate too -- no generation required');

  // A VIEWER's open never swaps: they have no Places key to find an
  // alternative with, and the owner\'s next open fixes it for everyone.
  r = await run({ cached, names: [['P1', 'key:OTHER']], allowFetch: false, owner: false, alt: altPhoto });
  assert(r.url === 'cached-url' && r.calls.altSearches === 0,
    'a viewer\'s open shows the cached photo untouched');
})();
