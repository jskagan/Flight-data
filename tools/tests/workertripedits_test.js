// "I want to ... give voice commands in a chat session and those will get
// automatically integrated into travel tracker" (2026-11-23). A chat leaves its
// changes as tripsy-trip-edits.json; the auth Worker's Cron Trigger now applies
// that file every minute, so nothing waits for the app to be opened.
//
// The Worker is a SECOND writer of trips-data.json, which this suite pins three
// ways: (1) its apply logic is a byte-for-byte copy of the app's (the mirror),
// (2) the same relay run through the app's drain and the Worker's gives the same
// trips, and (3) the Drive flow -- guarded save, replay, conflict, bad input --
// against an in-memory Drive. Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const mirror = require('../auth-worker/mirror.js');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const workerSrc = fs.readFileSync(path.join(__dirname, '../auth-worker/worker.js'), 'utf8');
const toml = fs.readFileSync(path.join(__dirname, '../auth-worker/wrangler.toml'), 'utf8');
let failed = false;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) { failed = true; process.exitCode = 1; } };
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  if (!m) return null;
  const start = m.index;
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) { if (html[i] === '(') paren++; else if (html[i] === ')') { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const clone = v => JSON.parse(JSON.stringify(v));

// ---- 1. the mirror ----
const block = mirror.buildBlock(html);
assert(mirror.currentBlock(workerSrc) === block,
  'THE MIRROR: the Worker\'s copy of the app\'s edit logic is byte-identical to index.html (run node tools/auth-worker/mirror.js if this fails)');
assert(['applyTripsyChangeToTrips', 'tripsyRawToDisplay', 'tripsyTripEditCreateIdentity', 'TRIPSY_TRIP_EDIT_KNOWN_TYPES'].every(n => mirror.MIRROR_NAMES.includes(n)),
  'the mirror carries the apply function, the display derivation and the replay identity');
const keys = mirror.editFieldKeys(html.split('\n'));
assert(keys.activity.includes('name') && keys.activity.includes('agentName') && keys.hosting.includes('endsAt')
  && keys.transportation.includes('departureAt') && keys.transportation.includes('seatNumber') && keys.transportation.includes('agency'),
  'a blank event starts with the app\'s own field keys, travel-agent fields included');

// ---- wiring ----
assert(/async scheduled\(event, env, ctx\)/.test(workerSrc) && /ctx\.waitUntil\(editsDrain\(env, Date\.now\(\), \{ onlyOnTrip: true \}\)/.test(workerSrc),
  'the Worker has a scheduled handler that runs the drain, gated on a trip being in progress');
assert(/\[triggers\]\s*\ncrons = \["\* \* \* \* \*"\]/.test(toml), 'wrangler.toml declares the every-minute Cron Trigger');
assert(/const EDITS_FILENAME = 'tripsy-trip-edits\.json';/.test(workerSrc) && /const TRIPSY_TRIP_EDITS_FILENAME = 'tripsy-trip-edits\.json';/.test(html),
  'the Worker and the app drain the same relay filename');
assert(/const EDITS_FOLLOWUP_FILENAME = 'tripsy-applied-edits\.json';/.test(workerSrc) && /const TRIPSY_APPLIED_EDITS_FILENAME = 'tripsy-applied-edits\.json';/.test(html),
  'the Worker writes, and the app drains, the same follow-up filename');
{
  const m = html.match(/DRIVE_SIMPLE_UPLOAD_MAX_BYTES = ([^;]+);/), w = workerSrc.match(/EDITS_SIMPLE_UPLOAD_MAX_BYTES = ([^;]+);/);
  assert(m && w && m[1].trim() === w[1].trim(), 'the Worker switches to a resumable upload at the same size the app does');
}

// ---- load the Worker with an in-memory Drive ----
function makeDrive() {
  const d = { files: [], seq: 1, calls: [], failUpload: false, onRevisionCheck: null };
  d.add = (name, content, extra = {}) => {
    const f = { id: 'f' + (d.seq++), name, mimeType: 'application/json', createdTime: `2030-01-01T00:00:${String(d.seq).padStart(2, '0')}Z`,
      modifiedTime: `2030-01-01T00:00:${String(d.seq).padStart(2, '0')}Z`, headRevisionId: 'r' + (d.seq++), parents: ['folder1'],
      content: typeof content === 'string' ? content : JSON.stringify(content), ...extra };
    d.files.push(f); return f;
  };
  d.byName = name => d.files.filter(f => f.name === name);
  d.json = name => { const f = d.byName(name)[0]; return f ? JSON.parse(f.content) : null; };
  const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[k] || null },
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body), text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  d.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const u = new URL(url);
    d.calls.push(`${method} ${u.pathname}${u.search}`);
    if (!/^Bearer tok$/.test((init.headers || {}).Authorization || '')) return res(401, {});
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const name = (u.searchParams.get('q').match(/name='([^']+)'/) || [])[1];
      return res(200, { files: d.byName(name).map(f => ({ id: f.id, mimeType: f.mimeType, createdTime: f.createdTime, modifiedTime: f.modifiedTime, headRevisionId: f.headRevisionId, parents: f.parents })) });
    }
    const idm = u.pathname.match(/\/files\/([^/]+)$/);
    const file = idm && d.files.find(f => f.id === idm[1]);
    if (u.pathname.startsWith('/upload/drive/v3/files') && method === 'POST') {
      const parts = String(init.body).split(/--tt[^\r\n-]+(?:--)?/).map(p => p.replace(/^\r\n/, '').replace(/\r\n$/, '')).filter(Boolean);
      const meta = JSON.parse(parts[0].split('\r\n\r\n')[1]);
      const f = d.add(meta.name, parts[1].split('\r\n\r\n')[1]);
      f.parents = meta.parents || [];
      return res(200, { id: f.id });
    }
    if (!file) return res(404, {});
    if (u.pathname.startsWith('/upload/')) {
      if (d.failUpload && file.name === 'trips-data.json') return res(500, {});
      file.content = init.body; file.headRevisionId = 'r' + (d.seq++);
      return res(200, { headRevisionId: file.headRevisionId });
    }
    if (method === 'GET' && u.searchParams.get('alt') === 'media') return res(200, file.content);
    if (method === 'GET') {
      if (d.onRevisionCheck && file.name === 'trips-data.json') { const fn = d.onRevisionCheck; d.onRevisionCheck = null; fn(file); }
      return res(200, { headRevisionId: file.headRevisionId });
    }
    if (method === 'PATCH') { file.name = JSON.parse(init.body).name; return res(200, { id: file.id }); }
    if (method === 'DELETE') { d.files = d.files.filter(f => f !== file); return res(204, {}); }
    return res(400, {});
  };
  // The owner's access token is already cached, so no Google token call is needed.
  d.kv = { store: { 'feed:access': 'tok', 'feed:trips': '[]' }, writes: 0,
    get: async k => (k in d.kv.store ? d.kv.store[k] : null),
    put: async (k, v) => { d.kv.writes++; d.kv.store[k] = v; },
    delete: async k => { d.kv.writes++; delete d.kv.store[k]; },
    list: async () => ({ keys: [] }) };
  d.env = { AUTH_KV: d.kv, GOOGLE_CLIENT_SECRET: 's', GOOGLE_CLIENT_ID: 'c', OWNER_EMAIL: 'owner@example.com' };
  return d;
}
function loadWorker(fetchImpl) {
  return new Function('fetch', workerSrc.replace(/export default/, 'const __worker =')
    + '\nreturn { editsApplyRelay, editsDrain, editsRunText, editsTripWindows, editsOnTrip, tripsyRawToDisplay, __worker };')(fetchImpl);
}

