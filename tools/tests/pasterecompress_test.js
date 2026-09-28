// "Please also compress the image I uploaded - and any other stored photos"
// (2026-09-28). Only PASTED photos can be oversized -- Places media is
// fetched at maxWidthPx=800 and the wardrobe/cube/diary pickers resize
// before upload -- and pastes made before the paste path resized uploaded
// raw clipboard bytes (a real one: a 2.8MB PNG). tripsyRecompressPastedPhotos
// sweeps the photo cache once per session (owner-only, from
// runBackgroundSyncs), recompresses any 'user-pasted-' entry still over the
// paste path's own 400KB threshold, preserves every flag (a pinned pick
// stays pinned, just smaller), and stamps recompressedAt so no later
// session re-reads the bytes.
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

// ---- wiring ----
assert(/try \{ await tripsyRecompressPastedPhotos\(\); \}/.test(html),
  'the sweep runs from runBackgroundSyncs (owner-only, background), next to the folder-migration precedent');
assert(/let _tripsyPasteRecompressDone = false;/.test(html),
  'once per session -- the sweep never re-walks the cache within one session');

// ---- executed: the sweep itself ----
(async () => {
  const src = extractFn('tripsyRecompressPastedPhotos');
  if (!src) { assert(false, 'could not extract tripsyRecompressPastedPhotos'); return; }
  const calls = { downloads: [], uploads: [], saves: [], locals: [] };
  const blobOf = size => ({ size, type: 'image/png' });
  const env = {
    isOwner: true,
    driveData: { tripsyPlacePhotoCache: {
      // The real shape: the pinned 2.8MB pasted airport photo.
      'black sprinter van|||transport': { driveFileId: 'big1', photoName: 'user-pasted-123', contentHash: 'h1', ownerPinned: true, liveryChecked: true },
      // A small paste needs no new upload, just the checked stamp.
      'small place|||': { driveFileId: 'small1', photoName: 'user-pasted-456', contentHash: 'h2' },
      // A large PLACES photo is impossible by construction (800px fetches) -- never touched.
      'ordinary place|||': { driveFileId: 'places1', photoName: 'places/x/photos/y', contentHash: 'h3' },
      // Already stamped: never re-read.
      'done place|||': { driveFileId: 'done1', photoName: 'user-pasted-789', contentHash: 'h4', recompressedAt: '2026-09-28T00:00:00Z' },
    } },
  };
  const fileSizes = { big1: 2883773, small1: 120000 };
  const f = new Function('calls', 'env', 'fileSizes', `
    var _tripsyPasteRecompressDone = false;
    var isOwner = env.isOwner;
    var driveData = env.driveData;
    var tripsyPlacePhotoCacheDirty = false;
    var tripsyGetCachedPhotoBlob = async id => null; // cold device: no local blob
    var downloadDriveFileBlob = async id => { calls.downloads.push(id); return { size: fileSizes[id], type: 'image/png' }; };
    var tripsyResizeImageBlob = async (blob, maxDim, q) => ({ size: Math.round(blob.size / 10), type: 'image/jpeg', maxDim, q });
    var tripsyHashBlob = async blob => 'hash-of-' + blob.size;
    var uploadTripsyPlacePhotoToDrive = async (blob, type) => { calls.uploads.push({ size: blob.size, type }); return 'new-' + blob.size; };
    var Store = {
      saveTripsyPlacePhoto: async (key, fields) => { calls.saves.push({ key, fields }); driveData.tripsyPlacePhotoCache[key] = fields; return true; },
      cacheTripsyPlacePhotoLocal: (key, fields) => { calls.locals.push({ key, fields }); driveData.tripsyPlacePhotoCache[key] = fields; },
    };
    ${src.replace(/^async function /, 'var tripsyRecompressPastedPhotos = async function ')}
    return { run: tripsyRecompressPastedPhotos, dirty: () => tripsyPlacePhotoCacheDirty };
  `)(calls, env, fileSizes);
  await f.run();

  assert(calls.downloads.join(',') === 'big1,small1',
    'only unstamped user-pasted entries are read -- a Places photo and an already-stamped paste cost nothing (got: ' + calls.downloads.join(',') + ')');
  assert(calls.uploads.length === 1 && calls.uploads[0].size === Math.round(2883773 / 10),
    'THE FIX: the oversized paste (the real 2.8MB pinned airport photo shape) is recompressed and re-uploaded');
  const saved = calls.saves[0];
  assert(calls.saves.length === 1 && saved.key === 'black sprinter van|||transport'
    && saved.fields.ownerPinned === true && saved.fields.liveryChecked === true
    && saved.fields.photoName === 'user-pasted-123' && !!saved.fields.recompressedAt
    && saved.fields.driveFileId !== 'big1' && saved.fields.contentHash !== 'h1',
    "the replacement preserves every flag -- the owner's pin stays their pick, just smaller -- with a new driveFileId/contentHash and the checked stamp");
  const smallStamp = calls.locals.find(l => l.key === 'small place|||');
  assert(!!smallStamp && smallStamp.fields.driveFileId === 'small1' && !!smallStamp.fields.recompressedAt && f.dirty() === true,
    'an already-small paste keeps its file and just gets the stamp, in memory (the next ordinary photo-cache flush carries it)');
  assert(!env.driveData.tripsyPlacePhotoCache['ordinary place|||'].recompressedAt,
    'a Places-sourced entry is left completely untouched');

  await f.run();
  assert(calls.downloads.length === 2, 'a second call in the same session is a no-op (session guard)');
})();
