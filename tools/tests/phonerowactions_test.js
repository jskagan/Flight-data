// "It's not showing the edit button in the my trips view" (2026-10-20, iPhone): a phone has
// no room for a timeline row's title AND its action icons past the 194px indent, and the trip
// card gave up overflow-x:auto for the sticky header the same day -- so the icons were clipped
// by .main's overflow-x:hidden with no way to scroll to them. Below 600px the rows WRAP.
// Synthetic only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const css = html.slice(0, html.indexOf('</style>'));
const phone = css.slice(css.indexOf('.tripsy-tl-row { padding-left: 8px'), css.indexOf('.tripsy-tl-row { padding-left: 8px') + 700);
const before = css.slice(Math.max(0, css.indexOf('.tripsy-tl-row { padding-left: 8px') - 60), css.indexOf('.tripsy-tl-row { padding-left: 8px'));
assert(/@media \(max-width: 600px\) \{\s*$/.test(before), 'the wrap rules live in the phone (<=600px) block only -- wide screens keep title-beside-icons');
assert(/\.tripsy-tl-body \{ flex-wrap: wrap; \}/.test(phone) && /\.tripsy-tl-actions \{ flex-wrap: wrap; flex-basis: 100%; \}/.test(phone),
  'THE ASK: on a phone the row\'s action icons (✏️ among them) drop under the title instead of being clipped off the right edge');
assert(/\.tripsy-trip-head \{ flex-wrap: wrap; \}/.test(phone) && /\.tripsy-trip-head-actions \{ flex-wrap: wrap;/.test(phone),
  'and the trip header\'s icon-label buttons wrap under the trip name');
assert(/\.tripsy-tl-row \{ padding-left: 8px; gap: 10px; \}/.test(phone) && /\.tripsy-tl-inner \{ gap: 10px !important; \}/.test(phone), 'the row indent tightens on a phone');
// ---- the markup carries the classes the rules target ----
assert(/<div class="tripsy-tl-inner" style="display:flex; align-items:flex-start; gap:20px; flex:1; min-width:0;">/.test(html), 'tripsy-tl-inner on the dot+body wrapper');
assert(/<div class="tripsy-tl-body" style="display:flex; justify-content:space-between;/.test(html), 'tripsy-tl-body on the title/actions wrapper');
assert(/<div class="tripsy-tl-actions" style="display:flex; gap:6px; flex-shrink:0;">\$\{entryBtnHtml\}\$\{outfitGlyphHtml\}\$\{ownerIconsHtml\}<\/div>/.test(html), 'tripsy-tl-actions on the icon block');
assert(/<div class="tripsy-trip-head-actions" style="display:flex; align-items:flex-start; gap:16px; flex-shrink:0;">/.test(html), 'tripsy-trip-head-actions on the header button group');
assert(/\.card\.tripsy-trip-card \{ overflow: visible;/.test(css), 'context: the trip card has no horizontal scroll of its own (the sticky header needs overflow:visible), which is why wrapping is the fix');
