// End-to-end check of the Drive inbox import against a FAKE DRIVE that implements the real
// REST calls the page makes (files.get, files.list with q, PATCH move/rename/trash, POST
// create), so every real function runs: tripsyFlyoverInboxFolder, the stray-folder gather,
// root adoption, listing, routing, import, retire. Playwright's fake clock skips the waits.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const dir = new URL('.', import.meta.url).pathname;
const b = await chromium.launch();
let failures = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); if (!ok) failures++; };

const FAKE_DRIVE = `
window.FD = (() => {
  const files = new Map(); // id -> {id,name,mimeType,parents:[],trashed,createdTime,imageMediaMetadata,md5Checksum}
  let n = 0; const mint = p => p + (++n);
  const state = { failMoveOnce: false, staleListOnce: new Set(), slowGetMs: 0, log: [] };
  const err = (code, msg) => Object.assign(new Error('Drive API error ' + code + ': ' + msg), { reachedServer: true });
  const put = f => { files.set(f.id, f); return f; };
  const folder = (name, parent) => put({ id: mint('fold'), name, mimeType: 'application/vnd.google-apps.folder', parents: [parent], trashed: false, createdTime: new Date(Date.now() - 86400000 * (n + 1)).toISOString() });
  const photo = (parent, name, time, opts = {}) => put({ id: mint('ph'), name, mimeType: opts.mime || 'image/jpeg', parents: [parent], trashed: false, createdTime: opts.createdTime || new Date().toISOString(), imageMediaMetadata: time ? { time, width: 4000, height: 3000 } : undefined, md5Checksum: opts.md5 || ('md5' + name) });
  put({ id: 'home', name: 'Travel Tracker', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], trashed: false, createdTime: '2026-01-01T00:00:00Z' });
  const parseQ = q => {
    const m = /'([^']+)' in parents/.exec(q); const parent = m ? m[1] : null;
    const notTrashed = /trashed=false/.test(q);
    const isFolder = /mimeType='application\\/vnd.google-apps.folder'/.test(q);
    const media = /mimeType contains 'image\\/'/.test(q);
    const after = /createdTime > '([^']+)'/.exec(q), before = /createdTime < '([^']+)'/.exec(q);
    return { parent, notTrashed, isFolder, media, after: after && after[1], before: before && before[1] };
  };
  const list = q => [...files.values()].filter(f => (q.parent == null || f.parents.includes(q.parent)) && (!q.notTrashed || !f.trashed) && (!q.isFolder || f.mimeType.includes('folder')) && (!q.media || /^(image|video)\\//.test(f.mimeType)) && (!q.after || f.createdTime > q.after) && (!q.before || f.createdTime < q.before));
  const trashTree = id => { const f = files.get(id); if (!f) return; f.trashed = true; for (const c of files.values()) if (c.parents.includes(id)) trashTree(c.id); };
  const driveApiFetch = async (url, o = {}) => {
    const u = new URL(url); const m = /\\/files\\/([^/?]+)$/.exec(u.pathname); const id = m && decodeURIComponent(m[1]);
    const method = o.method || 'GET';
    state.log.push(method + ' ' + u.pathname + u.search);
    if (method === 'GET' && id) { if (state.slowGetMs) await new Promise(r => setTimeout(r, state.slowGetMs)); const f = files.get(id); if (!f) throw err(404, 'not found'); return { ok: true, json: async () => ({ id: f.id, trashed: !!f.trashed, name: f.name }) }; }
    if (method === 'GET' && u.pathname.endsWith('/files')) {
      const q = parseQ(u.searchParams.get('q') || '');
      if (q.parent && state.staleListOnce.has(q.parent)) { state.staleListOnce.delete(q.parent); return { ok: true, json: async () => ({ files: [] }) }; }
      return { ok: true, json: async () => ({ files: list(q).map(f => ({ ...f, parents: undefined })) }) };
    }
    if (method === 'POST') { const body = JSON.parse(o.body); const f = put({ id: mint('new'), name: body.name, mimeType: body.mimeType, parents: body.parents, trashed: false, createdTime: new Date().toISOString() }); return { ok: true, json: async () => ({ id: f.id }) }; }
    if (method === 'PATCH' && id) {
      const f = files.get(id); if (!f) throw err(404, 'not found');
      const add = u.searchParams.get('addParents'), rem = u.searchParams.get('removeParents');
      const body = o.body ? JSON.parse(o.body) : {};
      if (add) { if (state.failMoveOnce) { state.failMoveOnce = false; throw err(500, 'backend error'); } f.parents = f.parents.filter(p => p !== rem).concat([add]); }
      if (body.name) f.name = body.name;
      if (body.trashed) trashTree(id);
      return { ok: true, json: async () => ({ id: f.id, parents: f.parents }) };
    }
    throw err(400, 'unhandled ' + method + ' ' + url);
  };
  return { files, state, folder, photo, driveApiFetch, parentOf: id => (files.get(id) || {}).parents, trashed: id => !!(files.get(id) || {}).trashed, inFolder: p => list({ parent: p, notTrashed: true }).map(f => f.id) };
})();
window.driveApiFetch = (u, o) => window.FD.driveApiFetch(u, o);
window.DRIVE_FOLDER_NAME = 'Travel Tracker'; window.findOrCreateDriveFolder = async () => 'home';
window.tripsyFlyoverShortcutToken = async () => 'tok'; window.tripsyFlyoverShortcutUrl = () => '#shortcut';
window.tripsyFlyoverPickMedia = () => {}; window.downloadDriveFileBlob = async () => new Blob(['0']);
window.tripsyConfirmDialog = async () => false;
Store.stageTripsyFlyover = r => { Store._r = r; return r; }; Store.persistTripsyFlyovers = async () => true; Store.saveTripsyFlyover = async r => { Store._r = r; return true; }; Store.takeStaleFlyover = () => false;
const mks = (id, kind, label, lat, lng, mode, start, end) => ({ id, kind, label, autoLabel: label, lat, lng, mode, photos: [], start, end, labelLang: 'en', modeManual: true });
window.freshRecord = (extra = {}) => ({ tripKey: 'T1', transitV: 1, layoversV: 2, stops: [mks('o','origin','Los Angeles',33.94,-118.4,'','2026-10-01','2026-10-01'), mks('s1','stay','Fukuoka',33.59,130.40,'plane','2026-10-02','2026-10-05'), mks('s2','stay','Beppu',33.28,131.49,'car','2026-10-06','2026-10-09'), mks('rr','return','Los Angeles',33.94,-118.4,'plane','2026-10-10','2026-10-10')], ...extra });
`;

