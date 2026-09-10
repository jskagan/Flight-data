// Incident, found 2026-09-10 (via "the email did not change its label"): three
// duplicate flight-log-data.json files appeared between 08-18 and 08-24 and the
// app silently migrated onto the newest, stranding the original 520KB file
// (wardrobe, invoices, attire guides, outfits, laundry, favorites, Places key)
// -- also the real answer to 08-18's "why did my P/S reservations disappear."
// Two compounding weaknesses: Drive's eventually-consistent SEARCH index can
// transiently return 200-with-zero-results for a file that exists, and
// completeSignIn's owner path CREATED a fresh file on any empty result; then
// with several same-named files, files[0] of an unordered search is Drive's
// relevance ranking, which favored the newest. Three defenses now: a cached
// last-known file ID verified by DIRECT files.get first (id lookups don't use
// the search index); search matches sorted by createdTime with the OLDEST
// winning (the original is by definition the oldest, so every device
// converges); and the create path re-confirms an empty result after a delay.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
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

const find = extractFn('findDriveDataFile');

// ---- defense 1: cached id, verified by direct files.get before any search ----
assert(/const known = loadKnownDataFileId\(\);/.test(find) && find.indexOf('loadKnownDataFileId') < find.indexOf('files?q='),
  'the cached last-known file id is tried FIRST, via a direct files.get that does not touch the search index');
assert(/!f\.trashed && f\.name === DRIVE_DATA_FILENAME/.test(find),
  'the cached id is verified (right name, not trashed) rather than trusted blindly');