const ev = (resource, id, raw) => {
  const full = { resource, id, ...raw };
  return { id: `${resource}-${id}`, hidden: false, ...loadWorker(null).tripsyRawToDisplay(resource, full), tripsyRaw: full };
};
const baseTrips = () => [
  { key: 'trip-a', name: 'Test Trip', start: '2030-05-01', end: '2030-05-05', location: null, events: [
    ev('transportation', 1, { category: 'airplane', company: 'Test Air', transportNumber: 'TA1', departureDescription: 'Home (LAX)', arrivalDescription: 'London (LHR)', departureAt: '2030-05-01T21:00:00', arrivalAt: '2030-05-02T15:10:00' }),
    ev('hosting', 2, { name: 'Test Hotel', startsAt: '2030-05-02T15:00:00', endsAt: '2030-05-05T11:00:00', address: '1 Street, London' }),
    ev('activity', 3, { name: 'Museum', category: 'museum', startsAt: '2030-05-03T10:00:00', endsAt: '2030-05-03T12:00:00' }),
    ev('activity', 4, { name: 'Old Plan', category: 'tour', startsAt: '2030-05-04T10:00:00' }),
  ] },
  { key: 'trip-b', name: 'Other Trip', start: '2030-08-01', end: '2030-08-03', location: null, events: [] },
];
const relayEdits = () => [
  { type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'Dinner at Test Bistro', category: 'restaurant', startsAt: '2030-05-03T19:30:00', endsAt: '2030-05-03T21:00:00', address: '2 Road, London', timezone: 'Europe/London' } },
  { type: 'create_event', tripKey: 'trip-a', tripsyResource: 'transportation', fields: { category: 'train', departureDescription: 'Paddington', departureAt: '2030-05-04T09:00:00', arrivalDescription: 'Oxford', arrivalAt: '2030-05-04T09:55:00' } },
  { type: 'edit_event', eventKey: 'activity:3', changes: { startsAt: '2030-05-03T11:00:00', notes: 'Moved an hour later' } },
  { type: 'delete_event', eventKey: 'activity:4' },
  { type: 'edit_event', eventKey: 'activity:999', changes: { name: 'Ghost' } },
  { type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'Museum', startsAt: '2030-05-03T11:00:00' } },
  { type: 'create_event', tripKey: 'trip-gone', tripsyResource: 'activity', fields: { name: 'Orphan', startsAt: '2030-05-03T10:00:00' } },
  { type: 'create_trip', tripKey: 'trip-b', name: 'Again' },
  { type: 'move_event', eventKey: 'hosting:2', tripKey: 'trip-a', targetTripKey: 'trip-b' },
  { type: 'edit_trip', tripKey: 'trip-b', changes: { name: 'Other Trip (renamed)' } },
  { type: 'set_everything_on_fire' },
];
// Locally minted ids differ per run; compare everything else.
const normalize = trips => clone(trips).map(t => ({ ...t, events: t.events.map(e => {
  if (!(e.tripsyRaw.id > 1e12)) return e;
  return { ...e, id: `${e.tripsyRaw.resource}-NEW`, tripsyRaw: { ...e.tripsyRaw, id: 'NEW' } };
}) }));