const boot = async (setup) => {
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.clock.install({ time: new Date('2026-10-25T10:00:00Z') });
  await p.goto('file://' + dir + 'harness.html');
  await p.evaluate(FAKE_DRIVE);
  await p.evaluate(setup);
  await p.evaluate(async () => { await showTripsyFlyover('T1'); });
  await p.clock.runFor(300);
  return p;
};
const rec = p => p.evaluate(() => Store._r);
const phase = p => p.evaluate(() => { const s = document.querySelector('[data-flyover-drive-phase]'); return s ? s.dataset.flyoverDrivePhase : '(none)'; });
const photos = async p => (await rec(p)).stops.flatMap(s => s.photos.filter(x => !String(x.driveFileId).startsWith('builtin:')).map(x => s.label + ':' + x.driveFileId));
const tick = async (p, ms) => { for (let i = 0; i < Math.ceil(ms / 1000); i++) { await p.clock.runFor(1000); await new Promise(r => setTimeout(r, 5)); } };
const fd = (p, expr) => p.evaluate(e => eval(e), expr);

// ---- A: the ordinary hand-off: files arrive, settle, import, folder retired --------------
{
  const p = await boot(`Store._r = freshRecord();`);
  await p.click('[data-flyover-stop="s1"] [data-flyover-add-own]'); await tick(p, 300);
  await p.click('[data-src-drive]'); await tick(p, 4000);
  await p.evaluate(() => { const c = document.querySelector('[data-handoff-close]'); if (c) c.click(); });
  const r0 = await rec(p);
  check('A: hand-off made one inbox folder and remembered it', !!r0.inboxFolderId && !!r0.inboxPendingAt, r0.inboxFolderId);
  check('A: the folder is inside the app folder', (await fd(p, `FD.parentOf('${r0.inboxFolderId}')`)).join() === 'home');
  await tick(p, 16000);
  check('A: empty folder reads waiting', (await phase(p)) === 'waiting');
  await p.evaluate(id => { FD.photo(id, 'IMG_1.jpg', '2026:10:03 09:00:00'); FD.photo(id, 'IMG_2.jpg', '2026:10:03 10:00:00'); }, r0.inboxFolderId);
  await tick(p, 16000);
  check('A: arriving files read uploading', (await phase(p)) === 'uploading', await phase(p));
  await p.evaluate(id => { FD.photo(id, 'IMG_3.mov', null, { mime: 'video/quicktime' }); FD.photo(id, 'IMG_4.jpg', '2026:10:07 10:00:00'); }, r0.inboxFolderId);
  await tick(p, 16000);
  await tick(p, 130000);
  const ph = await photos(p); const r1 = await rec(p);
  check('A: all 4 imported after 2 quiet minutes, routed by capture date (the dateless video on the card\'s own stop)', ph.length === 4 && ph.filter(x => x.startsWith('Fukuoka')).length === 3 && ph.filter(x => x.startsWith('Beppu')).length === 1, ph.join(' '));
  // The video has no EXIF date and the hand-off was from the s1 card: it should land on s1.
  check('A: the video (no EXIF) fell back to the card\'s destination', ph.includes('Fukuoka:' + (await fd(p, `[...FD.files.values()].find(f=>f.name==='IMG_3.mov').id`))), ph.join(' '));
  check('A: hand-off closed after a clean import', !r1.inboxPendingAt && !r1.inboxFolderId, JSON.stringify({ p: r1.inboxPendingAt, f: r1.inboxFolderId }));
  check('A: inbox folder trashed, every photo moved to the app folder, none trashed', (await fd(p, `FD.trashed('${r0.inboxFolderId}')`)) && (await fd(p, `[...FD.files.values()].filter(f=>f.name.startsWith('IMG_')).every(f=>!f.trashed && f.parents.join()==='home')`)));
  check('A: no watcher left running (no listing in the next minute)', await p.evaluate(async () => { const n = FD.state.log.length; await new Promise(r => setTimeout(r, 70000)); return FD.state.log.length === n; }));
  check('A: status slot gone', (await phase(p)) === '(none)');
  await p.close();
}

