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

// tripsyRemoveTravelViewLayer against a fake #main
{
  const removed = [];
  const mk = () => { const r = { style: {}, remove() { removed.push(this); } }; return r; };
  const roots = [mk()];
  const document = { getElementById: id => id === 'main' ? { querySelectorAll: sel => sel === '.tv-root' ? roots : [] } : null };
  const f = new Function('document', fnSource('tripsyRemoveTravelViewLayer') + '; return tripsyRemoveTravelViewLayer;')(document);
  assert(f() === true && removed.length === 1 && roots[0].style.display === 'none', 'the Travel View layer is hidden and removed, and reported');
  const empty = new Function('document', fnSource('tripsyRemoveTravelViewLayer') + '; return tripsyRemoveTravelViewLayer;')({ getElementById: () => ({ querySelectorAll: () => [] }) });
  assert(empty() === false, 'no Travel View layer: nothing to do');
}
// tripsyForceMainRepaint bumps #main onto its own layer and back, twice
{
  const m = { style: { transform: '' }, get offsetHeight() { return 1; } };
  const sets = [];
  const style = new Proxy(m.style, { set(o, k, v) { if (k === 'transform') sets.push(v); o[k] = v; return true; } });
  m.style = style;
  const timers = [];
  const f = new Function('document', 'requestAnimationFrame', 'setTimeout', fnSource('tripsyForceMainRepaint') + '; return tripsyForceMainRepaint;')(
    { getElementById: () => m }, cb => cb(), (cb, ms) => timers.push([cb, ms]));
  f();
  assert(sets.join('|') === 'translateZ(0)|' && timers.length === 1 && timers[0][1] === 400, 'the main area is put on its own layer for two frames, then back');
  timers[0][0]();
  assert(sets.join('|') === 'translateZ(0)||translateZ(0)|' && m.style.transform === '', 'and once more a moment later, ending with no transform');
}
// wired into navigate
{
  const nav = fnSource('navigate');
  assert(/const leavingTravelView = view !== 'travelview' && tripsyRemoveTravelViewLayer\(\);/.test(nav), 'navigating away from Travel View removes its layer before the next page draws');
  assert(/if \(leavingTravelView\) tripsyForceMainRepaint\(\);/.test(nav)
    && nav.indexOf('tripsyForceMainRepaint()') > nav.indexOf('await renderHome()'), 'and repaints the main area after it has drawn');
}
