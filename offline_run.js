
const _stores = {};
global.window = { indexedDB: true };
global.indexedDB = {
  open(name, ver) {
    const req = {};
    setTimeout(() => {
      const db = {
        objectStoreNames: { contains: n => !!_stores[n] },
        createObjectStore(n, o) { _stores[n] = { keyPath: o.keyPath, data: new Map() }; return _stores[n]; },
        transaction(n) {
          const st = _stores[n];
          const tx = { objectStore: () => ({
            put(rec) { st.data.set(rec[st.keyPath], rec); setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); },
            get(k) { const r = {}; setTimeout(() => { r.result = st.data.get(k); r.onsuccess && r.onsuccess(); }, 0); return r; },
          })};
          return tx;
        },
      };
      req.result = db;
      if (!_stores['tripsyDocs'] || !_stores['appCache']) { req.onupgradeneeded && req.onupgradeneeded(); }
      req.onsuccess && req.onsuccess();
    }, 0);
    return req;
  }
};
const TRIPSY_OFFLINE_DB_NAME='travel-tracker-offline';const TRIPSY_OFFLINE_STORE='tripsyDocs';const TRIPSY_OFFLINE_APP_STORE='appCache';const TRIPSY_OFFLINE_PHOTO_STORE='photoBlobs';
function openTripsyOfflineDb() {
  // ONE shared connection per page ("The buttons to select individual trips from
  // the my trips page are reacting very slowly," 2026-10-03): every caller used to
  // open a FRESH connection and never close it -- every My Trips render (each
  // trip tap) awaited a new open before it could paint, and a photo-heavy
  // itinerary piled up dozens of live connections. The promise is memoized on the
  // function itself (no module-level let, so the tests' extracted copy stays
  // self-contained); a failed open, or a connection the browser closes or that a
  // version upgrade elsewhere asks to close, clears the memo so the next call
  // simply opens again.
  if (openTripsyOfflineDb._p) return openTripsyOfflineDb._p;
  const p = new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(TRIPSY_OFFLINE_DB_NAME, 3);
    // Guarded creates, not an else-branch on oldVersion: a device upgrading from
    // v1 needs only the newer stores, a fresh device needs all, and this covers each.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRIPSY_OFFLINE_STORE)) db.createObjectStore(TRIPSY_OFFLINE_STORE, { keyPath: 'driveFileId' });
      if (!db.objectStoreNames.contains(TRIPSY_OFFLINE_APP_STORE)) db.createObjectStore(TRIPSY_OFFLINE_APP_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(TRIPSY_OFFLINE_PHOTO_STORE)) db.createObjectStore(TRIPSY_OFFLINE_PHOTO_STORE, { keyPath: 'driveFileId' });
    };
    // NONE of the open outcomes may strand the caller ("when I press the
    // continue button, nothing happens," 2026-09-28: the changes dialog's
    // Continue hung forever mid-photo-prefetch with its button disabled --
    // an open request BLOCKED by another tab/suspended WebView still
    // holding a pre-v3 connection fires NEITHER success nor error, so the
    // promise never settled and everything awaiting a photo hung with it).
    // Every IndexedDB consumer here is fail-soft by design, so rejecting
    // is always the right answer: blob cache misses fall back to the Drive
    // download, offline caching just doesn't happen.
    let settled = false;
    const settle = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const timer = setTimeout(() => settle(reject, new Error('IndexedDB open timed out')), 4000);
    req.onblocked = () => settle(reject, new Error('IndexedDB open blocked by another connection'));
    req.onsuccess = () => {
      const db = req.result;
      // And the mirror side: when ANOTHER context needs a version upgrade,
      // close this connection instead of being the blocker -- the next
      // openTripsyOfflineDb call simply opens a fresh one.
      const forget = () => { if (openTripsyOfflineDb._p === p) openTripsyOfflineDb._p = null; };
      db.onversionchange = () => { forget(); try { db.close(); } catch (e) {} };
      db.onclose = forget;
      settle(resolve, db);
    };
    req.onerror = () => settle(reject, req.error);
  });
  openTripsyOfflineDb._p = p;
  p.catch(() => { if (openTripsyOfflineDb._p === p) openTripsyOfflineDb._p = null; });
  return p;
}
async function tripsyCacheTripsForOffline(trips, updatedAt) {
  try {
    const db = await openTripsyOfflineDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(TRIPSY_OFFLINE_APP_STORE, 'readwrite');
      tx.objectStore(TRIPSY_OFFLINE_APP_STORE).put({
        key: 'trips', trips, updatedAt: updatedAt || null, cachedAt: new Date().toISOString(),
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (e) {
    console.error('tripsyCacheTripsForOffline failed (non-fatal):', e);
    return false;
  }
}
async function loadTripsyOfflineTrips() {
  try {
    const db = await openTripsyOfflineDb();
    const rec = await new Promise((resolve, reject) => {
      const tx = db.transaction(TRIPSY_OFFLINE_APP_STORE, 'readonly');
      const req = tx.objectStore(TRIPSY_OFFLINE_APP_STORE).get('trips');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    return (rec && Array.isArray(rec.trips) && rec.trips.length) ? rec : null;
  } catch (e) {
    console.error('loadTripsyOfflineTrips failed (non-fatal):', e);
    return null;
  }
}

// Synthetic stand-in for trips-data.json: the original scratchpad version read
// the owner's REAL trip file, which must never be committed to this public
// repo. Shaped to exercise the same properties -- a >50-event trip, a transfer
// with a departure time, a hotel carrying tripsyExtra details.
const doc = { schemaVersion: 1, updatedAt: '2026-08-01T00:00:00Z', trips: [{
  key: 'tripsy-1148449', name: 'Fixture Trip', start: '2026-08-02', end: '2026-08-20', location: null,
  events: [
    { id: 'transportation-1', type: 'transportation', summary: "Car to Brown's Hotel", start: '2026-08-03T10:00:00', end: null, tripsyExtra: '', hidden: false, tripsyRaw: {} },
    { id: 'hosting-2', type: 'hotel', summary: "Brown's Hotel", start: '2026-08-03T15:00:00', end: '2026-08-08T11:00:00', tripsyExtra: 'Confirmation: ABC123 • +44 20 7493 6020', hidden: false, tripsyRaw: {} },
    ...Array.from({ length: 55 }, (_, i) => ({ id: 'activity-' + (10 + i), type: 'other', summary: 'Event ' + i, start: '2026-08-0' + (4 + (i % 5)) + 'T0' + (i % 9) + ':00:00', end: null, tripsyExtra: '', hidden: false, tripsyRaw: {} })),
  ],
}] };
const TRIPS = doc.trips;
(async () => {
  const assert = (c,m) => { console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1; };
  assert(await loadTripsyOfflineTrips() === null, 'no cache initially -> null (offline entry not offered)');
  assert(await tripsyCacheTripsForOffline(TRIPS, doc.updatedAt) === true, 'caching trips succeeds');
  const rec = await loadTripsyOfflineTrips();
  assert(!!rec, 'cache reads back');
  assert(rec.trips.length === TRIPS.length, 'all ' + TRIPS.length + ' trips cached');
  assert(!!rec.cachedAt && !isNaN(Date.parse(rec.cachedAt)), 'cachedAt stamped -> ' + rec.cachedAt);
  assert(rec.updatedAt === doc.updatedAt, 'updatedAt preserved');
  const phil = rec.trips.find(t => t.key === 'tripsy-1148449');
  assert(!!phil && phil.events.length > 50, 'LA Phil trip intact (' + (phil ? phil.events.length : 0) + ' events)');
  const car = phil.events.find(e => (e.summary || '').includes("Brown's Hotel") && e.type === 'transportation');
  assert(!!car, 'transfer event present offline: ' + (car ? car.summary : 'MISSING'));
  assert(!!(car && car.start), 'its departure time survives: ' + (car ? car.start : ''));
  const hotel = phil.events.find(e => e.type === 'hotel' && e.tripsyExtra);
  assert(!!hotel, 'hotel with confirmation/phone details survives offline');
  console.log('DONE');
})();