// ---- B: photos stranded in an OLDER same-named folder are gathered, imported, both folders retired
{
  const p = await boot(`
    const old = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home'); const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home');
    const t = new Date(Date.now() - 3600000).toISOString();
    for (let i = 1; i <= 5; i++) FD.photo(old.id, 'OLD_' + i + '.jpg', '2026:10:0' + (2 + (i % 3)) + ' 1' + i + ':00:00', { createdTime: t });
    window.oldId = old.id; window.curId = cur.id;
    Store._r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });`);
  await tick(p, 20000);
  const ph = await photos(p); const r = await rec(p);
  check('B: the 5 stranded photos were gathered and imported on the first checks', ph.length === 5, ph.join(' '));
  check('B: the old folder was trashed only after it was emptied, the current one after retire', (await fd(p, 'FD.trashed(oldId) && FD.trashed(curId)')) && (await fd(p, `[...FD.files.values()].filter(f=>f.name.startsWith('OLD_')).every(f=>!f.trashed && f.parents.join()==='home')`)));
  check('B: hand-off closed', !r.inboxPendingAt);
  await p.close();
}

// ---- C: a LAGGING listing never trashes a folder with photos in it ---------------------
{
  const p = await boot(`
    const old = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home'); const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home');
    const t = new Date(Date.now() - 3600000).toISOString();
    for (let i = 1; i <= 3; i++) FD.photo(old.id, 'OLD_' + i + '.jpg', '2026:10:03 1' + i + ':00:00', { createdTime: t });
    FD.state.staleListOnce.add(old.id); // the first listing of the old folder comes back empty
    window.oldId = old.id; window.curId = cur.id;
    Store._r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });`);
  await tick(p, 2000);
  check('C: after the stale (empty) listing the old folder is NOT trashed and its photos are intact', !(await fd(p, 'FD.trashed(oldId)')) && (await fd(p, 'FD.inFolder(oldId).length')) === 3);
  await tick(p, 40000);
  const ph = await photos(p);
  check('C: the next check gathered and imported them', ph.length === 3, ph.join(' '));
  check('C: and no photo was ever trashed', await fd(p, `[...FD.files.values()].filter(f=>f.name.startsWith('OLD_')).every(f=>!f.trashed)`));
  await p.close();
}

