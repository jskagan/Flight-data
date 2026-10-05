// "Whenever a user selects add garment, make sure all the fields to describe that
// garment are cleared from the last time a garment was added" (2026-10-05).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const start = html.indexOf('function showWardrobeGarmentForm(');
const form = html.slice(start, html.indexOf('\n}\n', start));
const removeAt = form.indexOf("document.getElementById('tw-form-overlay')");
assert(removeAt > 0 && /if \(stale\) stale\.remove\(\);/.test(form) && removeAt < form.indexOf('getOrCreateWardrobeFormOverlay()'),
  'THE ASK: the previous form node is discarded before a new one is built, so nothing from the last open carries over');
assert(/\$\('#tw-form-name'\)\.value = g\.name \|\| '';/.test(form) && /\$\('#tw-form-color'\)\.value = g\.color \|\| '';/.test(form)
  && /new Set\(g\.tiers \|\| \[\]\)/.test(form) && /let pendingBlob = null;/.test(form),
  'name, color, dress codes and photo all start empty for a new garment');
assert(/\(existing \? '' : '<option value="" selected>Select type…<\/option>'\)/.test(form),
  'a new garment starts with no type pre-picked');
assert(/group: \$\('#tw-form-group'\)\.value \|\| tripsyAttirePackingGroupOf\(\{ name \}\)/.test(form),
  'an unchosen type is derived from the name on save, never stored blank');
