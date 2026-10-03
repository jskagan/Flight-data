// "The buttons to select individual trips from the my trips page are reacting
// very slowly" (2026-10-03). Every trip tap re-runs renderTripsyEventsListImpl,
// which awaited listTripsyOfflineDocsMeta -> openTripsyOfflineDb, and that opened
// a FRESH IndexedDB connection on every call and never closed it (a photo-heavy
// itinerary piled up dozens). Now: one memoized connection per page, and the
// render waits at most 300ms on the lookup before using the last-known set.
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

function makeOpen(behavior) {
  const stats = { opens: 0, dbs: [] };
  const window = { indexedDB: {} };
  const indexedDB = {
    open() {
      stats.opens++;
      const req = {};
      const db = { objectStoreNames: { contains: () => true }, close() { this.closed = true; } };
      stats.dbs.push(db);
      setTimeout(() => {
        if (behavior() === 'fail') { req.error = new Error('nope'); req.onerror && req.onerror(); }
        else { req.result = db; req.onsuccess && req.onsuccess(); }
      }, 1);
      return req;
    },
  };
  const fn = new Function('window', 'indexedDB', `const TRIPSY_OFFLINE_DB_NAME='x', TRIPSY_OFFLINE_STORE='a', TRIPSY_OFFLINE_APP_STORE='b', TRIPSY_OFFLINE_PHOTO_STORE='c';\n${extractFn('openTripsyOfflineDb')}\nreturn openTripsyOfflineDb;`)(window, indexedDB);
  return { fn, stats };
}

(async () => {
  {
    const { fn, stats } = makeOpen(() => 'ok');
    const [a, b] = await Promise.all([fn(), fn()]);
    const c = await fn();
    assert(stats.opens === 1 && a === b && b === c,
      'THE FIX: concurrent and later callers share ONE connection -- a trip tap no longer pays a fresh open (opens=' + stats.opens + ')');
    a.onclose();
    const d = await fn();
    assert(stats.opens === 2 && d !== a, 'a connection the browser closes is forgotten, and the next call reopens');
    d.onversionchange();
    assert(d.closed === true, 'a version upgrade elsewhere still closes this connection (never the blocker)');
    await fn();
    assert(stats.opens === 3, '...and the memo is cleared so the next call opens fresh');
  }
  {
    let n = 0;
    const { fn, stats } = makeOpen(() => (n++ === 0 ? 'fail' : 'ok'));
    let threw = false;
    try { await fn(); } catch (e) { threw = true; }
    const db = await fn();
    assert(threw && db && stats.opens === 2, 'a FAILED open is not remembered -- the next call retries');
  }

  // ---- the render never waits on the lookup for long ----
  const impl = extractFn('renderTripsyEventsListImpl');
  assert(/await Promise\.race\(\[\s*offlineMetaLookup,\s*new Promise\(r => setTimeout\(\(\) => r\(tripsyOfflineDocIdsLastKnown\), 300\)\),\s*\]\)/.test(impl),
    'the My Trips render waits at most 300ms on the offline-doc lookup, then uses the last-known set');
  assert(!/await listTripsyOfflineDocsMeta\(\)/.test(impl), 'the render no longer awaits the lookup unbounded');
  assert(/tripsyOfflineDocIdsLastKnown = new Set\(list\.map\(d => d\.driveFileId\)\)/.test(impl),
    'every completed lookup refreshes the last-known set for the next render');
})();
