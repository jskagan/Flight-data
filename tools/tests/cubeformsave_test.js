// "When I tried to add a new packing cube I hit save and nothing happened" (2026-10-06).
// The cube form's Save used to resize + upload a picked photo IN FRONT of saving the cube
// and closing the form (a Drive folder lookup plus a multipart upload, behind a disabled
// button and a muted 12px status line), and minted the id with an unguarded
// crypto.randomUUID (absent outside a secure context) -- a throw there left the form open
// with nothing saved and nothing said. Now the record is a pure builder, the cube saves and
// the form closes before any network call, and the photo catches up in the background.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

// ---- the pure record builder ------------------------------------------------------
const mk = cryptoStub => {
  const ctx = { crypto: cryptoStub, Date, Math };
  vm.createContext(ctx);
  vm.runInContext(fnSource('tripsyCubeFormRecord') + '; this.tripsyCubeFormRecord = tripsyCubeFormRecord;', ctx);
  return ctx.tripsyCubeFormRecord;
};
{
  const rec = mk({ randomUUID: () => 'uuid-1' })(null, { color: 'Blue', size: 'Medium', brand: '' });
  assert(rec.id === 'uuid-1' && rec.color === 'Blue' && rec.size === 'Medium' && rec.brand === '' && rec.driveFileId === '' && /^\d{4}-/.test(rec.addedAt),
    'a new cube gets a uuid, its three traits, no photo and an addedAt');
}
{
  const rec = mk(undefined)(null, { color: 'Black', size: 'Large', brand: 'Briggs & Riley' });
  assert(/^cube-\d+-[a-z0-9]+$/.test(rec.id), 'THE ASK: with no crypto.randomUUID the id falls back instead of throwing');
}
{
  const rec = mk({})(null, { color: 'Black', size: 'Large', brand: '' });
  assert(/^cube-\d+-/.test(rec.id), 'a crypto object without randomUUID also falls back');
}
{
  const prior = { id: 'c9', color: 'Gray', size: 'Small', brand: '', driveFileId: 'photo-old', addedAt: '2026-01-01T00:00:00.000Z', extra: 'kept' };
  const rec = mk({ randomUUID: () => 'nope' })(prior, { color: 'Gray', size: 'Medium', brand: 'Eagle Creek Reveal' });
  assert(rec.id === 'c9' && rec.driveFileId === 'photo-old' && rec.addedAt === prior.addedAt && rec.extra === 'kept' && rec.size === 'Medium' && rec.brand === 'Eagle Creek Reveal',
    'editing keeps the id, the existing photo, addedAt and unknown fields, and takes the new traits');
}

// ---- the form's Save handler never waits on the network before closing --------------
const form = fnSource('showTripsyCubeForm');
const saveAt = form.indexOf("[data-cube-save]')) return;");
const closeAt = form.indexOf('close(saved);');
assert(saveAt > 0 && closeAt > saveAt, 'the Save branch ends in close(saved)');
const saveBranch = form.slice(saveAt, closeAt).replace(/^\s*\/\/.*$/gm, ''); // code only, comments stripped
assert(!/\bawait\b/.test(saveBranch), 'THE ASK: nothing is awaited between the Save tap and the form closing');
assert(!/tripsyResizeImageBlob|uploadBlobToDrive/.test(saveBranch), 'the photo resize/upload no longer stands in front of the save');
assert(/Store\.savePackingCube\(saved\)/.test(saveBranch), 'the cube is saved (optimistically, in memory first) before the close');
assert(/tripsyCubeFormRecord\(cube, \{ color, size, brand \}\)/.test(saveBranch), 'the record comes from the pure builder');
assert(/ov\.onclick = e =>/.test(form) && !/ov\.onclick = async e =>/.test(form), 'the click handler itself is synchronous');
assert(/tripsyCubeFormUploadPhoto\(saved, blob\)/.test(form) && form.indexOf('tripsyCubeFormUploadPhoto(saved, blob)') > closeAt,
  'a picked photo uploads in the background AFTER the close');
assert(/onPhotoReady\(\)/.test(form) && /function showTripsyCubeForm\(existing, onPhotoReady\)/.test(form),
  'the opener is told when the photo lands so it can repaint');
assert(/toast\('Choose a color and a size for the cube first\.', 'error'\)/.test(saveBranch) && /var\(--red/.test(saveBranch),
  'a missing color/size is said loudly (toast + red text), not just a muted status line');
assert(/toast\(`Saved “\$\{tripsyCubeName\(saved\)\}”/.test(form), 'a successful save says so');
assert(/toast\('Could not save the cube — '/.test(saveBranch), 'a builder failure names its reason in a toast');

// ---- the background photo step -------------------------------------------------------
const up = fnSource('tripsyCubeFormUploadPhoto');
assert(/await tripsyResizeImageBlob\(blob\)/.test(up) && /await uploadBlobToDrive\(small, `packing-cube-\$\{Date\.now\(\)\}`, 'image\/jpeg'\)/.test(up),
  'the photo is resized then uploaded');
assert(/Store\.savePackingCube\(\{ \.\.\.prior, driveFileId: newId \}\)/.test(up), 'the SAME cube id is re-saved with the new photo');
assert(/tripsyCubePhotoUrlCache\.set\(newId/.test(up), 'the photo URL cache is seeded so the repaint never downloads it back');
assert(/deleteDriveFile\(oldPhoto\)/.test(up) && up.indexOf('deleteDriveFile(oldPhoto)') > up.indexOf('Store.savePackingCube('),
  'a replaced photo file is deleted only after the new one is saved');
assert(/catch \(err\)[\s\S]*toast\(`The cube is saved, but its photo didn’t upload/.test(up) && /return false;/.test(up),
  'an upload failure is toasted and never un-saves the cube');

// ---- the openers repaint when the photo lands -----------------------------------------
const picker = fnSource('showTripsyCubePicker');
assert(/showTripsyCubeForm\(null, \(\) => \{ if \(ov\.style\.display !== 'none'\) render\(\); \}\)/.test(picker),
  'the cube picker re-renders its grid when a new cube\'s photo lands');
const contents = fnSource('showTripsyCubeContents');
assert(/const repaint = \(\) => \{ if \(ov\.style\.display !== 'none'\) render\(\); \};/.test(contents)
  && /showTripsyCubeForm\(null, repaint\)/.test(contents) && /showTripsyCubeForm\(cube, repaint\)/.test(contents),
  'the Cubes page repaints for both Add cube and Edit when the photo lands');
