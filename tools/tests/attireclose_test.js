const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const ids = ['tripsy-attire-close-btn', 'tripsy-attire-definitions-doc-close-btn',
             'tripsy-attire-detail-close-btn', 'tripsy-attire-dressguide-close-btn'];

for (const id of ids) {
  const re = new RegExp(`<button class="tripsy-close-x" id="${id}"[^>]*>&#10005;</button>`);
  assert(re.test(html), `${id} is now the red-X box`);
  // The handler is wired by ID, so it must still be found by that exact id.
  assert(html.includes(`querySelector('#${id}')`), `${id} is still wired by id`);
  assert(!new RegExp(`id="${id}">Close<`).test(html), `${id} no longer renders the word "Close"`);
}
// No attire page kept a worded Close behind.
const attireCloseLeft = html.match(/id="tripsy-attire-[a-z-]*close-btn">Close</g);
assert(!attireCloseLeft, 'no attire page still has a worded Close -> ' + JSON.stringify(attireCloseLeft));

// The style exists, is square (fixed width AND height, not padding), and is red.
const css = (html.match(/\.tripsy-close-x \{[\s\S]*?\}/) || [''])[0];
assert(/width: 32px/.test(css) && /height: 32px/.test(css), 'the box is sized square, not padded');
assert(/border: 2px solid #E04B3A/.test(css), 'the box outline is thick and bright');
assert(/font-weight: 800/.test(css) && /font-size: 20px/.test(css), 'the X itself is bold and large');
assert(/color: #E04B3A/.test(css), 'glyph and outline are the SAME red, so it reads as one control');
// Sized to the header line it sits on (an 18px h2), not left towering over it.
assert(/align-self: center/.test(css), 'and centred on that line');
assert(/color: #E04B3A/.test(css), 'the X is red');
assert(/border:/.test(css) && /border-radius:/.test(css), 'and it is drawn as a box');
// Accessibility: the glyph names nothing on its own.
for (const id of ids) {
  const tag = (html.match(new RegExp(`<button class="tripsy-close-x" id="${id}"[^>]*>`)) || [''])[0];
  assert(/aria-label="Close"/.test(tag), `${id} keeps an accessible name`);
}
// It must NOT reuse .tripsy-update-btn / .btn, whose padding+font sizing is built for words.
assert(!/class="tripsy-update-btn tripsy-close-x"/.test(html), 'the X does not inherit the worded-button sizing');
assert(!/class="btn tripsy-close-x"/.test(html), 'nor the wardrobe .btn sizing');

// ---- the packing screens, same treatment, behaviour untouched ----
const packing = [
  ['id="tw-select-toggle"', 'Plan Packing List'],
  ['id="tw-packlist-done"', 'Packing Status'],
  ['data-tw-cubes-close', 'Cubes'],
  ['data-outfit-list-close', 'Outfits'],
  ['data-tw-outfit-close', 'a single outfit'],
  ['data-tw-weardays-close', 'Wear Days'],
];
for (const [sel, label] of packing) {
  const re = new RegExp(`<button class="tripsy-close-x" ${sel.replace(/[-[\]]/g, m => '\\' + m)}[^>]*>&#10005;</button>`);
  assert(re.test(html), `${label} closes with the red-X box`);
  assert(!new RegExp(`<button class="btn" ${sel.replace(/[-[\]]/g, m => '\\' + m)}[^>]*>Close<`).test(html),
    `${label} no longer has a worded Close`);
}
// Both Cubes closes (the list AND the per-cube drill-down) were converted, or the
// drill-down would still show a worded button beside the same-shaped list one.
assert((html.match(/class="tripsy-close-x" data-tw-cubes-close/g) || []).length === 2,
  'both Cubes closes converted');
// BEHAVIOUR MUST BE UNCHANGED: the contextual handlers key off the same id/attribute,
// and the two genuinely contextual screens still branch on their detail mode.
assert(/closeBtn\.onclick = \(\) => \{\s*\n\s*if \(view\.mode === 'detail'\)/.test(html),
  'Plan Packing List still goes back from a detail screen');
assert(/const leaveOrClose = \(\) => \{ if \(statusView\.mode === 'detail'\)/.test(html),
  'Packing Status still goes back from a detail screen');
assert(/if \(view\.mode === 'cube'\) \{ view = \{ mode: 'list' \}; render\(\); return; \}/.test(html),
  'Cubes still goes back from a drill-down');
// The Plan page used to relabel this button on every render; a leftover assignment
// would overwrite the glyph with the word again.
assert(!/closeBtn\.textContent = 'Close'/.test(html), 'nothing relabels the X back to "Close"');


// ---- the X must sit on the TITLE's own row, not inside a group that WRAPS ----
// Packing Status, Plan Packing List and Outfits all have a button group with
// flex-wrap; when it wrapped, the close control dropped to a second line with it.
for (const [titleId, sel, label] of [
  ['tw-packlist-title', 'id="tw-packlist-done"', 'Packing Status'],
  ['tw-select-title', 'id="tw-select-toggle"', 'Plan Packing List'],
]) {
  const i = html.indexOf(`id="${titleId}"`);
  const j = html.indexOf(sel, i);
  // Everything between the title and the X: it must close the h2 and go straight into
  // the X's own button tag -- no other button, and no wrapping container, in between.
  const between = html.slice(i, j);
  assert(j > i, `${label}: the X follows the title`);
  assert(!/flex-wrap/.test(between), `${label}: nothing between them can wrap`);
  assert(/<\/h2>\s*<button class="tripsy-close-x"$/.test(between.trim() + ''),
    `${label}: the X is the title row's own next element -> ${JSON.stringify(between.slice(-60))}`);
  // The old copy inside the wrapping button group must be gone: exactly one in the markup.
  assert((html.match(new RegExp(sel, 'g')) || []).length === 1, `${label}: exactly one X in the markup`);
}
const oi = html.indexOf('>Outfits</h2>');
assert(/^\s*<button class="tripsy-close-x" data-outfit-list-close/.test(html.slice(oi + 13)),
  'Outfits: the X immediately follows its header');
// A long trip name must not shove the X off the row -- the title has to be able to shrink.
for (const titleId of ['tw-packlist-title', 'tw-select-title']) {
  const tag = html.match(new RegExp(`<h2 id="${titleId}"[^>]*>`))[0];
  assert(/min-width:0/.test(tag) && /text-overflow:ellipsis/.test(tag),
    `${titleId} shrinks and ellipsises rather than pushing the X out`);
}
