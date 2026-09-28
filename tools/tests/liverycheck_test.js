// "The flight on Singapore airlines should show a picture of a plane from
// Singapore airlines, not a different airlines." (2026-09-27). A
// transportation card's photo comes from a Google PLACES listing (searching
// "Singapore Airlines" matches the airline's ticket office), and a listing's
// photos are whatever people uploaded there -- confirmed in the live cache:
// "singapore airlines|||transport" pointed at an LA-area place whose photo
// showed a different airline's plane. No query wording controls a listing's
// photo CONTENT, so the photo itself is now CHECKED with one small Claude
// vision call (tripsyTransportationPhotoAcceptable), both when fetching a
// new photo (walk the candidate pool, take the first that passes) and once
// for an already-cached unstamped entry during a generation-time render
// (the healing path that fixes the live Singapore Airlines entry).
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

// ---- the verifier ----
const verify = extractFn('tripsyTransportationPhotoAcceptable');
assert(!!verify, 'tripsyTransportationPhotoAcceptable exists');
assert(/\{ thinking: false, effort: 'low' \}/.test(verify),
  'a pure yes/no classification: thinking off, low effort (the attire events-call lesson -- sonnet-5 thinks by default)');
assert(/if \(!apiKey\) return true;/.test(verify) && /console\.error\('tripsyTransportationPhotoAcceptable failed \(accepting photo\)/.test(verify),
  'fails soft in every direction -- no Anthropic key or any error ACCEPTS the photo, so a card never loses its picture to a verifier hiccup');
assert(/tripsyResizeImageBlob\(blob, 512, 0\.8\)/.test(verify),
  'the image is resized small before the call, same as the outfit composer\'s photos');

// ---- the fetch/heal wiring ----
const fetchFn = extractFn('fetchTripsyTransportationPhoto');
assert(/company && _tripsyAllowPhotoFetch && cached\.liveryChecked === undefined/.test(fetchFn),
  'healing runs ONLY during a generation-time render, only with a company to contradict, and only once (any stamp, true or false, skips it)');
assert(/const MAX_LIVERY_CHECKS = 4;/.test(fetchFn),
  'the candidate walk is bounded so a pathological pool cannot burn a call per candidate');
assert(/\.\.\.\(company \? \{ liveryChecked: !!pick\.liveryChecked \} : \{\}\)/.test(fetchFn),
  'a passed pick stamps true, an exhausted fallback stamps FALSE (shown, but never re-healed -- the TTL refetch is its retry), a company-less entry stays unstamped');
// The owner's manual picks are their own judgment -- never overruled by
// healing, and PINNED ("can I just pick one for each airline and have the
// app use that everytime that airline is used in any itinerary,"
// 2026-09-27): ownerPinned makes the pick permanent -- no TTL refetch, no
// healing, shared across every trip via the per-company cache entry.
assert(/triedPhotoNames: \[\.\.\.tried, nextPhotoName\], liveryChecked: true, ownerPinned: true/.test(html),
  '🔄 Try Another stamps the owner\'s pick verified AND pinned');
assert(/triedPhotoNames: \[\.\.\.tried, photoName\], liveryChecked: true, ownerPinned: true/.test(html),
  '🔍 manual search stamps the owner\'s pick verified AND pinned');
assert((html.match(/\.\.\.\(isTransportCard \? \{ liveryChecked: true, ownerPinned: true \} : \{\}\)/g) || []).length === 1
  && /ownerPinned: true,\s*\n\s*\.\.\.\(isTransportCard \? \{ liveryChecked: true \} : \{\}\)/.test(html),
  '🗂 gallery picks on a transportation card stamp verified AND pinned; 📋 pastes pin EVERY card kind with liveryChecked still transport-only (pastedpin_test.js)');
const fetchSrc = extractFn('fetchTripsyTransportationPhoto');
assert(/if \(cached && cached\.driveFileId && cached\.ownerPinned\) \{/.test(fetchSrc)
  && fetchSrc.indexOf('cached.ownerPinned') < fetchSrc.indexOf('liveryChecked === undefined'),
  'THE ASK: a pinned photo returns VERBATIM before the TTL/healing logic can ever touch it -- one pick per airline, used every time');

// ---- executed: the fetch/heal decision logic against stubs ----
(async () => {
  const cacheKeySrc = 'var tripsyPlacePhotoCacheKey = (a,b,c,d) => [String(a).toLowerCase(),b,c,d].join("|");\n'
    + extractFn('tripsyTransportationPhotoCacheKey').replace(/^function /, 'var tripsyTransportationPhotoCacheKey = function ');
  const src = extractFn('fetchTripsyTransportationPhoto').replace(/^async function /, 'var fetchTripsyTransportationPhoto = async function ');

  // verdicts: photoName -> boolean the stub verifier returns (cached entry
  // verifies under the name 'CACHED-BYTES').
  const run = async (company, { cache = null, allowFetch = true, verdicts = {}, candidates = [] } = {}) => {
    const calls = { verified: [], cachedLocal: [], displayed: 0, uploads: 0 };
    let cacheEntry = cache;
    const f = new Function('company', 'category', 'calls', 'cacheEntryRef', 'verdicts', 'candidatesArg',
      '_tripsyAllowPhotoFetch', '_tripsyAllowNewPlacePhotoFetch', 'TRIPSY_PLACE_PHOTO_TTL_DAYS',
      'Store', 'tripsyPlacePhotoDisplayUrl', 'downloadDriveFileBlob', 'tripsyTransportationPhotoAcceptable',
      'tripsyGatherTransportationPhotoCandidates', 'tripsyFindFirstTransportationPhotoName',
      'tripsyFetchPlacePhotoBlob', 'tripsyHashBlob', 'uploadTripsyPlacePhotoToDrive', 'URL', 'console',
      'var tripsyPlacePhotoCacheDirty = false;\n'
      // The transfer-subject sentinels the exhausted-pool branch consults --
      // extracted from the real source, since a missing stub here once
      // crashed this suite mid-run and the runner silently swallowed it.
      + (html.match(/const TRIPSY_VAN_TRANSFER_PHOTO_SUBJECT = [^;]+;/) || [''])[0] + '\n'
      + (html.match(/const TRIPSY_HOTEL_TRANSFER_PHOTO_SUBJECT = [^;]+;/) || [''])[0] + '\n'
      + (html.match(/const TRIPSY_TRANSFER_PHOTO_SUBJECTS = [^;]+;/) || [''])[0] + '\n'
      + cacheKeySrc + '\n' + src
      + '\nreturn fetchTripsyTransportationPhoto(company, category);');
    const url = await f(company, 'airplane', calls, null, verdicts, candidates,
      allowFetch, false, 30,
      {
        getTripsyPlacePhoto: async () => cacheEntry,
        cacheTripsyPlacePhotoLocal: (k, fields) => { calls.cachedLocal.push(fields); cacheEntry = fields; },
        getPlacesApiKey: async () => 'places-key',
      },
      async () => { calls.displayed++; return 'display-url'; },
      async () => ({ name: 'CACHED-BYTES' }),
      async (c, blob) => { calls.verified.push(blob.name); return verdicts[blob.name] !== false; },
      async () => candidates,
      async () => candidates[0] || null,
      async (k, photoName) => ({ name: photoName, type: 'image/jpeg' }),
      async () => 'hash', async () => { calls.uploads++; return 'drive-id-new'; },
      { createObjectURL: () => 'blob:picked' }, console);
    return { url, calls, cacheEntry };
  };

  // New fetch, company present: first candidate fails the check, second
  // passes -> the second is cached, stamped verified.
  let r = await run('Singapore Airlines', { candidates: ['p1', 'p2', 'p3'], verdicts: { p1: false, p2: true } });
  assert(r.url === 'blob:picked' && r.cacheEntry.photoName === 'p2' && r.cacheEntry.liveryChecked === true
    && r.calls.verified.join(',') === 'p1,p2',
    'THE FIX: a wrong-airline candidate is rejected and the next one taken -- checked in order, stopping at the first pass');

  // Every candidate fails: the FIRST photo is still shown (a photo beats a
  // bare icon) but stamped false so healing never re-spends calls on it.
  r = await run('Singapore Airlines', { candidates: ['p1', 'p2'], verdicts: { p1: false, p2: false } });
  assert(r.cacheEntry.photoName === 'p1' && r.cacheEntry.liveryChecked === false,
    'nothing passing keeps the first photo, stamped liveryChecked:false -- shown, not re-healed');

  // Company-less leg: old first-photo path, zero verifier calls, no stamp.
  r = await run('', { candidates: ['p1'], verdicts: { p1: false } });
  assert(r.url === 'blob:picked' && r.calls.verified.length === 0 && !('liveryChecked' in r.cacheEntry),
    'a company-less leg keeps the old first-photo behavior -- there is no wrong airline to reject');

  // Healing, pass: the live Singapore Airlines case's happy twin -- a cached
  // pre-stamp entry verifies fine, gets stamped, and no refetch happens.
  const staleCache = { driveFileId: 'drive-old', photoName: 'OLD', fetchedAt: new Date().toISOString(), triedPhotoNames: ['OLD'] };
  r = await run('Singapore Airlines', { cache: { ...staleCache }, candidates: ['p2'], verdicts: { 'CACHED-BYTES': true } });
  assert(r.url === 'display-url' && r.cacheEntry.liveryChecked === true && r.cacheEntry.driveFileId === 'drive-old' && r.calls.uploads === 0,
    'a cached photo that passes is stamped once and kept -- no refetch, no re-check ever again');

  // Healing, fail: THE LIVE BUG -- the cached wrong-airline photo is
  // rejected and a different, verified photo replaces it; the old photoName
  // is remembered as tried so it cannot be re-picked.
  r = await run('Singapore Airlines', { cache: { ...staleCache }, candidates: ['OLD', 'p2'], verdicts: { 'CACHED-BYTES': false, p2: true } });
  assert(r.cacheEntry.photoName === 'p2' && r.cacheEntry.liveryChecked === true
    && r.cacheEntry.triedPhotoNames.includes('OLD') && r.calls.verified.join(',') === 'CACHED-BYTES,p2',
    'THE FIX: the cached wrong-airline photo is rejected once, replaced with a verified one, and never offered again');

  // A stamped entry (true OR false) is never re-checked.
  r = await run('Singapore Airlines', { cache: { ...staleCache, liveryChecked: false } });
  assert(r.url === 'display-url' && r.calls.verified.length === 0,
    'a stamped entry costs zero verifier calls on every later render');

  // THE ASK: an owner-PINNED photo is untouchable -- shown verbatim even
  // during a generation-time render, with the verifier, the candidate walk,
  // and the TTL refetch all skipped. (No liveryChecked stamp needed: the
  // pin check runs before healing even looks.)
  r = await run('Singapore Airlines', {
    cache: { driveFileId: 'drive-pin', photoName: 'MINE', ownerPinned: true, fetchedAt: '2020-01-01T00:00:00Z' },
    candidates: ['p2'], verdicts: { 'CACHED-BYTES': false, p2: true },
  });
  assert(r.url === 'display-url' && r.calls.verified.length === 0 && r.calls.uploads === 0,
    'a hand-picked airline photo is pinned: no re-check, no refetch, ever -- the same pick serves every itinerary');

  // Outside a generation-time render the cached photo shows untouched --
  // healing never runs on a plain open/print.
  r = await run('Singapore Airlines', { cache: { ...staleCache }, allowFetch: false });
  assert(r.url === 'display-url' && r.calls.verified.length === 0,
    'a plain open/print never verifies (or fetches) -- cached-only, exactly as before');
})();
