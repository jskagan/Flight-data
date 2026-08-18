// "When I am editing events in my trips on an iPhone, the minutes drop down menu does
// not display correctly. Also, the order of drop down menus when entering time of an
// event should be hours, then minutes, then am/pm." Root cause: a datetime field sat
// in HALF of a two-column grid, inside a panel that keeps its 194px timeline indent on
// every screen -- on an iPhone that crushed the hour/minute/AM-PM controls into
// unreadable slivers (flex:1 with min-width:0 lets them shrink to nothing), which also
// destroyed any legible ordering. Fixed: (1) the section grid is a class
// (.tp-edit-grid) so a media query can drop it to ONE column on phones; (2) the panel
// indent is removed under 600px (!important, since it's an inline style); (3) every
// datetime field spans the full grid width; (4) the time trio lives in .tp-time-row --
// hour, then minutes, then AM/PM, flex-wrap:nowrap with a real min-width per control,
// so no viewport can crush or reflow them.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- CSS: the grid class, the phone media query, and the time row ----
assert(/\.tp-edit-grid \{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px 16px; \}/.test(html),
  'the section grid lives in a class (two columns on a wide screen)');
const mq = html.slice(html.indexOf('@media (max-width: 600px) {'), html.indexOf('}', html.indexOf('[data-tripsy-edit-panel], [data-tripsy-pending-panel]')) + 1);
assert(/\.tp-edit-grid \{ grid-template-columns: 1fr; \}/.test(mq), 'THE FIX: one column on a phone');
assert(/\[data-tripsy-edit-panel\], \[data-tripsy-pending-panel\] \{ margin-left: 0 !important; \}/.test(mq),
  'the 194px timeline indent is dropped on a phone (!important beats the inline style)');
assert(/\.tp-time-row \{ display: flex; gap: 6px; flex: 1 1 180px; min-width: 0; flex-wrap: nowrap; \}/.test(html),
  'the time trio never wraps -- one line, always');
assert(/\.tp-time-row > \[data-tripsy-edit-time-hour\] \{ flex: 1; min-width: 52px; \}/.test(html)
  && /\.tp-time-row > \.tp-min-combo \{ flex: 1; min-width: 64px; \}/.test(html)
  && /\.tp-time-row > \[data-tripsy-edit-time-ampm\] \{ flex: 1; min-width: 58px; \}/.test(html),
  'THE FIX: every time control has a real minimum width, so none can be crushed to a sliver');

// ---- markup: order within the row is hour -> minutes -> AM/PM ----
const rowStart = html.indexOf('<div class="tp-time-row">');
assert(rowStart > -1, 'sanity: found the time row markup');
const rowEnd = html.indexOf('</div>\n      </div>`;', rowStart);
const row = html.slice(rowStart, rowEnd);
const hourIdx = row.indexOf('data-tripsy-edit-time-hour');
const minIdx = row.indexOf('data-tripsy-edit-time-min');
const ampmIdx = row.indexOf('data-tripsy-edit-time-ampm');
assert(hourIdx > -1 && minIdx > -1 && ampmIdx > -1, 'all three time controls are in the row');
assert(hourIdx < minIdx && minIdx < ampmIdx, 'THE ASK: hours, then minutes, then AM/PM');

// ---- markup: datetime fields span the full grid width ----
assert(/f\.kind === 'textarea' \|\| f\.kind === 'datetime' \? 'grid-column:1 \/ -1;' : ''/.test(html),
  'a datetime field spans both grid columns -- a date input plus three time controls never fit half a column');
assert(/<div class="tp-edit-grid">/.test(html), 'the section markup uses the grid class (so the media query actually applies)');

// ---- the old crushable styling is gone from the time controls ----
assert(!/const styleSel = 'flex:1; min-width:0;';/.test(html),
  'the old flex:1/min-width:0 style (shrink-to-nothing) is gone from the datetime renderer');
