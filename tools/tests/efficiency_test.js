// Three load/save economies (2026-11-10): the easter-egg photos load on demand from
// sidecar files, My Trips renders that are still waiting share one render, and the
// startup syncs' "last synced" timestamps go up in one save instead of three.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  let depth = 0;
  for (let j = html.indexOf('{', html.indexOf(')', m.index)); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } };

// ---- photos on demand ----
assert(!/const (FOPBP_PHOTO|HATS_PHOTO)_B64/.test(html), 'the two overlay photos are no longer embedded in the page');
for (const [c, f] of [['FOPBP_PHOTO_URL', 'fopbp-photo.jpg'], ['HATS_PHOTO_URL', 'hats-photo.jpg']]) {
  assert(html.includes(`const ${c} = '${f}';`), `${c} names its sidecar file`);
  const bytes = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f)) : Buffer.alloc(0);
  assert(bytes.length > 10000 && bytes[0] === 0xFF && bytes[1] === 0xD8, `${f} exists beside index.html and is a JPEG`);
}
const show = extractFn('showOverlayPhoto');
assert(/img\.onload = \(\) => \{[\s\S]*overlay\.style\.display = 'flex'/.test(show) && /img\.onerror/.test(show), 'the overlay appears only once the picture has loaded, and a failed load shows nothing');

// ---- waiting renders are shared ----
(async () => {
  let impl = 0, release;
  const m = new Function('renderTripsyEventsListImpl', 'updateTripsyStatusBadge', 'tripsyScrollMyTripsToToday', 'isOwner',
    `let _tripsyEventsListRenderChain = Promise.resolve();\nlet _tripsyEventsListQueuedRender = null;\n${extractFn('renderTripsyEventsList')}\nreturn renderTripsyEventsList;`)(
    () => { impl++; return new Promise(r => { release = r; }); }, () => {}, () => {}, false);
  const a = m(), b = m(), c = m();
  assert(a === b && b === c, 'three calls in one tick share one render');
  await Promise.resolve(); await Promise.resolve();
  assert(impl === 1, 'which runs once');
  const d = m(), e = m();
  assert(d !== a && d === e, 'calls made while it is running share the NEXT render (it will paint their state)');
  release(); await a; await Promise.resolve(); await Promise.resolve();
  assert(impl === 2, 'that next render runs once, after the first finishes');
  release(); await d;
  const f = m();
  assert(f !== d, 'a call after everything settled starts a fresh render');
  await Promise.resolve(); await Promise.resolve(); release(); await f;

  // ---- startup timestamps: one save ----
  const batch = html.match(/let _syncTimestampBatching = false;\nlet _deferredSyncTimestamps = \{\};\n/)[0];
  const setTs = html.match(/async setSyncTimestamp\(key, iso\) \{[\s\S]*?\n  \},/)[0].replace(/,$/, '');
  const ctx = new Function(`
    let driveData = { syncTimestamps: {} }; let saves = 0;
    async function persistDriveData() { saves++; _deferredSyncTimestamps = {}; }
    async function persistTripsyNarrativeCacheWithRetry(fn) { fn(); await persistDriveData(); return true; }
    ${batch}
    ${extractFn('flushDeferredSyncTimestamps')}
    const Store = { ${setTs} };
    return { Store, flush: flushDeferredSyncTimestamps, saves: () => saves, data: () => driveData,
      batching: v => { _syncTimestampBatching = v; }, persist: persistDriveData };`)();
  await ctx.Store.setSyncTimestamp('reservations', 't1');
  assert(ctx.saves() === 1, 'outside the startup batch a timestamp saves at once (Force Sync is unchanged)');
  ctx.batching(true);
  await ctx.Store.setSyncTimestamp('reservations', 't2');
  await ctx.Store.setSyncTimestamp('psBalance', 't3');
  await ctx.Store.setSyncTimestamp('tripsyEmailScan', 't4');
  assert(ctx.saves() === 1 && ctx.data().syncTimestamps.psBalance === 't3', 'during the batch the three timestamps are recorded in memory with no save');
  ctx.batching(false); await ctx.flush();
  assert(ctx.saves() === 2, 'and one save at the end writes them all');
  await ctx.flush();
  assert(ctx.saves() === 2, 'nothing pending means no save');
  ctx.batching(true); await ctx.Store.setSyncTimestamp('psBalance', 't5'); await ctx.persist(); ctx.batching(false); await ctx.flush();
  assert(ctx.saves() === 3, 'a real save during the batch carries the timestamps, so the end adds none');
  const persist = extractFn('persistDriveData');
  assert(/driveDataRevision = newRev[^\n]*\n[^\n]*\n\s*_deferredSyncTimestamps = \{\};/.test(persist), 'only a SUCCESSFUL whole-file write clears what was held back');
  const bg = extractFn('runBackgroundSyncs');
  assert(/_syncTimestampBatching = true;\s*try \{/.test(bg) && /finally \{\s*_syncTimestampBatching = false;\s*try \{ await flushDeferredSyncTimestamps\(\)/.test(bg), 'the startup syncs run inside the batch and always flush, even after a failure');
  if (fails) process.exit(1);
})();