assert(/catch \(e\) \{[\s\S]*?falling back to the name search/.test(find),
  'a dead cached id (deleted file, transient error) falls through to the search instead of failing sign-in');

// ---- defense 2: deterministic OLDEST-first selection ----
assert(/fields=files\(id,name,createdTime\)/.test(find), 'the search asks for createdTime so it can order deterministically');
assert(/\.sort\(\(a, b\) => \(String\(a\.createdTime \|\| ''\) < String\(b\.createdTime \|\| ''\) \? -1 : 1\)\)/.test(find),
  'THE FIX: matches sort oldest-created first -- the original file always wins over any stray duplicate');
assert(/if \(files\.length > 1\) console\.warn/.test(find), 'duplicates are surfaced in the console, never silently tolerated');
assert(/saveKnownDataFileId\(files\[0\]\.id\);/.test(find), 'a successful search caches the winner for the direct-get path next time');

// ---- defense 3: the create path re-confirms an empty result ----
const signInIdx = html.indexOf("if (!driveFileId && isOwner) {");
const createGuard = html.slice(signInIdx, html.indexOf('createDriveDataFile(driveData)', signInIdx));
assert(/await new Promise\(r => setTimeout\(r, 3000\)\);\s*\n\s*driveFileId = await findDriveDataFile\(\);/.test(createGuard),
  'THE FIX: an empty search result is re-checked after a delay -- only two agreeing empty answers reach the create');
assert(/saveKnownDataFileId\(driveFileId\);/.test(html.slice(signInIdx, signInIdx + 2500)),
  'a genuinely fresh install caches its new file id immediately');

// ---- executed: the selection logic against fixtures ----
{
  const pick = files => {
    const sorted = (files || []).slice().sort((a, b) => (String(a.createdTime || '') < String(b.createdTime || '') ? -1 : 1));
    return sorted.length ? sorted[0].id : null;
  };
  const real = [
    { id: 'dup-aug24', createdTime: '2026-08-24T07:01:03.872Z' },
    { id: 'original', createdTime: '2026-07-04T15:37:23.939Z' },
    { id: 'dup-aug19', createdTime: '2026-08-19T13:41:19.211Z' },
    { id: 'dup-aug18', createdTime: '2026-08-18T17:16:17.743Z' },
  ];
  assert(pick(real) === 'original',
    'THE INCIDENT, replayed: with the real four files (in Drive\'s arbitrary order), the ORIGINAL wins');
  assert(pick(real.slice().reverse()) === 'original', 'and input order cannot change the answer');
  assert(pick([{ id: 'only', createdTime: '2026-07-04T00:00:00Z' }]) === 'only', 'a single file is returned as before');
  assert(pick([]) === null, 'no files still means null (the create path, now double-checked, handles it)');
  assert(pick([{ id: 'dated', createdTime: '2026-07-04T00:00:00Z' }, { id: 'undated' }]) === 'undated',
    'a file with no createdTime sorts first (empty string) rather than crashing -- defensive, cannot happen from a real API response');
}

// ---- defense 4: the in-app REPAIR -- duplicates get merged back, not just ignored ----
const repair = extractFn('repairDriveDataDuplicates');
assert(/await updateDriveDataFile\(files\[0\]\.id, merged\);/.test(repair),
  'the merged document lands in the OLDEST file -- the id the deterministic search picks forever after');
assert(/for \(const f of files\.slice\(1\)\) \{/.test(repair) && /trashed: true/.test(repair),
  'the newer duplicates are trashed (recoverable for 30 days), never deleted outright');
assert(/copies\.push\(\{\}\);/.test(repair), 'a corrupt copy contributes nothing rather than aborting the whole repair');
const signInSrc = extractFn('completeSignIn');
assert(/isOwner && _driveDataDuplicateFiles\.length > 1/.test(signInSrc),
  'the repair is owner-only (viewers have no Drive write) and only fires when duplicates actually exist');
assert(signInSrc.indexOf('repairDriveDataDuplicates') < signInSrc.indexOf('driveData = await loadDriveDataFile'),
  'and it runs BEFORE the data loads, so the session runs on the repaired document');

// ---- executed: the merge rules, against synthetic fixtures shaped like the incident ----
{
  eval(extractFn('tripsyMergeDataCopies').replace(/^function /, 'var tripsyMergeDataCopies = function '));
  const oldest = { // the stranded original: everything a fresh copy can never rebuild
    invoices: [{ n: 'inv1' }, { n: 'inv2' }],
    report: { hours: 42 },
    reservations: [{ reservationNumber: 'R1' }],
    tripsyWardrobe: [{ id: 'g1' }, { id: 'g2' }],
    tripsyAttireGuides: [{ tripKey: 't1' }],
    placesApiKey: 'places-key',
    tripsyEmailIntake: [{ id: 'old-1', parsedAt: 'x' }, { id: 'shared-1', parsedAt: 'x' }],
    tripsyAttachments: [
      { id: 'man-1', scope: 'trip', fileName: 'Itinerary.pdf' },                     // manual -> must survive
      { id: 'att-old', sourceEmailId: 'shared-1', fileName: 'doc.pdf', parseStatus: 'done' },
    ],
    tripsyNarrativeCache: { t1: 'old prose', t0: 'ancient prose' },
    __concurrencyTest: 'junk',
    tripsyParseProposals: [],
  };
  const mid = { // a short-lived rebuild: re-staged an already-done attachment as pending, stranded proposals
    invoices: [],
    tripsyEmailIntake: [{ id: 'shared-1', parsedAt: 'y' }],
    tripsyAttachments: [{ id: 'att-mid', sourceEmailId: 'shared-1', fileName: 'doc.pdf', parseStatus: 'pending' }],
    tripsyParseProposals: [{ id: 'stranded', events: [{ resolution: 'pending' }] }],
  };
  const newest = { // the live copy: fresh Gmail-derived data, newer features
    invoices: [],
    report: { hours: 0 },
    reservations: [{ reservationNumber: 'R1' }, { reservationNumber: 'R2' }],
    tripsyEmailIntake: [{ id: 'shared-1', parsedAt: 'z' }, { id: 'new-1', parsedAt: 'z' }],
    tripsyAttachments: [{ id: 'att-new', sourceEmailId: 'new-1', fileName: 'ticket.pdf', parseStatus: 'staged' }],
    tripInsuranceDocs: [{ id: 'ins-1' }],
    tripsyNarrativeCache: { t1: 'new prose' },
    tripsyParseProposals: [],
  };
  const m = tripsyMergeDataCopies([oldest, mid, newest]);
  assert(m.invoices.length === 2 && m.report.hours === 42,
    'invoices (hand-entered, unrebuildable) and their derived report come from the base when the newest has none');
  assert(m.tripsyWardrobe.length === 2 && m.placesApiKey === 'places-key' && m.tripsyAttireGuides.length === 1,
    'THE POINT: the wardrobe/attire/key family the duplicates stranded is back');
  assert(m.reservations.length === 2, 'Gmail-derived arrays take the newest full rescan');
  assert(m.tripInsuranceDocs.length === 1, 'newer features\' data rides along from the newest copy');
  const intakeIds = m.tripsyEmailIntake.map(e => e.id).sort();
  assert(JSON.stringify(intakeIds) === JSON.stringify(['new-1', 'old-1', 'shared-1']),
    'email intake unions by id across every copy');
  assert(m.tripsyEmailIntake.find(e => e.id === 'shared-1').parsedAt === 'z',
    'and the NEWEST copy\'s version of a shared entry wins');
  const attKeys = m.tripsyAttachments.map(a => a.id).sort();
  assert(JSON.stringify(attKeys) === JSON.stringify(['att-new', 'att-old', 'man-1']),
    'attachments dedupe on stable identity: the mid copy\'s re-staged twin collapses into the done original, manual ones survive');
  assert(!m.tripsyAttachments.some(a => a.parseStatus === 'pending'),
    'THE TRAP: a pending twin of an already-parsed attachment never survives to trigger a spurious re-parse');
  assert(m.tripsyNarrativeCache.t1 === 'new prose' && m.tripsyNarrativeCache.t0 === 'ancient prose',
    'object caches merge per key, newest winning');
  assert(m.tripsyParseProposals.length === 0, 'stranded mid-copy proposals are not resurrected (their emails were re-reviewed in the newest copy)');
  assert(!('__concurrencyTest' in m) && m.tripsyPendingChanges.length === 0, 'junk keys are dropped and the vestigial queue stays empty');
}
