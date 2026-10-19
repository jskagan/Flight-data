// "I am having difficulty shrinking the screen zoom level when I am in the daily dress
// guide on my iPhone. When I pinch to shrink the screen stays the same size" (2026-10-19).
// iOS never pinch-zooms OUT below fit-to-width, so the guide got (1) an A− / A+ text-size
// control (CSS zoom on the paper, remembered per device) and (2) a phone layout.
// Synthetic fixtures only.
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
const constLine = name => { const m = html.match(new RegExp(`const ${name} = [^\\n]*`)); if (!m) throw new Error('missing const ' + name); return m[0]; };

const build = (store) => {
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  return new Function('localStorage', [
    constLine('TRIPSY_DG_SCALE_KEY'), constLine('TRIPSY_DG_SCALE_STEPS'),
    fnSource('tripsyDgScaleLoad'), fnSource('tripsyDgScaleSave'), fnSource('tripsyDgScaleStep'), fnSource('tripsyDgScaleApply'),
    'return { load: tripsyDgScaleLoad, save: tripsyDgScaleSave, step: tripsyDgScaleStep, apply: tripsyDgScaleApply, STEPS: TRIPSY_DG_SCALE_STEPS };'].join('\n'))(localStorage);
};
// ---- stepping and clamping ----
{
  const api = build({});
  assert(api.STEPS[0] === 0.7 && api.STEPS[api.STEPS.length - 1] === 1.2 && api.STEPS.includes(1), 'steps run 70%..120% with 100% as a step');
  assert(api.step(1, -1) === 0.9 && api.step(1, 1) === 1.1, 'A− / A+ move one step');
  assert(api.step(0.7, -1) === 0.7 && api.step(1.2, 1) === 1.2, 'the ends clamp');
  assert(api.step(0.85, -1) === 0.9 && api.step(0.85, 1) === 1.1, 'an unknown current value steps from 100%');
}
// ---- the per-device memory ----
{
  const store = {};
  const api = build(store);
  assert(api.load() === 1, 'nothing stored -> 100%');
  api.save(0.8);
  assert(store.flightlog_dg_scale === '0.8' && api.load() === 0.8, 'a chosen size is stored and read back exactly');
  api.save(1);
  assert(!('flightlog_dg_scale' in store) && api.load() === 1, '100% is stored as nothing at all');
  store.flightlog_dg_scale = '3';
  assert(api.load() === 1, 'a value that is not one of the steps reads as 100%');
  const throwing = new Function('localStorage', [constLine('TRIPSY_DG_SCALE_KEY'), constLine('TRIPSY_DG_SCALE_STEPS'), fnSource('tripsyDgScaleLoad'), fnSource('tripsyDgScaleSave'),
    'return { load: tripsyDgScaleLoad, save: tripsyDgScaleSave };'].join('\n'))({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
  assert(throwing.load() === 1 && (throwing.save(0.8), true), 'blocked storage fails soft');
}
// ---- applying: CSS zoom on the paper, label and end buttons repainted ----
{
  const api = build({});
  const nodes = {
    '#tripsy-attire-dressguide-content': { style: {} },
    '[data-tripsy-dg-scale-label]': { textContent: '' },
    '[data-tripsy-dg-scale-down]': { disabled: false },
    '[data-tripsy-dg-scale-up]': { disabled: false },
  };
  const overlay = { querySelector: sel => nodes[sel] || null };
  api.apply(overlay, 0.8);
  assert(nodes['#tripsy-attire-dressguide-content'].style.zoom === '0.8', 'THE ASK: the whole guide paper is scaled (CSS zoom, so inline px sizes shrink too)');
  assert(nodes['[data-tripsy-dg-scale-label]'].textContent === '80%', 'the control shows the size');
  assert(!nodes['[data-tripsy-dg-scale-down]'].disabled && !nodes['[data-tripsy-dg-scale-up]'].disabled, 'both directions open mid-range');
  api.apply(overlay, 0.7);
  assert(nodes['[data-tripsy-dg-scale-down]'].disabled && !nodes['[data-tripsy-dg-scale-up]'].disabled, 'A− disables at the smallest step');
  api.apply(overlay, 1.2);
  assert(!nodes['[data-tripsy-dg-scale-down]'].disabled && nodes['[data-tripsy-dg-scale-up]'].disabled, 'A+ disables at the largest step');
  api.apply(overlay, 1);
  assert(nodes['#tripsy-attire-dressguide-content'].style.zoom === '' && nodes['[data-tripsy-dg-scale-label]'].textContent === '100%', '100% clears the zoom entirely');
  api.apply(null, 1);
  assert(true, 'no overlay is a no-op');
}
// ---- wiring ----
{
  const create = fnSource('getOrCreateTripsyDressGuideOverlay');
  assert(/<span class="tripsy-dg-scale" title="Text size">[\s\S]*data-tripsy-dg-scale-down[\s\S]*data-tripsy-dg-scale-label[\s\S]*data-tripsy-dg-scale-up[\s\S]*<\/span>\n\s*<button class="tripsy-update-btn" id="tripsy-attire-dressguide-filter-btn">/.test(create),
    'THE ASK: the A− / % / A+ control sits in the guide toolbar, before Filter');
  assert(/const bumpScale = dir => \{\n\s*const v = tripsyDgScaleStep\(tripsyDgScaleLoad\(\), dir\);\n\s*tripsyDgScaleSave\(v\);\n\s*tripsyDgScaleApply\(overlay, v\);/.test(create)
    && /\[data-tripsy-dg-scale-down\]'\)\.addEventListener\('click', \(\) => bumpScale\(-1\)\)/.test(create) && /\[data-tripsy-dg-scale-up\]'\)\.addEventListener\('click', \(\) => bumpScale\(1\)\)/.test(create),
    'a tap steps, stores and applies');
  const show = fnSource('showTripsyDailyDressGuide');
  assert(/overlay\.style\.display = 'flex';\n\s*tripsyDgScaleApply\(overlay, tripsyDgScaleLoad\(\)\);/.test(show), 'every open applies the remembered size');
}
// ---- the phone layout ----
{
  const i = html.indexOf('#tripsy-attire-dressguide-overlay { padding: 8px 6px; }');
  assert(i > 0, 'THE ASK (2): a phone layout drops the guide\'s 32px overlay padding');
  const block = html.slice(html.lastIndexOf('@media (max-width: 600px)', i), html.indexOf('}\n  }', i) + 5);
  assert(/#tripsy-attire-dressguide-overlay \.tripsy-attire-paper \{ padding: 12px 12px;/.test(block), 'and the paper\'s 28px padding');
  assert(/#tripsy-attire-dressguide-overlay \.tripsy-attire-daybar \{ font-size: 12\.5px !important; padding: 5px 8px !important;/.test(block), 'the day bar tightens (its sizes are inline styles, hence !important)');
  assert(/#tripsy-attire-dressguide-overlay \.tripsy-attire-dressguide-event \{ gap: 8px;/.test(block) && /#tripsy-attire-dressguide-overlay \.tripsy-attire-dressguide-instruction \{ margin: 10px 0 4px;/.test(block), 'event rows and instruction bars tighten');
  assert(/#tripsy-attire-dressguide-overlay \.tripsy-attire-toolbar \{ flex-wrap: wrap;/.test(block), 'the toolbar may wrap on a phone, so the extra control never pushes the ✕ off-screen');
  assert(/<div class="tripsy-attire-daybar" style="position:relative; z-index:2;/.test(fnSource('tripsyAttireDayBarHtml')), 'the day bar carries the class the phone rule targets');
  assert(/<meta name="viewport" content="width=device-width, initial-scale=1\.0">/.test(html) && !/user-scalable=no|maximum-scale/.test(html), 'pinch-zoom is still allowed by the page (the limit is the system\'s)');
}
