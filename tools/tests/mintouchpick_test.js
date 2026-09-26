// "When I am adding a new event on the add event page from my trips, after I
// select a date and then the hours and minutes the app goes back to the date
// selection instead of going to the AM/PM indicator" (2026-09-26, iPad Claude
// app). The minute-combo pick used to be wired to 'click' only: on the iPad
// WebView that is a SYNTHESIZED event, and after the handler closed the menu
// the WebView still applied its native tap default at the same screen point --
// now a DATE input in the Add panel's wider one-line layout -- popping the
// calendar by itself even though the minute was set fine. The pick now also
// fires at TOUCHEND with preventDefault() (suppressing the synthesized mouse
// events AND that native default), guarded so a scroll that merely started on
// an option never counts as a pick; mouse/desktop keeps the 'click' path.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- isolate the minute-combo wiring block ----
const blkStart = html.indexOf("panel.querySelectorAll('.tp-min-combo').forEach(combo => {");
assert(blkStart > -1, 'sanity: found the minute-combo wiring');
const blkEnd = html.indexOf('\n  });\n', html.indexOf("addEventListener('click', pick)", blkStart)) + 6;
const blk = html.slice(blkStart, blkEnd);

// ---- source patterns ----
assert(/const pick = \(\) => \{/.test(blk) && /o\.addEventListener\('click', pick\);/.test(blk),
  'one pick function shared by both entry points -- touch and mouse can never drift on what a pick does');
assert(/o\.addEventListener\('touchend', e => \{\s*\n\s*if \(touchMoved\) return;\s*\n\s*e\.preventDefault\(\);\s*\n\s*pick\(\);/.test(blk),
  'THE FIX: the pick happens at touchend with preventDefault, so the WebView has no synthesized click or native tap default left to land on the date input beneath');
assert(/o\.addEventListener\('touchstart', \(\) => \{ touchMoved = false; \}, \{ passive: true \}\);/.test(blk)
  && /o\.addEventListener\('touchmove', \(\) => \{ touchMoved = true; \}, \{ passive: true \}\);/.test(blk),
  'a touch that moved is a scroll, not a pick -- and the tracking listeners are passive so scrolling stays smooth');

// ---- executed: the touch path against a stub DOM ----
{
  const events = [];
  const ampmNode = {
    focus: () => events.push('ampm-focus'),
    showPicker: () => events.push('ampm-showPicker'),
  };
  const rowNode = { querySelector: sel => (sel === '[data-tripsy-edit-time-ampm]' ? ampmNode : null) };
  const optNode = { dataset: { min: '45' }, handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
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
  };
  const combo = {
    closest: sel => (sel === '.tp-time-row' ? rowNode : null),
    querySelector: sel => (sel.includes('edit-time-min') ? inputNode : menuNode),
  };
  const panel = { querySelectorAll: sel => (sel === '.tp-min-combo' ? [combo] : []) };
  global.Event = class { constructor(type) { this.type = type; } };
  eval(blk);

  // A clean tap: touchstart -> touchend. The default must be suppressed and
  // the pick must run in full (value, menu close, AM/PM advance).
  let prevented = 0;
  optNode.handlers.touchstart();
  optNode.handlers.touchend({ preventDefault: () => { prevented++; } });
  assert(prevented === 1,
    'THE FIX: touchend calls preventDefault -- nothing synthesized is left to hit the date input once the menu closes');
  assert(inputNode.value === '45', 'the tapped quarter-hour lands in the minute box');
  assert(menuNode.style.display === 'none', 'the minute menu closes');
  assert(events.includes('ampm-focus') && events.includes('ampm-showPicker'),
    'THE ASK: the tap advances to the AM/PM indicator, not back to the date');

  // A scroll that starts on an option: touchstart -> touchmove -> touchend.
  // No pick, no preventDefault -- the scroll proceeds natively.
  inputNode.value = '';
  menuNode.style.display = 'block';
  events.length = 0;
  prevented = 0;
  optNode.handlers.touchstart();
  optNode.handlers.touchmove();
  optNode.handlers.touchend({ preventDefault: () => { prevented++; } });
  assert(prevented === 0 && inputNode.value === '' && menuNode.style.display === 'block' && events.length === 0,
    'a moved touch is a scroll: no pick, no preventDefault, menu stays for the real pick');

  // The NEXT clean tap after a scroll works again (the moved flag resets).
  optNode.handlers.touchstart();
  optNode.handlers.touchend({ preventDefault: () => { prevented++; } });
  assert(prevented === 1 && inputNode.value === '45',
    'the moved flag resets per touch -- a scroll never wedges the option');

  // Desktop mouse still picks via click, exactly as before.
  inputNode.value = '';
  menuNode.style.display = 'block';
  optNode.handlers.click();
  assert(inputNode.value === '45' && menuNode.style.display === 'none',
    'mouse/desktop input still picks through the unchanged click path');
}
