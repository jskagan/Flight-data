// "When I deleted an event from the itinerary I received the following dialog message:
// 'Delete "Scotch Tasting" from Tripsy? This can't be undone once it syncs.' There
// should be no user-facing messages or text with the words Tripsy." The delete confirm
// dialogs were also stale in a second way: they described a "syncs" delay from the old
// pending-changes-queue model, removed in the 2026-08-04 Tripsy migration -- edits are
// direct writes now (see CLAUDE.md), so "once it syncs" was inaccurate even before
// the branding issue. Fixed both at once. Two real external references (the
// "Tripsy Trips Refresh" Claude routine name, the "Tripsy Refresh Worker Secret" Drive
// file name) are deliberately LEFT AS-IS -- the owner asked to keep them until the
// actual external artifacts are renamed to match, since changing only the app's display
// text would misdirect the instructions.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the exact reported dialogs, and their siblings, no longer say "Tripsy" or
// describe the retired "syncs" delay ----
assert(/confirm\(`Delete "\$\{row\.tripsy_summary\}"\? This can't be undone\.`\)/.test(html),
  'THE BUG: the Update-page delete confirm no longer mentions Tripsy or a sync delay');
assert(/confirm\(`Delete the entire "\$\{name\}" trip\? This can't be undone\.`\)/.test(html),
  'the whole-trip delete confirm too');
assert(/confirm\(`Delete "\$\{summary\}"\? This can't be undone\.`\)/.test(html),
  'and the single-event delete confirm from the timeline');
assert(!/from Tripsy\? This can't be undone once it syncs/.test(html),
  'sanity: the old wording is gone everywhere, not just patched in one spot');

// ---- a representative sample of the other user-facing strings that said "Tripsy" ----
assert(!/Every doc attached to a Tripsy trip or event/.test(html), 'the Flagged Attachments help text');
assert(!/Nothing has reached Tripsy yet/.test(html), 'the Review Parsed Docs flag-state explainer');
assert(!/the next Tripsy refresh reads it automatically/.test(html), 'the Docs-dropdown flag tooltip (both copies)');
assert(!/— not in Tripsy —/.test(html), 'the itinerary-comparison empty-side cell');
assert(!/Missing from Tripsy/.test(html), 'the itinerary-comparison status label');
assert(!/comparing to Tripsy…/.test(html), 'the itinerary-comparison loading message');
assert(!/No Tripsy trips in range/.test(html), 'the Travel View empty state');
assert(!/removed from Tripsy on next sync/.test(html), 'the pending-delete-trip card (vestigial, but still fixed)');
assert(!/not yet created in Tripsy/.test(html), 'both pending-create-trip badges (vestigial, but still fixed)');
assert(!/sent to Tripsy yet/.test(html), 'the Review Parsed Docs page-sub');

// ---- deliberately UNCHANGED: real external names the owner chose to keep for now ----
assert(/"Tripsy Trips Refresh" routine/.test(html), 'the real Claude routine name is left alone, per the owner\'s choice');
assert(/Tripsy Refresh Worker Secret/.test(html), 'the real Drive file name is left alone too');

// ---- sanity: internal identifiers (tripsyFoo, TRIPSY_X, code comments) are UNCHANGED
// -- this fix only ever touched literal user-facing strings, never renamed the internal
// convention CLAUDE.md documents (kept for historical/continuity reasons) ----
assert(/function tripsyWardrobeNeedByTier/.test(html), 'internal function names are untouched');
assert(/const TRIPSY_ATTIRE_CATEGORY_ORDER/.test(html), 'internal constant names are untouched');
