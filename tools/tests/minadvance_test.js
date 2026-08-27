// "When editing the time fields in detailed event cards, after the user selects the
// minutes, do not open the calendar menu. Instead, open the am/pm indicator. Once the
// user selects am or pm, do not open any more menus automatically." The minute
// dropdown's pick handler used to end in input.focus() -- refocusing the minute box,
// with the tap on a phone landing on/near the DATE input below, which popped the
// CALENDAR after every minute pick. It now advances to the AM/PM <select> of the SAME
// time row (focus + a guarded showPicker() where the platform has it), and that is
// the END of the chain: nothing anywhere auto-opens on an AM/PM choice.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- isolate the minute-combo wiring block ----
const blkStart = html.indexOf("panel.querySelectorAll('.tp-min-combo').forEach(combo => {");
assert(blkStart > -1, 'sanity: found the minute-combo wiring');
const blkEnd = html.indexOf('\n  });\n', html.indexOf('showPicker', blkStart)) + 6;
const blk = html.slice(blkStart, blkEnd);

// ---- source patterns ----
assert(!/closeMenu\(\);\s*\n\s*input\.focus\(\);/.test(blk),
  'THE FIX: picking a minute no longer refocuses the minute input (the refocus/ghost-tap path that opened the calendar)');
assert(/const row = combo\.closest\('\.tp-time-row'\);/.test(blk)
  && /row\.querySelector\('\[data-tripsy-edit-time-ampm\]'\)/.test(blk),
  'the AM/PM control is found within the SAME time row -- a form with several datetime fields advances to its own row, never another');
assert(/ampm\.focus\(\);/.test(blk), 'THE ASK: after minutes, the AM/PM indicator is what gets opened next');
assert(/try \{ if \(typeof ampm\.showPicker === 'function'\) ampm\.showPicker\(\); \} catch \(e\)/.test(blk),
  'showPicker is feature-tested AND try/caught -- older WebViews without it just get a focused (unopened) AM/PM');
// The chain must END at AM/PM: no listener anywhere auto-opens anything on the
// AM/PM select changing.
const ampmListeners = html.match(/data-tripsy-edit-time-ampm[^\n]*addEventListener/g) || [];
assert(ampmListeners.length === 0,
  'THE ASK: nothing is wired to the AM/PM select itself -- choosing AM or PM opens no further menu');

// ---- executed: the pick handler against a stub DOM ----
{
  const events = [];
  const ampmNode = {
    focus: () => events.push('ampm-focus'),
    showPicker: () => events.push('ampm-showPicker'),
  };
  const rowNode = { querySelector: sel => (sel === '[data-tripsy-edit-time-ampm]' ? ampmNode : null) };
  const optNode = { dataset: { min: '30' }, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
  const menuNode = {
    style: { display: 'block' },
    addEventListener: () => {},
    querySelectorAll: () => [optNode],
  };
  const inputNode = {
    value: '',
    handlers: {},
    addEventListener(t, f) { this.handlers[t] = f; },
    dispatchEvent: e => events.push('input-event:' + e.type),
    focus: () => events.push('minute-refocus'),
  };
  const combo = {
    closest: sel => (sel === '.tp-time-row' ? rowNode : null),
    querySelector: sel => (sel.includes('edit-time-min') ? inputNode : menuNode),
  };
  const panel = { querySelectorAll: sel => (sel === '.tp-min-combo' ? [combo] : []) };
  global.Event = class { constructor(type) { this.type = type; } };
  eval(blk);

  optNode.handlers.click();
  assert(inputNode.value === '30', 'the picked quarter-hour lands in the minute box');
  assert(events.includes('input-event:input'), "an 'input' event still fires so change-detection enables Save");
  assert(menuNode.style.display === 'none', 'the minute menu closes');
  assert(events.includes('ampm-focus'), 'THE ASK: focus advances to AM/PM');
  assert(events.includes('ampm-showPicker'), 'and the AM/PM dropdown is asked to open where the platform supports it');
  assert(!events.includes('minute-refocus'), 'the minute input is NOT refocused (the old calendar-popping path)');
  assert(events.indexOf('ampm-focus') < events.indexOf('ampm-showPicker'),
    'focus lands before the open attempt, so a failed showPicker still leaves AM/PM focused');

  // A platform with no showPicker (older iPad WebView): the pick must not throw.
  delete ampmNode.showPicker;
  events.length = 0;
  let threw = false;
  try { optNode.handlers.click(); } catch (e) { threw = true; }
  assert(!threw && events.includes('ampm-focus'),
    'no showPicker on the platform -> the pick still succeeds and AM/PM is still focused');
}
