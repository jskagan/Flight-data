// "The screen is not rendering correctly" (2026-10-21): after the splash's stand-in Travel View
// gave way to Home on opening the app, iPad WebKit left stale patches of the removed
// self-scrolling .tv-root layer over Home. Leaving Travel View now removes that layer first
// and forces a repaint of #main. Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};

// tripsyRemoveTravelViewLayer: stop scrolling, wait two frames, THEN remove
(async () => {
  const log = [];
  const mk = () => ({ scrollTop: 300, style: {}, remove() { log.push('remove:' + this.style.overflow); } });
  const roots = [mk()];
  const document = { getElementById: id => id === 'main' ? { querySelectorAll: sel => sel === '.tv-root' ? roots : [] } : null };
  const raf = cb => { log.push('frame'); setImmediate(cb); };
  const mkFn = doc => new Function('document', 'requestAnimationFrame', 'setTimeout',
    fnSource('tripsyNextFrames') + '\n' + fnSource('tripsyRemoveTravelViewLayer') + '; return tripsyRemoveTravelViewLayer;')(doc, raf, setTimeout);
  const res = await mkFn(document)();
  const r = roots[0];
  assert(res === true && r.scrollTop === 0 && r.style.overflow === 'hidden' && r.style.webkitOverflowScrolling === 'auto' && r.style.overscrollBehavior === 'auto',
    'the Travel View layer stops being a scroller first (top, overflow hidden, no touch scrolling)');
  assert(log.join(',') === 'frame,frame,remove:hidden', 'and is removed only after two frames have passed');
  assert(await mkFn({ getElementById: () => ({ querySelectorAll: () => [] }) })() === false, 'no Travel View layer: nothing to do');
  // a page firing no frames still finishes
  const stuck = new Function('requestAnimationFrame', 'setTimeout', fnSource('tripsyNextFrames') + '; return tripsyNextFrames;')(() => {}, setTimeout);
  const t0 = Date.now(); await stuck(2);
  assert(Date.now() - t0 < 1000, 'waiting for frames gives up after a moment when none fire');
  // wired into navigate, before any view renders; the old repaint nudge is gone
  const nav = fnSource('navigate');
  assert(/if \(view !== 'travelview'\) await tripsyRemoveTravelViewLayer\(\);/.test(nav)
    && nav.indexOf('tripsyRemoveTravelViewLayer') < nav.indexOf('await renderHome()'), 'navigating away from Travel View removes its layer before the next page draws');
  assert(!/tripsyForceMainRepaint|translateZ\(0\)/.test(nav) && !/function tripsyForceMainRepaint/.test(html), 'the #main repaint nudge is removed');
})();
