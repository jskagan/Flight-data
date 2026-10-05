// "How do I select a photo from my photo library to add a garment" (2026-10-05):
// the garment form's one hidden input carried capture="environment", so iPhone/iPad
// went straight to the camera and never offered the library.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const start = html.indexOf('function showWardrobeGarmentForm(');
const form = html.slice(start, html.indexOf("$('#tw-form-save').onclick", start));
assert(/\$\('#tw-form-pick'\)\.onclick = \(\) => tripsyPickImageFile\(/.test(form),
  'THE ASK: the garment photo button opens the shared Take Photo / Choose Photo picker');
assert(!/id="tw-form-file"/.test(html), 'the camera-only hidden input is gone');
const picker = html.slice(html.indexOf('function tripsyPickImageFile('), html.indexOf('function tripsyPickImageFile(') + 2500);
assert(/data-pick-lib accept="image\/\*" multiple style/.test(picker) && !/data-pick-lib[^>]*capture/.test(picker),
  'the picker\'s library input carries no capture attribute, so it opens the photo library');
