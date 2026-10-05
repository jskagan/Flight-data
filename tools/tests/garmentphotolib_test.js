// "How do I select a photo from my photo library to add a garment" (2026-10-05):
// the garment form's one hidden input carried capture="environment", so iPhone/iPad
// went straight to the camera and never offered the library.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const start = html.indexOf('function showWardrobeGarmentForm(');
const form = html.slice(start, html.indexOf("$('#tw-form-save').onclick", start));
assert(/<input type="file" id="tw-form-file" accept="image\/\*" style="display:none;">/.test(html),
  'the garment photo input has NO capture attribute, so iOS offers Photo Library AND Take Photo');
assert(/\$\('#tw-form-pick'\)\.onclick = \(\) => fileInput\.click\(\);/.test(form) && !/tripsyPickImageFile\(/.test(form),
  'THE ASK (2026-10-05 follow-up): the button opens that system sheet directly — no in-app Take/Choose step in front of it');
const picker = html.slice(html.indexOf('function tripsyPickImageFile('), html.indexOf('function tripsyPickImageFile(') + 2500);
assert(/data-pick-lib accept="image\/\*" multiple style/.test(picker) && !/data-pick-lib[^>]*capture/.test(picker),
  'the picker\'s library input carries no capture attribute, so it opens the photo library');