// ---- D: the cleanup fails once; the watcher retries it and finishes ----------------------
{
  const p = await boot(`
    const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home');
    const t = new Date(Date.now() - 3600000).toISOString();
    for (let i = 1; i <= 3; i++) FD.photo(cur.id, 'P_' + i + '.jpg', '2026:10:03 1' + i + ':00:00', { createdTime: t });
    FD.state.failMoveOnce = true; window.curId = cur.id;
    Store._r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });`);
  await tick(p, 5000);
  let r = await rec(p);
  check('D: imported, but the hand-off is still pending after the failed cleanup', (await photos(p)).length === 3 && !!r.inboxPendingAt && !(await fd(p, 'FD.trashed(curId)')), JSON.stringify({ n: (await photos(p)).length, pending: r.inboxPendingAt, trashed: await fd(p, 'FD.trashed(curId)'), status: await p.evaluate(() => document.querySelector('[data-flyover-status]').textContent) }));
  check('D: the status says it keeps trying', await p.evaluate(() => /keeps trying/.test(document.querySelector('[data-flyover-status]').textContent)));
  await tick(p, 200000);
  r = await rec(p);
  check('D: the watcher retried the cleanup: folder trashed, photos in the app folder, hand-off closed', (await fd(p, 'FD.trashed(curId)')) && !r.inboxPendingAt && (await fd(p, `[...FD.files.values()].filter(f=>f.name.startsWith('P_')).every(f=>!f.trashed && f.parents.join()==='home')`)));
  await p.close();
}

// ---- E: the folder was trashed outside the app: the hand-off closes itself --------------
{
  const p = await boot(`
    const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home'); FD.files.get(cur.id).trashed = true;
    Store._r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });`);
  await tick(p, 2000);
  const r = await rec(p);
  check('E: a trashed folder closes the hand-off instead of waiting forever', !r.inboxPendingAt && !r.inboxFolderId && (await phase(p)) === '(none)');
  await p.close();
}

// ---- F: the Shortcut route: uploads land in My Drive root, are adopted and imported -------
{
  const p = await boot(`Store._r = freshRecord();`);
  await p.click('[data-flyover-shortcut]'); await tick(p, 4000);
  await p.evaluate(() => { const b = document.querySelector('[data-sc-run]'); if (b) b.click(); });
  await tick(p, 1000);
  let r = await rec(p);
  check('F: Run stamped the launch and a hand-off', !!r.shortcutLaunchedAt && !!r.inboxPendingAt && !!r.inboxFolderId, JSON.stringify({ l: r.shortcutLaunchedAt, f: r.inboxFolderId }));
  const nudgeUp = () => p.evaluate(() => { const o = document.getElementById('tripsy-flyover-shortcut-nudge-overlay'); return !!(o && o.innerHTML.length && o.style.display !== 'none'); });
  await tick(p, 60000);
  check('F: no "No new photos" box inside the 90 s grace', !(await nudgeUp()));
  await tick(p, 60000);
  check('F: the box appears once the grace has passed with the folder confirmed empty', await nudgeUp());
  await p.evaluate(() => { const w = document.querySelector('[data-sn-wait]'); if (w) w.click(); });
  await tick(p, 500);
  check('F: Keep waiting keeps the hand-off', !!(await rec(p)).inboxPendingAt && !(await nudgeUp()));
  await p.evaluate(() => { for (let i = 1; i <= 4; i++) FD.photo('root', ' IMG_' + i, '2026:10:0' + (3 + i % 2) + ' 09:0' + i + ':00'); });
  await tick(p, 16000);
  check('F: root uploads adopted into the inbox and renamed', (await fd(p, `FD.inFolder(Store._r.inboxFolderId || '${r.inboxFolderId}').length`)) === 4 && (await fd(p, `[...FD.files.values()].filter(f=>f.name.startsWith('IMG_')).every(f=>f.name.endsWith('.jpg'))`)));
  await tick(p, 140000);
  r = await rec(p);
  check('F: imported after settling, hand-off and launch closed, folder trashed', (await photos(p)).length === 4 && !r.inboxPendingAt && !r.shortcutLaunchedAt && (await fd(p, `FD.trashed('new1')`)), JSON.stringify({ ph: await photos(p), pending: r.inboxPendingAt, launch: r.shortcutLaunchedAt, trashed: await fd(p, `FD.trashed('new1')`), phase: await phase(p), nudge: await p.evaluate(() => { const o = document.getElementById('tripsy-flyover-shortcut-nudge-overlay'); return o ? o.textContent.slice(0, 80) : ''; }) }));
  await p.close();
}