(async () => {
  // ---- 2. the same relay through the APP's drain and the WORKER's ----
  const W = loadWorker(null);
  const out = W.editsApplyRelay(baseTrips(), relayEdits());
  const appRun = new Function('trips', 'edits', `
    ${block}
    tripsyDecryptedTrips = trips;
    var toast = () => {};
    var Store = { queueTripsyChange: async change => { applyTripsyChangeToTrips(change); return true; } };
    ${extractFn('applyTripsyTripEditsRelay')}
    return applyTripsyTripEditsRelay({ edits }).then(() => tripsyDecryptedTrips);
  `);
  const quiet = console.log; console.log = () => {};
  const appTrips = await appRun(baseTrips(), relayEdits());
  console.log = quiet;
  assert(JSON.stringify(normalize(out.trips)) === JSON.stringify(normalize(appTrips)),
    'PARITY: one relay (create, edit, delete, move, trip edit, replays, junk) leaves identical trips whether the app or the Worker applies it');
  assert(out.applied === 6 && out.skipped === 5 && out.failed === 0, `the Worker counts what it did: applied ${out.applied}, skipped ${out.skipped}, failed ${out.failed}`);
  const a = out.trips.find(t => t.key === 'trip-a'), b = out.trips.find(t => t.key === 'trip-b');
  const dinner = a.events.find(e => e.summary === 'Dinner at Test Bistro');
  assert(dinner && dinner.type === 'dining' && dinner.start === '2030-05-03T19:30:00' && dinner.location === '2 Road, London' && dinner.tripsyRaw.timezone === 'Europe/London'
    && dinner.tripsyRaw.phone === null && dinner.id === `activity-${dinner.tripsyRaw.id}`,
    'a created event carries the app\'s display fields, a blank for every unset field, and a locally minted id');
  const train = a.events.find(e => e.tripsyRaw.category === 'train');
  assert(train && train.type === 'transportation' && train.summary === 'Train from Paddington → Oxford' && train.location === 'Paddington → Oxford',
    'a created train leg gets the app\'s own title: ' + (train && train.summary));
  assert(a.events.find(e => e.id === 'activity-3').start === '2030-05-03T11:00:00' && !a.events.some(e => e.id === 'activity-4'),
    'an edit re-derives the display time and a delete removes the event');
  assert(a.events.map(e => e.start).join() === [...a.events.map(e => e.start)].sort().join(), 'events stay in time order');
  assert(b.events.length === 1 && b.events[0].id === 'hosting-2' && b.name === 'Other Trip (renamed)', 'a moved event keeps its id in the other trip');
  const byIdx = i => out.entries.find(e => e.index === i);
  assert(byIdx(0).status === 'applied' && byIdx(0).eventKey === `activity:${dinner.tripsyRaw.id}`,
    'the log entry for a create names the NEW event key, so a chat can edit it later');
  assert(byIdx(4).reason === 'event not found' && byIdx(5).reason === 'already exists as activity:3' && byIdx(6).reason === 'trip not found'
    && byIdx(7).reason === 'trip already exists' && byIdx(10).reason === 'unknown type',
    'every skip says why -- a duplicate names the event it matched');
  assert(JSON.stringify(out.followUps.map(f => f.type)) === JSON.stringify(['edit_event', 'delete_event', 'move_event'])
    && out.followUps[1].tripKey === 'trip-a' && out.followUps[2].targetTripKey === 'trip-b',
    'edits, deletes and moves are handed to the app for its derived-cache cleanup, with the trip the event was really in');
  // replay: nothing twice
  const again = W.editsApplyRelay(out.trips, relayEdits());
  assert(again.trips.find(t => t.key === 'trip-a').events.length === a.events.length && again.entries.filter(e => e.type === 'create_event').every(e => e.status === 'skipped'),
    'REPLAY: running the same relay again creates nothing twice');
  // worker-only validation
  const bad = W.editsApplyRelay(baseTrips(), [
    { type: 'create_event', tripKey: 'trip-a', tripsyResource: 'spaceship', fields: { name: 'X', startsAt: '2030-05-03T10:00:00' } },
    { type: 'edit_event', eventKey: 'activity:3', changes: { id: 77 } },
    { type: 'edit_trip', tripKey: 'trip-a', changes: { events: [] } },
    { type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'Good', startsAt: '2030-05-03T13:00:00' } },
  ]);
  assert(bad.failed === 3 && bad.applied === 1 && bad.trips[0].events.length === 5 && bad.trips[0].events.some(e => e.id === 'activity-3'),
    'an entry that would damage the file (unknown resource, a changed id, a wiped events list) fails alone; the rest still apply');
  const same = baseTrips();
  assert(W.editsApplyRelay(same, [{ type: 'delete_event', eventKey: 'activity:404' }]).trips === same, 'nothing applied -> the very same trips array (so nothing is saved)');

  // ---- 3. the Drive flow ----
  const tripsDoc = () => ({ schemaVersion: 1, updatedAt: '2030-01-01T00:00:00.000Z', trips: baseTrips() });
  {
    const d = makeDrive(); d.add('trips-data.json', tripsDoc());
    const run = await loadWorker(d.fetch).editsDrain(d.env);
    assert(run === null && d.calls.length === 1 && d.kv.writes === 0, 'IDLE TICK: no relay -> one Drive search, no KV write, nothing else');
  }
  // ---- only while a trip is in progress (the test trip's events run May 1-5, 2030) ----
  {
    const Wp = loadWorker(null);
    const win = Wp.editsTripWindows([...baseTrips(), { key: 'old', name: 'Old', events: [ev('activity', 70, { name: 'Past', startsAt: '2029-01-02T10:00:00' })] },
      { key: 'hid', name: 'Hidden', hidden: true, events: [ev('activity', 71, { name: 'H', startsAt: '2030-06-02T10:00:00' })] }], '2030-04-01');
    assert(JSON.stringify(win) === JSON.stringify([['2030-04-30', '2030-05-06'], ['2030-07-31', '2030-08-04']]),
      'a trip window runs from the day before its first event to the day after its last (a trip with no events yet uses its stored dates); finished and hidden trips have none');
    assert(Wp.editsOnTrip(win, '2030-04-30') && Wp.editsOnTrip(win, '2030-05-03') && Wp.editsOnTrip(win, '2030-05-06')
      && !Wp.editsOnTrip(win, '2030-04-29') && !Wp.editsOnTrip(win, '2030-05-07') && !Wp.editsOnTrip(null, '2030-05-03'),
      'on a trip = today inside a window, edges included');
    const during = Date.UTC(2030, 4, 3, 12), before = Date.UTC(2030, 3, 10, 12);
    const tick = async (d, nowMs) => { let p = null; await loadWorker(d.fetch).__worker.scheduled({}, d.env, { waitUntil: x => { p = x; } }); return p; };
    const realNow = Date.now;
    try {
      // off a trip, windows cached: one KV read, NO Drive call, relay left for the app
      Date.now = () => before;
      let d = makeDrive(); d.add('trips-data.json', tripsDoc()); d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
      d.kv.store['edits:tripWindows'] = JSON.stringify([['2030-04-30', '2030-05-06']]);
      await tick(d, before);
      assert(d.calls.length === 0 && d.kv.writes === 0 && d.byName('tripsy-trip-edits.json').length === 1,
        'NO TRIP IN PROGRESS: the timer makes no Drive call at all and leaves the relay for the app to apply on its next open');
      // off a trip, nothing cached: builds the windows once, still applies nothing
      d = makeDrive(); d.add('trips-data.json', tripsDoc()); d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
      await tick(d, before);
      assert(d.kv.store['edits:tripWindows'] === JSON.stringify([['2030-04-30', '2030-05-06'], ['2030-07-31', '2030-08-04']]) && d.kv.writes === 1
        && d.byName('tripsy-trip-edits.json').length === 1 && !d.calls.some(c => /trip-edits/.test(decodeURIComponent(c))),
        'with no cached windows it reads trips-data.json once to build them (one KV write per six hours), and still applies nothing off a trip');
      // on a trip: applies
      Date.now = () => during;
      d = makeDrive(); d.add('trips-data.json', tripsDoc()); d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
      d.kv.store['edits:tripWindows'] = JSON.stringify([['2030-04-30', '2030-05-06']]);
      await tick(d, during);
      assert(d.byName('tripsy-trip-edits.json').length === 0 && !d.json('trips-data.json').trips[0].events.some(e => e.id === 'activity-4'),
        'TRIP IN PROGRESS: the timer applies the relay');
      // an idle tick on a trip: one KV read, one Drive search, no KV write
      d = makeDrive(); d.add('trips-data.json', tripsDoc()); d.kv.store['edits:tripWindows'] = JSON.stringify([['2030-04-30', '2030-05-06']]);
      await tick(d, during);
      assert(d.calls.length === 1 && d.kv.writes === 0, 'an idle tick on a trip is one Drive search and no KV write');
      // a save refreshes the windows: a relayed trip that starts today is noticed
      d = makeDrive(); d.add('trips-data.json', tripsDoc());
      d.add('tripsy-trip-edits.json', { edits: [{ type: 'create_event', tripKey: 'trip-b', tripsyResource: 'activity', fields: { name: 'New Trip Dinner', startsAt: '2030-08-02T19:00:00' } }] });
      await loadWorker(d.fetch).editsDrain(d.env, during);
      assert(/\["2030-08-01","2030-08-03"\]/.test(d.kv.store['edits:tripWindows']), 'after a save the cached windows are rebuilt from the saved trips');
      // the manual endpoint ignores the gate
      Date.now = () => before;
      d = makeDrive(); d.add('trips-data.json', tripsDoc()); d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
      d.kv.store['edits:tripWindows'] = '[]';
      const forced = await loadWorker(d.fetch).editsDrain(d.env, before);
      assert(forced && forced.applied === 1, 'the manual apply-edits run works whether or not a trip is in progress');
    } finally { Date.now = realNow; }
  }
  {
    const d = makeDrive(); const tf = d.add('trips-data.json', tripsDoc()); const rev0 = tf.headRevisionId;
    d.add('tripsy-trip-edits.json', { edits: relayEdits() });
    const run = await loadWorker(d.fetch).editsDrain(d.env, Date.UTC(2030, 4, 1, 12));
    const saved = d.json('trips-data.json');
    assert(run.saved && run.applied === 6 && saved.schemaVersion === 1 && saved.updatedAt === '2030-05-01T12:00:00.000Z' && tf.headRevisionId !== rev0
      && saved.trips[0].events.some(e => e.summary === 'Dinner at Test Bistro'), 'a waiting relay is applied and trips-data.json saved in the app\'s own document shape');
    assert(d.byName('tripsy-trip-edits.json').length === 0, 'the relay is deleted once applied');
    const log = d.json('tripsy-trip-edits-log.json');
    assert(log && log.runs.length === 1 && log.runs[0].files[0].entries.length === 11 && log.runs[0].applied === 6
      && d.byName('tripsy-trip-edits-log.json')[0].parents[0] === 'folder1', 'the run is logged beside trips-data.json, one entry per edit');
    const fu = d.json('tripsy-applied-edits.json');
    assert(fu && fu.changes.length === 3 && fu.changes[1].type === 'delete_event', 'the follow-up note for the app is written');
    assert(!('feed:trips' in d.kv.store), 'the watch feed\'s cached trips are dropped so it shows the change at once');
    assert(/^Applied 6, skipped 5, failed 0\./.test(loadWorker(d.fetch).editsRunText(run)), 'the manual-run endpoint reports the same counts');
    // the same relay arrives again (a chat retried): nothing saved, still logged
    d.add('tripsy-trip-edits.json', { edits: relayEdits().filter(e => e.type === 'create_event') });
    const rev1 = tf.headRevisionId;
    const run2 = await loadWorker(d.fetch).editsDrain(d.env);
    assert(run2.applied === 0 && !run2.saved && tf.headRevisionId === rev1 && d.byName('tripsy-trip-edits.json').length === 0
      && d.json('tripsy-trip-edits-log.json').runs.length === 2 && d.byName('tripsy-applied-edits.json').length === 1,
      'REPLAY: a repeated relay is cleared and logged without rewriting trips-data.json');
  }
  {
    // The app (any device) saved between our load and our save.
    const d = makeDrive(); d.add('trips-data.json', tripsDoc());
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'From Chat', startsAt: '2030-05-03T13:00:00' } }] });
    d.onRevisionCheck = file => {
      const doc = JSON.parse(file.content);
      doc.trips[0].events.push(ev('activity', 50, { name: 'Added In App', startsAt: '2030-05-03T14:00:00' }));
      file.content = JSON.stringify(doc); file.headRevisionId = 'r-app';
    };
    const run = await loadWorker(d.fetch).editsDrain(d.env);
    const names = d.json('trips-data.json').trips[0].events.map(e => e.summary);
    assert(run.saved && names.includes('Added In App') && names.includes('From Chat'),
      'CONFLICT: another device saved first -> the Worker reloads and re-applies; neither change is lost');
  }
  {
    // The app drained the SAME relay first.
    const d = makeDrive(); d.add('trips-data.json', tripsDoc());
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'From Chat', startsAt: '2030-05-03T13:00:00' } }] });
    d.onRevisionCheck = file => {
      const doc = JSON.parse(file.content);
      doc.trips[0].events.push(ev('activity', 51, { name: 'From Chat', startsAt: '2030-05-03T13:00:00' }));
      file.content = JSON.stringify(doc); file.headRevisionId = 'r-app';
    };
    const run = await loadWorker(d.fetch).editsDrain(d.env);
    assert(!run.saved && run.applied === 0 && d.json('trips-data.json').trips[0].events.filter(e => e.summary === 'From Chat').length === 1,
      'NO DUPLICATE: when the app applied the same relay a moment earlier, the Worker adds nothing');
  }
  {
    const d = makeDrive(); d.add('trips-data.json', tripsDoc()); d.failUpload = true;
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
    let threw = false;
    try { await loadWorker(d.fetch).editsDrain(d.env); } catch (e) { threw = true; }
    assert(threw && d.byName('tripsy-trip-edits.json').length === 1 && !d.json('tripsy-trip-edits-log.json'),
      'a failed save throws and KEEPS the relay for the next tick');
  }
  {
    const d = makeDrive(); const tf = d.add('trips-data.json', tripsDoc()); const rev0 = tf.headRevisionId;
    d.add('tripsy-trip-edits.json', '{ this is not json');
    d.add('tripsy-trip-edits.json', { changes: [] });
    d.add('tripsy-trip-edits.json', '', { mimeType: 'application/vnd.google-apps.document' });
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
    const run = await loadWorker(d.fetch).editsDrain(d.env, Date.UTC(2030, 4, 1, 12));
    assert(run.invalid.length === 3 && d.byName('tripsy-trip-edits.json').length === 0
      && d.files.filter(f => /^tripsy-trip-edits\.invalid-20300501T120000Z\.json$/.test(f.name)).length === 3,
      'an unreadable relay (bad JSON, no edits list, a converted Google Doc) is renamed aside -- never retried forever, never lost');
    assert(run.applied === 1 && tf.headRevisionId !== rev0 && d.json('tripsy-trip-edits-log.json').runs[0].invalid.length === 3,
      'a good relay beside a bad one still applies, and the log names the bad ones');
  }
  {
    // Several relays: oldest first, one save.
    const d = makeDrive(); d.add('trips-data.json', tripsDoc());
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'First', startsAt: '2030-05-03T13:00:00' } }] });
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'First', startsAt: '2030-05-03T13:00:00' } },
      { type: 'delete_event', eventKey: 'activity:3' }] });
    const run = await loadWorker(d.fetch).editsDrain(d.env);
    const uploads = d.calls.filter(c => /^PATCH \/upload\/drive\/v3\/files\/f1\?/.test(c)).length;
    assert(run.applied === 2 && run.skipped === 1 && uploads === 1 && run.files.length === 2, 'several waiting relays apply oldest first in ONE save, a repeat across them skipped');
  }
  {
    const d = makeDrive(); d.add('trips-data.json', tripsDoc());
    d.add('tripsy-trip-edits.json', { edits: [{ type: 'delete_event', eventKey: 'activity:4' }] });
    const w = loadWorker(d.fetch).__worker;
    let p = null;
    const today = new Date().toISOString().slice(0, 10);
    d.kv.store['edits:tripWindows'] = JSON.stringify([[today, today]]);
    await w.scheduled({}, d.env, { waitUntil: x => { p = x; } }); await p;
    assert(d.byName('tripsy-trip-edits.json').length === 0, 'the scheduled handler drains end to end');
    let ran = false;
    await w.scheduled({}, { ...d.env, OWNER_EMAIL: '' }, { waitUntil: () => { ran = true; } });
    assert(!ran, 'an unconfigured Worker does nothing on a tick');
    const noisy = console.error; let logged = ''; console.error = (...a) => { logged += a.join(' '); };
    d.files = []; d.add('tripsy-trip-edits.json', { edits: [] });
    d.kv.store['edits:tripWindows'] = JSON.stringify([[today, today]]); // the save above rebuilt them
    await w.scheduled({}, d.env, { waitUntil: x => { p = x; } }); await p;
    console.error = noisy;
    assert(/trips-data\.json not found/.test(logged), 'a failing tick is logged, never thrown out of the handler');
  }

  // ---- 4. the app's side ----
  const q = html.slice(html.indexOf('async queueTripsyChange(change) {'), html.indexOf('async cancelTripsyChange('));
  assert(/if \(e && e\.conflict\) \{[\s\S]{0,700}?if \(typeof change\.stillNeeded === 'function' && !change\.stillNeeded\(\)\) break;\s*\n\s*if \(attempt < 2\) \{ applyTripsyChangeToTrips\(change\); continue; \}/.test(q),
    'APP: after a conflict reload, a relayed change that is already in the newer copy is NOT re-applied');
  {
    const seen = {};
    const trips = [{ key: 'trip-a', events: [] }];
    const run = new Function('trips', 'seen', `
      var tripsyDecryptedTrips = trips;
      var tripsyEventKey = r => r.resource + ':' + r.id;
      var toast = () => {};
      var TRIPSY_TRIP_EDIT_KNOWN_TYPES = ['edit_event', 'delete_event', 'create_event', 'edit_trip', 'create_trip', 'delete_trip', 'move_event'];
      var Store = { queueTripsyChange: async change => {
        seen.before = change.stillNeeded();
        seen.keys = Object.keys(change); seen.json = JSON.stringify(change);
        // the Worker saved first; the conflict reload now holds the event
        tripsyDecryptedTrips = [{ key: 'trip-a', events: [{ tripsyRaw: { resource: 'activity', id: 9, name: 'Dinner', startsAt: '2030-05-03T19:30:00' } }] }];
        seen.after = change.stillNeeded();
      } };
      ${extractFn('tripsyTripEditCreateIdentity')}
      ${extractFn('applyTripsyTripEditsRelay')}
      return applyTripsyTripEditsRelay({ edits: [{ type: 'create_event', tripKey: 'trip-a', tripsyResource: 'activity', fields: { name: 'Dinner', startsAt: '2030-05-03T19:30:00' } }] });
    `);
    const quiet2 = console.log; console.log = () => {};
    await run(trips, seen);
    console.log = quiet2;
    assert(seen.before === true && seen.after === false, 'APP: the relay drain\'s stillNeeded reads the trips as they are NOW -- true before, false once the Worker\'s save is loaded');
    assert(!seen.keys.includes('stillNeeded') && !/stillNeeded/.test(seen.json), 'APP: the guard is non-enumerable, so it never rides into a stored or copied change');
  }
  {
    const sync = extractFn('syncTripsyRelays');
    assert(sync.indexOf('await drainTripsyTripEdits()') < sync.indexOf('await drainTripsyAppliedEdits()') && sync.indexOf('await ensureTripsyDecrypted()') < sync.indexOf('await drainTripsyAppliedEdits()'),
      'APP: the follow-up drain runs after the trips load and after the app\'s own relay drain');
    assert(/if \(!isOwner \|\| !tripsyDecryptedTrips\) return;/.test(extractFn('drainTripsyAppliedEdits')), 'APP: owner-only, and never before trips are loaded');
    const mk = st => new Function('st', `
      var driveData = st.driveData, tripsDataFileId = 'f1', tripsDataRevision = st.rev, tripsyInFlightWrites = st.inFlight, tripsyDecryptedTrips = 'OLD';
      var fetchDriveHeadRevision = async () => st.head;
      var fetchTripsDataFromDrive = async () => 'NEW';
      var tripsyStripDeletedEventFromCaches = (tripKey, base) => { st.stripped.push(tripKey + '|' + base); return true; };
      var tripsyReHomeMovedEvent = c => { st.moved.push(c.eventKey + '>' + c.targetTripKey); return true; };
      var persistDriveData = async () => { st.persists++; };
      ${extractFn('applyTripsyAppliedEditsRelay')}
      return relay => applyTripsyAppliedEditsRelay(relay).then(() => tripsyDecryptedTrips);
    `)(st);
    const st = () => ({ rev: 'r1', head: 'r2', inFlight: [], stripped: [], moved: [], persists: 0,
      driveData: { tripsyUpdatePages: [{ tripKey: 'trip-a', eventKeys: ['activity:3'] }, { tripKey: 'trip-b', eventKeys: ['activity:8'] }] } });
    const s1 = st();
    const t1 = await mk(s1)({ changes: [
      { type: 'edit_event', eventKey: 'activity:3', tripKey: 'trip-a' },
      { type: 'delete_event', eventKey: 'activity:4', tripKey: 'trip-a' },
      { type: 'move_event', eventKey: 'hosting:2', tripKey: 'trip-a', targetTripKey: 'trip-b' }, null, {}] });
    assert(t1 === 'NEW', 'APP: a page that was open takes the newer trips the Worker saved');
    assert(s1.driveData.tripsyUpdatePages.length === 1 && s1.stripped.join() === 'trip-a|activity-4' && s1.moved.join() === 'hosting:2>trip-b' && s1.persists === 1,
      'APP: the same cleanup a hand-made edit gets -- stale Update page dropped, deleted event stripped, moved event re-homed -- in one save');
    const s2 = st(); s2.head = 'r1';
    const t2 = await mk(s2)({ changes: [] });
    assert(t2 === 'OLD' && s2.persists === 0, 'APP: trips already current and nothing to clean -> no reload, no save');
    const s3 = st(); s3.inFlight = [{ id: 1 }];
    assert(await mk(s3)({ changes: [] }) === 'OLD', 'APP: never reloads trips under a write of its own');
  }
})().catch(e => { console.log('FAIL suite crashed: ' + (e && e.stack || e)); process.exitCode = 1; });
