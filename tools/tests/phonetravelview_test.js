// "Anytime the app is opened on a phone, default to the travel view" (2026-10-18).
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

// ---- the detector, driven by a fake window ----
const build = (win, stored) => {
  const localStorage = { getItem: () => stored };
  return new Function('window', 'localStorage', [
    constLine('TRIPSY_PHONE_MAX_WIDTH'), constLine('TRAVEL_VIEW_KEY'),
    fnSource('tripsyIsPhoneDevice'), fnSource('loadTravelViewPref'),
    'return { phone: tripsyIsPhoneDevice, pref: loadTravelViewPref };'].join('\n'))(win, localStorage);
};
const mm = matches => ({ matchMedia: q => ({ matches: matches && /max-width: 600px/.test(q) }), innerWidth: 9999 });
{
  const api = build(mm(true), '0');
  assert(api.phone() === true, 'a viewport at or under the phone breakpoint is a phone');
  assert(api.pref() === true, 'THE ASK: on a phone the Travel View landing is on, whatever was stored');
}
{
  const api = build(mm(false), '0');
  assert(api.phone() === false && api.pref() === false, 'a wider viewport is not a phone, and the stored "off" stands');
  assert(build(mm(false), '1').pref() === true, 'a wider viewport with the stored "on" still lands on Travel View');
}
{
  assert(build({ innerWidth: 390 }, '0').phone() === true, 'no matchMedia (an old WebView): a 390px window is a phone');
  assert(build({ innerWidth: 1024 }, '0').phone() === false, 'no matchMedia: a 12.9" iPad in portrait (1024px) is NOT a phone');
  assert(build({ innerWidth: 0 }, '0').phone() === false, 'an unmeasurable window is not called a phone');
  assert(build({ matchMedia: () => { throw new Error('nope'); }, innerWidth: 390 }, '0').phone() === true, 'a throwing matchMedia falls back to the width');
}
assert(/const TRIPSY_PHONE_MAX_WIDTH = 600;/.test(html) && /@media \(max-width: 600px\)/.test(html), 'the phone width is the phone-only layout breakpoint');
// ---- every landing path reads the one preference, so a phone lands on Travel View everywhere ----
const csi = fnSource('completeSignIn');
assert(/if \(loadTravelViewPref\(\)\) \{\n\s*try \{ await navigate\('travelview'\); \}/.test(csi), 'sign-in lands on Travel View through the preference');
assert(/wasSplashPreview && loadTravelViewPref\(\)/.test(csi), 'the splash-preview landing reads the same preference');
assert(/if \(force && loadTravelViewPref\(\) && tripsCache\)/.test(html), 'the offline auto-open reads the same preference');
const gate = fnSource('applyTripsOnlySignInGate');
assert(/\(tripsOnly \|\| tripsyIsPhoneDevice\(\)\) \? 'btn primary' : 'btn'/.test(gate) && /fullBtn\.style\.display = tripsOnly \? 'none' : ''/.test(gate),
  'on a phone the gate highlights Travel View but keeps the full-app button');
