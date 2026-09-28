// "Some of the photos I posted into the itinerary did not save" (2026-09-28).
// They DID save -- and were then destroyed: the owner pasted one stage image
// onto several concert cards, the background photo-maintenance dedup read the
// later cards as forbidden duplicates of the first (same contentHash, a
// DIFFERENT cacheKey), swapped each to a random Places photo, and the
// cache-replace hook deleted the pasted bytes from Drive. Root cause: the
// paste handler stamped ownerPinned on TRANSPORTATION cards only, so a pasted
// place photo had none of the pin's protections. Now: every paste stamps
// ownerPinned (liveryChecked stays transport-only), and the shared
// tripsyPlacePhotoEntryIsPinned check -- honored by both the dedup collision
// swap and fetchTripsyPlacePhoto's TTL refetch -- also recognizes the
// 'user-pasted-' photoName itself, so pastes saved BEFORE the stamp existed
// (the live cache holds several) are protected with no data migration.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
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

// ---- the paste save stamps the pin on EVERY card kind ----
{
  const pasteBlock = html.slice(html.indexOf('if (pasteBtn) {'), html.indexOf('if (galleryBtn) {'));
  assert(/photoName: `user-pasted-\$\{Date\.now\(\)\}`/.test(pasteBlock)
    && /ownerPinned: true,\s*\n\s*\.\.\.\(isTransportCard \? \{ liveryChecked: true \} : \{\}\)/.test(pasteBlock),
    'THE FIX: a paste stamps ownerPinned unconditionally -- place and transportation cards alike -- while liveryChecked stays transport-only');
}

// ---- executed: the shared pin check ----
const isPinned = new Function(`${extractFn('tripsyPlacePhotoEntryIsPinned')} return tripsyPlacePhotoEntryIsPinned;`)();
assert(isPinned({ ownerPinned: true, photoName: 'places/x/photos/y' }) === true
  && isPinned({ photoName: 'user-pasted-1790577971690' }) === true,
  'pinned = the ownerPinned flag, OR a user-pasted photoName (a paste saved before place cards stamped the flag)');
assert(isPinned({ photoName: 'places/x/photos/y' }) === false && isPinned(null) === false && isPinned({}) === false,
  'an ordinary auto-fetched entry, an empty entry and null all read unpinned');

// ---- executed: a pinned cached entry is exempt from the collision swap ----
(async () => {
  const chainSrc = html.match(/let _tripsyPhotoClaimChain = Promise\.resolve\(\);[\s\S]*?\n\}/)[0]
    .replace('let _tripsyPhotoClaimChain', 'var _tripsyPhotoClaimChain')
    .replace('function tripsyClaimPlacePhotoSerially', 'var tripsyClaimPlacePhotoSerially = function ');
  const dedupSrc = extractFn('tripsyDedupedPlacePhotoUrl').replace(/^async function /, 'var tripsyDedupedPlacePhotoUrl = async function ');
  const run = async (cached) => {
    const calls = { recached: 0, altSearches: 0 };
    const f = new Function('usedNames', 'usedHashes', 'calls', 'cached',
      'tripsyPlacePhotoCacheKey', 'Store', 'fetchTripsyPlacePhoto', 'tripsyFindUnusedPlacePhoto', 'tripsyHashBlob', 'console',
      'var _tripsyAllowPhotoFetch = true, isOwner = true, tripsyPlacePhotoCacheDirty = false;\nvar _tripsyDedupExhausted = new Set();\n'
      + extractFn('tripsyPlacePhotoEntryIsPinned') + '\n' + chainSrc + '\n' + dedupSrc
      + '\nreturn tripsyDedupedPlacePhotoUrl("Concert", "addr", "title", "", usedNames, usedHashes);');
    // Another event already OWNS this photo's name and hash -- the exact live
    // shape (the same pasted image on several concert cards).
    const url = await f(
      new Map([[cached.photoName, 'key:OTHER']]), new Map([[cached.contentHash, 'key:OTHER']]), calls, cached,
      (n, a, t, h) => `key:${n}|${a}|${t}|${h}`,
      {
        getTripsyPlacePhoto: async () => cached,
        cacheTripsyPlacePhotoLocal: () => { calls.recached++; },
      },
      async () => 'cached-url',
      async () => { calls.altSearches++; return { photoName: 'ALT', contentHash: 'H-ALT', driveFileId: 'D-ALT', photoDataUrl: 'alt-url' }; },
      async () => 'h-x', console);
    return { url, calls };
  };

  let r = await run({ driveFileId: 'd1', photoName: 'user-pasted-111', contentHash: 'H1', ownerPinned: true });
  assert(r.url === 'cached-url' && r.calls.recached === 0 && r.calls.altSearches === 0,
    'THE ASK: a PINNED paste colliding with another event\'s photo is kept VERBATIM -- no swap, no search, no re-cache (pasting the same image onto several events is a deliberate choice)');
  r = await run({ driveFileId: 'd1', photoName: 'user-pasted-1790577971690', contentHash: 'H1' });
  assert(r.url === 'cached-url' && r.calls.recached === 0 && r.calls.altSearches === 0,
    'RETROACTIVE: a paste saved before the flag existed (user-pasted photoName, no ownerPinned) is protected the same way');
  r = await run({ driveFileId: 'd1', photoName: 'places/x/photos/y', contentHash: 'H1' });
  assert(r.url === 'alt-url' && r.calls.altSearches === 1,
    'an ordinary auto-fetched duplicate still swaps -- the dedup fix this rides on is untouched for unpinned photos');
})();

// ---- executed: a pinned entry never TTL-refetches ----
(async () => {
  const fetchSrc = extractFn('fetchTripsyPlacePhoto');
  assert(/fresh \|\| !_tripsyAllowPhotoFetch \|\| tripsyPlacePhotoEntryIsPinned\(cached\)/.test(fetchSrc),
    'fetchTripsyPlacePhoto treats a pinned entry as always fresh -- a TTL refetch could only swap the owner\'s choice for something else');
  const calls = { fetches: 0 };
  const f = new Function('calls', 'Store', 'tripsyPlacePhotoDisplayUrl', 'tripsyPlacePhotoCacheKey', 'console',
    'var _tripsyAllowPhotoFetch = true, _tripsyAllowNewPlacePhotoFetch = false;\n'
    + 'var TRIPSY_PLACE_PHOTO_TTL_DAYS = 180;\n'
    + 'var tripsyFindFirstPlacePhotoName = async () => { calls.fetches++; return null; };\n'
    + extractFn('tripsyPlacePhotoEntryIsPinned') + '\n' + extractFn('fetchTripsyPlacePhoto')
    + '\nreturn fetchTripsyPlacePhoto("Concert", "addr", "title", "");');
  const stale = { driveFileId: 'd1', photoName: 'user-pasted-111', contentHash: 'H1', ownerPinned: true,
    fetchedAt: new Date(Date.now() - 400 * 86400000).toISOString() };
  const url = await f(calls,
    { getTripsyPlacePhoto: async () => stale, getPlacesApiKey: async () => 'key' },
    async () => 'display-url', (n, a, t, h) => `key:${n}|${a}|${t}|${h}`, console);
  assert(url === 'display-url' && calls.fetches === 0,
    'a pinned paste older than the 180-day TTL still shows verbatim under the fetch gate -- no refetch is ever attempted');
})();
