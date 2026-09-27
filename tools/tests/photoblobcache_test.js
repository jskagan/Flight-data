// "When I close the app and then re-open, there is still a delay when I try
// to open the partial itinerary" (2026-09-27). The in-memory object-URL memo
// (tripsyPhotoObjectUrlCache) dies with the session, so a COLD app open
// re-downloaded every photo in the document from Drive before the build
// could return its HTML -- the one cost the fast-paint restructure couldn't
// remove, because the paint itself needs the bytes. Photo blobs now persist
// in IndexedDB (the offline DB's new v3 'photoBlobs' store, keyed by
// driveFileId): a cold open reads from disk, and only a photo this device
// has never shown costs a Drive round trip. A photo edit always mints a NEW
// driveFileId, so an entry can never go stale under its key -- only
// unreferenced, cleaned by the 180-day prune and the orphan-delete hook.
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

// ---- the store ----
assert(/indexedDB\.open\(TRIPSY_OFFLINE_DB_NAME, 3\)/.test(html),
  'the offline DB is at v3 for the new photoBlobs store');
assert(/const TRIPSY_OFFLINE_PHOTO_STORE = 'photoBlobs';/.test(html)
  && /if \(!db\.objectStoreNames\.contains\(TRIPSY_OFFLINE_PHOTO_STORE\)\) db\.createObjectStore\(TRIPSY_OFFLINE_PHOTO_STORE, \{ keyPath: 'driveFileId' \}\)/.test(html),
  'photoBlobs is a guarded create like the other stores, so v1/v2/fresh devices all upgrade correctly');

// ---- disk-first display path ----
const disp = extractFn('tripsyPlacePhotoDisplayUrl');
assert(/tripsyGetCachedPhotoBlob\(driveFileId\)/.test(disp)
  && disp.indexOf('tripsyGetCachedPhotoBlob') < disp.indexOf('downloadDriveFileBlob'),
  'THE FIX: disk first, Drive second -- a cold open paints from the persistent blob cache');
assert(/tripsyPutCachedPhotoBlob\(driveFileId, blob\)/.test(disp),
  'a Drive-downloaded photo is cached for the next cold open');
assert(/tripsyPruneCachedPhotoBlobs\(\)/.test(disp) && /let _tripsyPhotoBlobPruneDone = false;/.test(html),
  'the 180-day prune runs lazily, once per session, so the store cannot grow without bound');

// ---- seeding and cleanup ----
const up = extractFn('uploadTripsyPlacePhotoToDrive');
assert(/if \(driveFileId\) tripsyPutCachedPhotoBlob\(driveFileId, blob\);/.test(up),
  'every upload (fetches, dedup swaps, manual picks, pastes -- all one choke point) seeds the cache, so a photo just uploaded is never downloaded back');
assert(/tripsyDeleteCachedPhotoBlob\(prior\.driveFileId\);/.test(html),
  'the orphan-delete hook in cacheTripsyPlacePhotoLocal also drops the replaced photo\'s local blob');
// Fail-soft: every helper catches -- no IndexedDB keeps the old behavior.
assert(/async function tripsyGetCachedPhotoBlob[\s\S]*?catch \(e\) \{\s*\n\s*return null;/.test(html),
  'a cache read failure just falls back to the Drive download');

// ---- executed: hit vs miss vs memo ----
(async () => {
  const src = disp.replace(/^function /, 'var tripsyPlacePhotoDisplayUrl = function ');
  const calls = { idbGets: 0, downloads: 0, puts: 0, prunes: 0 };
  const idb = new Map([['warm', { name: 'warm-blob' }]]);
  const f = new Function('calls', 'idb',
    'var tripsyPhotoObjectUrlCache = new Map();\n'
    + 'var tripsyPruneCachedPhotoBlobs = () => { calls.prunes++; };\n'
    + 'var tripsyGetCachedPhotoBlob = async id => { calls.idbGets++; return idb.get(id) || null; };\n'
    + 'var tripsyPutCachedPhotoBlob = (id, blob) => { calls.puts++; idb.set(id, blob); };\n'
    + 'var downloadDriveFileBlob = async id => { calls.downloads++; return { name: "drive-" + id }; };\n'
    + 'var URL = { createObjectURL: blob => "blob:" + blob.name };\n'
    + src + '\nreturn tripsyPlacePhotoDisplayUrl;');
  const displayUrl = f(calls, idb);

  assert(await displayUrl('warm') === 'blob:warm-blob' && calls.downloads === 0,
    'THE FIX: a photo this device has shown before paints from disk -- zero Drive round trips on a cold open');
  assert(await displayUrl('cold') === 'blob:drive-cold' && calls.downloads === 1 && idb.has('cold'),
    'a never-seen photo downloads once and is cached for every later cold open');
  await displayUrl('warm'); await displayUrl('cold');
  assert(calls.idbGets === 2 && calls.downloads === 1,
    'the in-session memo still short-circuits repeats -- disk is only consulted once per photo per session');
})();
