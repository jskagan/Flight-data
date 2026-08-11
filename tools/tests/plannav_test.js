const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// --- 1. the two list-only buttons are hidden on a garment page, shown on the list ---
assert(/const setListOnlyButtons = show => \{[\s\S]*?'#tw-select-addline', '#tw-select-incomplete'/.test(html),
  'one helper governs both list-only buttons');
const renderList = html.slice(html.indexOf('  const renderList = () => {'), html.indexOf('  const renderDetail = () => {'));
const renderDetail = html.slice(html.indexOf('  const renderDetail = () => {'), html.indexOf('  const renderDetail = () => {') + 2500);
assert(/setListOnlyButtons\(true\)/.test(renderList), 'the list restores them');
assert(/setListOnlyButtons\(false\)/.test(renderDetail), 'the garment page hides them');
// It must be looked up live, not closed over: the button consts are declared ~300 lines
// BELOW the render functions, so a captured reference would be in the temporal dead zone.
const helper = html.match(/const setListOnlyButtons = show => \{[\s\S]*?\n  \};/)[0];
assert(/ov\.querySelector\(id\)/.test(helper), 'the helper queries the DOM rather than capturing consts');
// And it must be declared ABOVE the render functions that call it.
assert(html.indexOf('const setListOnlyButtons') < html.indexOf('  const renderList = () => {'),
  'declared before its first caller');

// --- 1b. Packing Status does the same for ITS list-only buttons ---
const statusFn = html.slice(html.indexOf('async function tripsyWardrobePackingList('));
const sHelper = statusFn.match(/const setListOnlyButtons = show => \{[\s\S]*?\n  \};/)[0];
assert(/'#tw-packlist-unpacked', '#tw-packlist-cubes'/.test(sHelper),
  'Packing Status governs Unpacked Items Only + Cubes together');
assert(/ov\.querySelector\(id\)/.test(sHelper), 'also queried live, not captured');
const sList = statusFn.slice(statusFn.indexOf('  const renderList = () => {'), statusFn.indexOf('  const renderDetail = () => {'));
const sDetail = statusFn.slice(statusFn.indexOf('  const renderDetail = () => {'), statusFn.indexOf('  const renderDetail = () => {') + 2500);
assert(/setListOnlyButtons\(true\)/.test(sList), 'the Status list restores them');
assert(/setListOnlyButtons\(false\)/.test(sDetail), 'the Status garment page hides them');
assert(statusFn.indexOf('const setListOnlyButtons') < statusFn.indexOf('  const renderList = () => {'),
  'declared before its first caller');
// The buttons that REMAIN on the Status garment page still work: hiding must be display
// only, never removal, or their handlers would be bound to nothing.
assert(!/removeChild|\.remove\(\)/.test(sHelper), 'buttons are hidden, not removed');
// The filter's own className toggle is separate from display, so an active filter that
// then gets hidden does not come back styled wrong.
assert(/syncUnpackedBtn = \(\) => \{ if \(unpackedBtn\) unpackedBtn\.className/.test(html),
  'the filter still tracks its own active styling independently');

// --- 2. Plan -> Packing Status carries the current line, in both legs ---
const statusHandler = html.slice(html.indexOf("const statusBtn = ov.querySelector('#tw-select-status');"),
                                 html.indexOf("const statusBtn = ov.querySelector('#tw-select-status');") + 700);
assert(/view\.mode === 'detail'/.test(statusHandler), 'it checks whether a garment page is open');
assert(/lineName: ln\.name/.test(statusHandler), 'and addresses the line by NAME, as the other direction does');
assert(/tripsyWardrobePackingList\(tripKey, tripName, person, \(\) => tripsyWardrobePackForTrip\(tripKey, tripName, person, onClose, where\), where\)/.test(statusHandler),
  'the line is passed BOTH to Packing Status and to the Plan page it reopens on the way back');

// --- the mirror direction must still do the same, so the pair stays symmetric ---
const planHandler = html.slice(html.indexOf("const planBtn = ov.querySelector('#tw-packlist-plan');"),
                               html.indexOf("const planBtn = ov.querySelector('#tw-packlist-plan');") + 700);
assert(/statusView\.mode === 'detail'/.test(planHandler) && /lineName: ln\.name/.test(planHandler),
  'Packing Status -> Plan still hands over its line');

// --- both receivers resolve that line by name, tolerating a renumbered guide ---
const receivers = html.match(/if \(initialLine && initialLine\.tier\) \{[\s\S]*?\n  \}/g) || [];
assert(receivers.length === 2, 'both pages accept an initial line -> ' + receivers.length);
for (const r of receivers) {
  assert(/findIndex\(ln => ln\.name === initialLine\.lineName\)/.test(r), 'resolved by name, not index');
  assert(/if \(idx >= 0\)/.test(r), 'and falls back to the list when that line no longer exists');
}
