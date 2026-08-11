const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const fakeIDB = `
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
`;
const src = ['openTripsyOfflineDb','tripsyCacheTripsForOffline','loadTripsyOfflineTrips'].map(extractFn).join('\n');
const consts = "const TRIPSY_OFFLINE_DB_NAME='travel-tracker-offline';const TRIPSY_OFFLINE_STORE='tripsyDocs';const TRIPSY_OFFLINE_APP_STORE='appCache';";
const body = `
// Synthetic stand-in for trips-data.json: the original scratchpad version read
// the owner's REAL trip file, which must never be committed to this public
// repo. Shaped to exercise the same properties -- a >50-event trip, a transfer
// with a departure time, a hotel carrying tripsyExtra details.
const doc = { schemaVersion: 1, updatedAt: '2026-08-01T00:00:00Z', trips: [{
  key: 'tripsy-1148449', name: 'Fixture Trip', start: '2026-08-02', end: '2026-08-20', location: null,
  events: [
    { id: 'transportation-1', type: 'transportation', summary: "Car to Brown's Hotel", start: '2026-08-03T10:00:00', end: null, tripsyExtra: '', hidden: false, tripsyRaw: {} },
    { id: 'hosting-2', type: 'hotel', summary: "Brown's Hotel", start: '2026-08-03T15:00:00', end: '2026-08-08T11:00:00', tripsyExtra: 'Confirmation: ABC123 \u2022 +44 20 7493 6020', hidden: false, tripsyRaw: {} },
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
`;
fs.writeFileSync('offline_run.js', fakeIDB + consts + '\n' + src + '\n' + body);