// ---- G: a slow folder lookup cannot start two imports ------------------------------------
{
  const p = await boot(`
    const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home');
    const t = new Date(Date.now() - 3600000).toISOString();
    for (let i = 1; i <= 3; i++) FD.photo(cur.id, 'G_' + i + '.jpg', '2026:10:03 1' + i + ':00:00', { createdTime: t });
    FD.state.slowGetMs = 40000; window.curId = cur.id;
    Store._r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });`);
  await tick(p, 200000);
  const ph = await photos(p);
  check('G: exactly 3 photos on the record (no duplicate import)', ph.length === 3 && new Set(ph).size === 3, ph.join(' '));
  await p.close();
}

// ---- H: an import interrupted by closing the page finishes on the next open -------------
{
  const p = await boot(`
    const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home');
    const t = new Date(Date.now() - 3600000).toISOString();
    const done = FD.photo(cur.id, 'H_1.jpg', '2026:10:03 11:00:00', { createdTime: t });
    for (let i = 2; i <= 3; i++) FD.photo(cur.id, 'H_' + i + '.jpg', '2026:10:03 1' + i + ':00:00', { createdTime: t });
    window.curId = cur.id;
    const r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });
    r.stops[1].photos.push({ driveFileId: done.id, inPlace: true, mime: 'image/jpeg', src: 'drive:' + done.id, md5: 'md5:' + done.md5Checksum, taken: '2026-10-03T11:00:00', px: '3000x4000' });
    Store._r = r;`);
  await tick(p, 20000);
  const ph = await photos(p); const r = await rec(p);
  check('H: the two not-yet-imported photos came in, the first was not duplicated', ph.length === 3 && new Set(ph).size === 3, ph.join(' '));
  check('H: folder retired and hand-off closed', (await fd(p, 'FD.trashed(curId)')) && !r.inboxPendingAt);
  await p.close();
}

// ---- I: an empty folder just waits -- no dialogs, no trash, Cancel available -------------
{
  const p = await boot(`
    const cur = FD.folder('Fly-over photos — Synthetic Asia Trip', 'home'); window.curId = cur.id;
    Store._r = freshRecord({ inboxFolderId: cur.id, inboxPendingAt: new Date(Date.now() - 600000).toISOString(), inboxDest: 'auto' });`);
  await tick(p, 300000);
  check('I: still waiting after 5 minutes, folder kept, Cancel offered', (await phase(p)) === 'waiting' && !(await fd(p, 'FD.trashed(curId)')) && (await p.evaluate(() => !!document.querySelector('[data-drive-cancel]'))));
  await p.click('[data-drive-cancel]'); await tick(p, 500);
  const r = await rec(p);
  check('I: Cancel closes the hand-off', !r.inboxPendingAt && (await phase(p)) === '(none)');
  await p.close();
}

// ---- J: the slideshow edit page saves every change as it is made (no ✓ / ✕ Cancel) -------
{
  const p = await boot(`
    const r = freshRecord(); r.stops[1].photos = [{ driveFileId: 'pa' }, { driveFileId: 'pb' }]; r.stops[1].pages = [{ ids: ['pa'], count: 1 }];
    Store._r = r;`);
  await p.click('[data-flyover-stop="s1"] [data-flyover-slideshow]'); await tick(p, 300);
  check('J: no Save ✓ and no Cancel ✕ on the slideshow page, one Close ✕', await p.evaluate(() => {
    const ov = document.getElementById('tripsy-flyover-slideshow-overlay');
    return !ov.querySelector('[data-ss-save], [data-ss-cancel], .tripsy-save-check') && ov.querySelectorAll('.tripsy-close-x').length === 1;
  }));
  await p.click('[data-ss-count="2"]'); await tick(p, 100);
  await p.click('[data-ss-photo="pb"]'); await tick(p, 2000);
  let r = await rec(p);
  check('J: the change is saved without pressing anything', JSON.stringify(r.stops[1].pages.map(x => x.ids)) === '[["pa","pb"]]');
  await p.click('[data-ss-ptr="wipe"]'); await tick(p, 2000);
  r = await rec(p);
  check('J: a transition pick is saved too', r.stops[1].pages[0].photoTransition === 'wipe');
  await p.click('[data-ss-complete]'); await tick(p, 500);
  r = await rec(p);
  check('J: Complete closes it and marks the slideshow done, changes kept', r.stops[1].editDone && r.stops[1].editDone.slideshow && r.stops[1].pages[0].ids.length === 2
    && (await p.evaluate(() => document.getElementById('tripsy-flyover-slideshow-overlay').style.display === 'none')));
  await p.close();
}

await b.close();
console.log(failures ? `\n${failures} FAILED` : '\nall scenarios passed');
process.exit(failures ? 1 : 0);
