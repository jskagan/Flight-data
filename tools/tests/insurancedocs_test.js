// "For every trip, automatically add the trip insurance documents policy and
// confirmation of benefits to the list of downloaded documents" (2026-10-18).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const api = new Function('esc', [fnSource('tripsyInsuranceDriveFileIds'), fnSource('tripsyInsuranceDocMenuRowHtml'), fnSource('tripsyInsuranceDocsMenuHtml'),
  'return { ids: tripsyInsuranceDriveFileIds, row: tripsyInsuranceDocMenuRowHtml, menu: tripsyInsuranceDocsMenuHtml };'].join('\n'))(esc);

const docs = [
  { id: 'i2', fileName: 'Policy.pdf', driveFileId: 'f-policy', mimeType: 'application/pdf' },
  { id: 'i1', fileName: 'Confirmation of Benefits.pdf', driveFileId: 'f-cob', mimeType: 'application/pdf' },
  { id: 'i3', fileName: 'broken', driveFileId: '' }, // no file -- never listed
];
// ---- THE ASK: the insurance documents appear on a trip's Documents menu ----
{
  const h = api.menu(docs, new Set(['f-policy']), true);
  assert(/Trip Insurance/.test(h), 'the section is labelled Trip Insurance');
  assert(h.indexOf('Confirmation of Benefits.pdf') < h.indexOf('Policy.pdf'), 'documents list alphabetically');
  assert(!/broken/.test(h), 'a record with no Drive file is not listed');
  assert(/data-tripsy-open-attachment data-drive-file-id="f-policy"/.test(h) && /data-tripsy-copy-attachment data-drive-file-id="f-cob"/.test(h),
    'each row opens and copies through the SAME handlers attachment rows use (keyed on the Drive file id)');
  assert(!/data-tripsy-rename-attachment|data-tripsy-delete-attachment|data-tripsy-offline-item-toggle/.test(h),
    'rows are read-only: no rename, delete or per-trip offline toggle (they belong to every trip by rule)');
  assert(/title="Downloaded to this device">✓/.test(h) && /title="Downloads to this device automatically at sign-in">⬇️/.test(h),
    'a cached document shows ✓, an uncached one shows the pending download');
  assert(/height:1px; background:var\(--line\)/.test(h), 'with other documents present the section is divided from them');
  assert(!/height:1px; background:var\(--line\)/.test(api.menu(docs, new Set(), false)), 'with no other documents there is no divider');
  assert(api.menu([], new Set(), true) === '' && api.menu(null, null, false) === '', 'nothing uploaded to Trip Insurance -> no section');
  assert([...api.ids(docs)].join(',') === 'f-policy,f-cob', 'the id set skips records with no file');
}
// ---- every trip card carries the section, and the menu button shows for it alone ----
{
  const i = html.indexOf("const insuranceDocsHtml = isPendingCreateTrip ? '' : tripsyInsuranceDocsMenuHtml(driveData.tripInsuranceDocs, offlineDriveFileIds, !!(tripAttachments.length || eventAttachmentEntries.length));");
  assert(i > 0, 'THE ASK: every trip card builds the Trip Insurance section from the shared Trip Insurance list (not a placeholder trip)');
  assert(/\(tripAttachments\.length \|\| eventAttachmentEntries\.length \|\| insuranceDocsHtml\)\) \? iconLabelButton/.test(html), 'a trip with nothing attached still gets the Documents menu once insurance documents exist');
  const menuAt = html.indexOf('Downloaded Documents</div>');
  const insAt = html.indexOf('${insuranceDocsHtml}', menuAt);
  const evAt = html.indexOf('${documentEventDocsHtml}', menuAt);
  assert(insAt > evAt && evAt > menuAt, 'the section sits under the Downloaded Documents header, after the trip\'s own and event documents');
}
// ---- the offline cache keeps them: the orphan sweep no longer deletes insurance documents ----
{
  const rec = fnSource('reconcileTripsyOfflineDocs');
  assert(/const insuranceDriveFileIds = tripsyInsuranceDriveFileIds\(driveData && driveData\.tripInsuranceDocs\);/.test(rec)
    && /!attachmentByDriveFileId\.has\(doc\.driveFileId\) && !insuranceDriveFileIds\.has\(doc\.driveFileId\)/.test(rec),
    'the orphan sweep exempts the Trip Insurance documents (they share the store but are not attachments)');
  const csi = fnSource('completeSignIn');
  assert(/Store\.listTripInsuranceDocs\(\)\.then\(cacheTripInsuranceDocsOffline\)/.test(csi), 'sign-in still downloads them to this device');
}
