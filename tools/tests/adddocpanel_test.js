// "When a user selects add and then a new document, do not bring up the
// trip details card or the add doc button" (2026-09-28). The + Add menu's
// "Doc" choice used to render and show BOTH the Edit Trip panel (the trip
// details card, whose own "Add Doc" button then sat beside the very form
// it opens) and the attach form -- a relic of Add Doc historically living
// inside the Edit panel. It now opens ONLY the attach form, which is
// self-contained (its Save/Cancel close only itself).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// Isolate the add-doc menu item's click handler (from its querySelectorAll
// to the next handler-wiring statement).
const start = html.indexOf('container.querySelectorAll("[data-tripsy-add-doc-menu-item]")');
assert(start !== -1, 'the add-doc menu item handler exists');
const end = html.indexOf('container.querySelectorAll(', start + 10);
const handler = html.slice(start, end);

assert(/renderTripsyAttachPanel\(attachPanel, \{ scope: 'trip', tripKey, eventKey: null \}\)/.test(handler)
  && /attachPanel\.style\.display = "block"/.test(handler),
  'Add -> Doc opens the attach form');
assert(!/renderTripsyEditTripPanel/.test(handler) && !/data-tripsy-edit-trip-panel/.test(handler)
  && !/editPanel/.test(handler),
  'THE FIX: it no longer renders or shows the Edit Trip panel (the trip details card with its Add Doc button)');
assert(/closeAllTripsyTripPanels\(\)/.test(handler),
  'other open panels still close first, same as every panel-opening trigger');

// The Edit panel's own "Add Doc" button is untouched -- opening the trip
// details first and attaching from there still works as before.
assert(/data-tripsy-edit-trip-add-doc/.test(html),
  'the Edit Trip panel keeps its own Add Doc button (that flow is unchanged)');
