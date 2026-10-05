// "There was a delay when I hit a button to remove a garment from an outfit" (2026-10-05):
// the outfit modal's Swap/Remove must repaint BEFORE the Drive save, not after it.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const start = html.indexOf('async function showTripsyOutfitModal(');
const fn = html.slice(start, html.indexOf('\n}\n', start));
const h0 = fn.indexOf("querySelectorAll('[data-tw-outfit-swap]')");
const handler = fn.slice(h0, fn.indexOf("querySelectorAll('[data-tw-outfit-photo]')", h0));

assert(/let tripsyOutfitSwapChain = Promise\.resolve\(\);/.test(html), 'a module-level chain serializes background swap saves');
const repaint = handler.indexOf('showTripsyOutfitModal(tripKey, eventId, person, opts);');
const save = handler.indexOf('Store.saveTripsyTripOutfits(outfits)');
assert(repaint > 0 && save > 0 && repaint < save, 'THE ASK: the modal repaints before the save is even started');
assert(!/await Store\.saveTripsyTripOutfits/.test(handler.slice(0, handler.indexOf('tripsyOutfitSwapChain = '))),
  'nothing awaits the save in the foreground');
assert(/const prevIds = block\.garmentIds\.slice\(\);/.test(handler) && /block\.garmentIds = prevIds;/.test(handler),
  'a failed save restores the block');
assert(/toast\('Could not save the outfit change — it was undone\.', 'error'\)/.test(handler), 'and says so');
const chain = handler.slice(handler.indexOf('tripsyOutfitSwapChain = '));
assert(chain.indexOf('tripsyOutfitAutoAdjustAfterSwap') > chain.indexOf('saveTripsyTripOutfits'),
  'auto-reconfigure still runs only after a successful save, in the background');
assert(/if \(ov\.style\.display !== 'none'\) showTripsyOutfitModal/.test(handler),
  'background follow-ups repaint only if the modal is still open');
assert(/if \(chosen !== TRIPSY_OUTFIT_SWAP_REMOVE && chosen === currentId\) return;/.test(handler),
  'picking the same garment is still a no-op');
