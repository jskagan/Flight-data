// "Can you display all users with trips-only access in the trips-only access
// utilities page" (2026-09-28). The Trips-Only Access utility page was a pure
// how-to guide -- WHO currently has the access was only visible as scattered
// checkbox states on the Users page. A "Current Trips-Only Viewers" card now
// lists every driveData.tripsOnlyEmails entry, resolving display names from
// the data file's live sharing permissions (the Users page's own source of
// truth) and flagging a STALE entry -- still ticked Trips-only but no longer
// shared on the file. The list fills AFTER the page paints (the permissions
// lookup is a network round trip -- the My Trips weather lesson, same day).
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

// ---- executed: the pure list builder ----
const listHtml = new Function('esc',
  `${extractFn('tripsOnlyViewerListHtml')} return tripsOnlyViewerListHtml;`)(
  s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

assert(/No one has Trips-only access yet/.test(listHtml([], [{ emailAddress: 'a@b.com' }])),
  'an empty trips-only list shows the empty state, whatever the sharing list holds');
{
  const out = listHtml(['mo@example.com', 'jon@example.com'], [
    { emailAddress: 'MO@example.com', displayName: 'Mo Kagan', role: 'reader' },
    { emailAddress: 'jon@example.com', role: 'reader' },
    { emailAddress: 'other@example.com', displayName: 'Unrelated Viewer', role: 'reader' },
  ]);
  assert(/Mo Kagan/.test(out) && /jon@example\.com · Trips-only viewer/.test(out) && !/Unrelated Viewer/.test(out),
    'THE ASK: every trips-only email renders a row -- display name resolved from the sharing list (case-insensitively), bare email when Drive has no name, non-trips-only viewers excluded');
  assert(!/No longer shared/.test(out) && !/⚠️/.test(out),
    'entries that ARE still shared carry no stale flag');
}
{
  const out = listHtml(['gone@example.com', 'mo@example.com'], [{ emailAddress: 'mo@example.com', displayName: 'Mo', role: 'reader' }]);
  assert(/gone@example\.com/.test(out)
    && (out.match(/No longer shared on the data file/g) || []).length === 1,
    'STALE: an email still ticked Trips-only but missing from the sharing list is flagged -- and only that one');
  assert(/Remove tidies it up/.test(out) && /re-share/.test(out),
    'the stale flag comes with the remedy (Remove tidies it, or re-share the file)');
}
{
  const out = listHtml(['mo@example.com'], []);
  assert(/mo@example\.com/.test(out) && !/⚠️/.test(out),
    'an EMPTY permissions list means the Drive lookup failed -- bare emails show with NO stale flags, rather than every row wrongly flagged');
}

// ---- "A user is getting this message when she tries to view the trips only
// view" (2026-09-29): every trips-only viewer was shared on flight-log-data
// but NOBODY on trips-data.json -- sign-in worked, no trips ever loaded, and
// this list showed every row clean. The check now verifies BOTH files. ----
{
  const dataPerms = [{ emailAddress: 'mo@example.com', displayName: 'Mo', role: 'reader' },
    { emailAddress: 'rob@example.com', displayName: 'Rob', role: 'reader' }];
  const out = listHtml(['mo@example.com', 'rob@example.com'], dataPerms,
    [{ emailAddress: 'MO@example.com', role: 'reader' }]);
  assert((out.match(/⚠️ Not shared on the trips file/g) || []).length === 1 && /rob@example\.com/.test(out)
    && /enter that same email in <strong>Add Viewer<\/strong>/.test(out),
    'THE LIVE BUG: a viewer shared on the data file but NOT the trips file is flagged (case-insensitively), with Add Viewer as the remedy');
  const outNoTrips = listHtml(['mo@example.com'], dataPerms, []);
  assert(!/Not shared on the trips file/.test(outNoTrips),
    'an empty trips-file permissions list means THAT lookup failed -- no trips flags, same rule as the data file');
  const outStale = listHtml(['gone@example.com'], dataPerms, [{ emailAddress: 'mo@example.com' }]);
  assert(/No longer shared on the data file/.test(outStale) && !/Not shared on the trips file/.test(outStale),
    'a row already stale on the DATA file (cannot sign in at all) is not double-flagged for the trips file');
}

// ---- the Travel View failure message names the REAL reason ----
assert(!/locked on this device/.test(html) && !/once to unlock/.test(html),
  'the encryption-era "locked on this device -- open My Trips once to unlock" wording is GONE (its advice could never fix a missing share)');
assert(/let tripsyTripsLoadError = null;/.test(html)
  && /tripsyTripsLoadError = e;/.test(extractFn('ensureTripsyDecrypted'))
  && /tripsyTripsLoadError = null;/.test(extractFn('ensureTripsyDecrypted')),
  'ensureTripsyDecrypted records WHY the load failed (and clears it on success) so failure screens can be honest');
{
  const looksNotShared = new Function(
    'tripsyTripsLoadError',
    extractFn('tripsyTripsLoadLooksNotShared').replace(/^function /, 'var f = function ') + '\nreturn f();');
  assert(looksNotShared({ message: 'trips-data.json not found (or not shared with this account).' }) === true
    && looksNotShared({ message: 'network error' }) === false && looksNotShared(null) === false,
    'the not-shared test keys on the loader\'s own "not found" (Drive hides unshared files); anything else reads as transient');
}
assert(/doesn't have access to the trip data yet\. Ask \$\{esc\(OWNER_EMAIL\)\} to share <b>trips-data\.json<\/b>/.test(html)
  && /Couldn't load the trip data — check your connection and reload\./.test(html),
  'Travel View tells a not-shared viewer to ask the owner for the trips-data.json share, and a transient failure to just reload');

// ---- "Is there a way I can add or delete trips-only access from within the
// app" (2026-09-28, follow-up): the card gained an Add Viewer box (shares
// BOTH data files as Viewer + flips the flag -- Steps 3-5 in one tap) and a
// per-row Remove button (full revocation). The Drive share writes are
// IDEMPOTENT so a half-finished add/remove can simply be pressed again. ----
assert(/data-tripsonly-remove="\$\{esc\(email\)\}"/.test(extractFn('tripsOnlyViewerListHtml')),
  'every viewer row carries its own Remove button');

// executed: the share/unshare helpers against stubs
(async () => {
  const mk = (perms) => {
    const calls = [];
    const fns = new Function('listDriveFilePermissions', 'driveApiFetch',
      extractFn('shareDriveFileWithEmailAsViewer') + '\n' + extractFn('removeDriveShareForEmail')
      + '\nreturn { share: shareDriveFileWithEmailAsViewer, remove: removeDriveShareForEmail };')(
      async () => perms,
      async (url, opts = {}) => { calls.push({ url, method: opts.method || 'GET', body: opts.body }); return { json: async () => ({}) }; });
    return { fns, calls };
  };
  {
    const { fns, calls } = mk([{ id: 'perm1', emailAddress: 'Mo@example.com', role: 'reader' }]);
    const r = await fns.share('FILE1', 'mo@example.com');
    assert(r.already === true && calls.length === 0,
      'IDEMPOTENT share: an email that already holds a permission is skipped -- no POST, and an existing role is never downgraded');
    const r2 = await fns.share('FILE1', 'new@example.com');
    assert(r2.already === false && calls.length === 1
      && /FILE1\/permissions\?sendNotificationEmail=false/.test(calls[0].url) && calls[0].method === 'POST'
      && JSON.parse(calls[0].body).role === 'reader' && JSON.parse(calls[0].body).emailAddress === 'new@example.com',
      'a NEW share POSTs a reader (Viewer) permission with Drive\'s own notification email suppressed -- never any role but reader');
  }
  {
    const { fns, calls } = mk([{ id: 'perm9', emailAddress: 'mo@example.com', role: 'reader' }, { id: 'permO', emailAddress: 'owner@example.com', role: 'owner' }]);
    const r = await fns.remove('FILE1', 'gone@example.com');
    assert(r.removed === false && calls.length === 0, 'IDEMPOTENT remove: an absent share is a no-op');
    const r2 = await fns.remove('FILE1', 'MO@example.com');
    assert(r2.removed === true && calls.length === 1 && /FILE1\/permissions\/perm9$/.test(calls[0].url) && calls[0].method === 'DELETE',
      'a present share DELETEs exactly that permission id (email matched case-insensitively)');
    let threw = false;
    try { await fns.remove('FILE1', 'owner@example.com'); } catch (e) { threw = /OWNS the file/.test(e.message); }
    assert(threw, 'the file OWNER can never be removed -- it throws instead of firing the DELETE');
  }
})();

// ---- "Can you update the trips-only view page on utilities so it shows the
// url a user would need to click to get the trips view" (2026-09-29): the
// guide's "Send them the link" step shows the app's own URL with a Copy
// button. Derived from location, never hardcoded. ----
{
  const appUrl = new Function(`${extractFn('tripsOnlyAppUrl')} return tripsOnlyAppUrl;`)();
  assert(appUrl({ origin: 'https://jskagan.github.io', pathname: '/Flight-data/index.html' }) === 'https://jskagan.github.io/Flight-data/'
    && appUrl({ origin: 'https://jskagan.github.io', pathname: '/Flight-data/' }) === 'https://jskagan.github.io/Flight-data/',
    'THE ASK: the shown URL is the app\'s own address, with a trailing index.html stripped to the canonical form Pages serves anyway');
  assert(appUrl({ origin: 'http://localhost:8080', pathname: '/index.html' }) === 'http://localhost:8080/',
    'a locally-served copy shows ITS address -- nothing is hardcoded to the deployed host');
}

// ---- wiring: the page renders the card, and fills it AFTER painting ----
const page = extractFn('renderUtilitiesTripsOnly');
assert(/Current Trips-Only Viewers/.test(page) && /id="tripsonly-current-list"/.test(page),
  'the Trips-Only Access page carries the Current Trips-Only Viewers card');
assert(page.indexOf('main.innerHTML') < page.indexOf('Store.getTripsOnlyEmails()')
  && /listDriveFilePermissions\(driveFileId\)/.test(page)
  && /resolveTripsDataFileIdForSharing\(\)\.then\(id => listDriveFilePermissions\(id\)\)/.test(page)
  && /listEl\.innerHTML = tripsOnlyViewerListHtml\(tripsOnlyEmails, permissions, tripsPermissions\)/.test(page),
  'the fill runs after the page paints, reading BOTH files\' sharing in parallel -- each lookup degrades to [] independently, and a network call never stands in front of the render');
assert(/console\.error\('Trips-only list: data-file permissions lookup failed \(showing bare emails\):', e\); return \[\];/.test(page)
  && /console\.error\('Trips-only list: trips-file permissions lookup failed \(skipping that check\):', e\); return \[\];/.test(page),
  'each failed permissions fetch degrades independently -- bare emails / skipped check, never an errored card');

// ---- wiring: add/remove flows, both confirmed, both ordered deliberately ----
{
  const iAddConfirm = page.indexOf('Add Trips-Only viewer');
  const iShareMain = page.indexOf('await shareDriveFileWithEmailAsViewer(driveFileId, email)');
  const iShareTrips = page.indexOf('await shareDriveFileWithEmailAsViewer(await resolveTripsDataFileIdForSharing(), email)');
  const iFlagOn = page.indexOf('Store.setTripsOnlyForEmail(email, true)');
  assert(iAddConfirm !== -1 && iShareMain !== -1 && iShareTrips !== -1 && iFlagOn !== -1
    && iAddConfirm < iShareMain && iShareMain < iShareTrips && iShareTrips < iFlagOn,
    'ADD: confirm dialog first, then share data file -> share trips file -> flag LAST, so a half-added person is never flagged without the access that makes sign-in work');
  const iRemConfirm = page.indexOf("Remove ${email}'s access completely?");
  const iUnshareMain = page.indexOf('await removeDriveShareForEmail(driveFileId, email)');
  const iUnshareTrips = page.indexOf('await removeDriveShareForEmail(await resolveTripsDataFileIdForSharing(), email)');
  const iFlagOff = page.indexOf('Store.setTripsOnlyForEmail(email, false)');
  assert(iRemConfirm !== -1 && iRemConfirm < iUnshareMain && iUnshareMain < iUnshareTrips && iUnshareTrips < iFlagOff,
    'REMOVE: confirm dialog first, then shares come off BEFORE the flag clears -- a midway failure leaves them locked to trips-only, never silently a full viewer');
  assert(/Pressing Add again is safe/.test(page) && /Pressing Remove again is safe/.test(page),
    'both failure toasts point at the safe retry the idempotent helpers make true');
  assert(/email === OWNER_EMAIL\.toLowerCase\(\)/.test(page),
    'the owner account cannot be added as a trips-only viewer');
  assert(/id="tripsonly-app-url"[^>]*>\$\{esc\(tripsOnlyAppUrl\(\)\)\}/.test(page)
    && /navigator\.clipboard\.writeText\(tripsOnlyAppUrl\(\)\)/.test(page)
    && /tap the link text to select it, then copy manually/.test(page),
    'the link renders in a selectable code box with a Copy button whose refused-clipboard fallback explains the manual path');
}
