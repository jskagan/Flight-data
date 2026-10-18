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
// The device's SCREEN decides ("The app defaulted to travel view on my iPad," 2026-10-18 --
// an iPad in Split View has a phone-width WINDOW but is no phone).
const dev = ({ screenW, screenH, ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit Safari', innerWidth = 9999, mmMatches = false }) => ({
  screen: screenW ? { width: screenW, height: screenH } : undefined,
  navigator: { userAgent: ua },
  matchMedia: q => ({ matches: mmMatches && /max-width: 600px/.test(q) }),
  innerWidth,
});
{
  const api = build(dev({ screenW: 390, screenH: 844, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }), '0');
  assert(api.phone() === true, 'an iPhone is a phone');
  assert(api.pref() === true, 'THE ASK: on a phone the Travel View landing is on, whatever was stored');
  assert(build(dev({ screenW: 412, screenH: 915, ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari' }), '0').phone() === true, 'an Android phone is a phone');
}
{
  // iPad in Split View / Slide Over: narrow WINDOW, full-size SCREEN -- the reported case.
  const api = build(dev({ screenW: 1024, screenH: 1366, innerWidth: 375, mmMatches: true }), '0');
  assert(api.phone() === false, 'THE FIX: an iPad with the app in a narrow pane is NOT a phone');
  assert(api.pref() === false, 'so its landing follows the stored choice (off here)');
  assert(build(dev({ screenW: 744, screenH: 1133 }), '0').phone() === false, 'the smallest iPad (mini, 744px short side) is not a phone');
  assert(build(dev({ screenW: 1024, screenH: 1366 }), '1').pref() === true, 'an iPad with the stored "on" still lands on Travel View');
  assert(build(dev({ screenW: 1920, screenH: 1080 }), '0').phone() === false, 'a desktop is not a phone');
}
{
  // No screen size at all (some WebViews): the viewport is the fallback.
  assert(build(dev({ innerWidth: 390, mmMatches: true }), '0').phone() === true, 'no screen info: a phone-width viewport counts');
  assert(build(dev({ innerWidth: 1024 }), '0').phone() === false, 'no screen info: a wide viewport does not');
  assert(build({ innerWidth: 390 }, '0').phone() === true, 'no screen, no matchMedia: innerWidth decides');
  assert(build({ innerWidth: 0 }, '0').phone() === false, 'an unmeasurable window is not called a phone');
  assert(build({ matchMedia: () => { throw new Error('nope'); }, innerWidth: 390 }, '0').phone() === true, 'a throwing matchMedia falls back to the width');
}
assert(/const TRIPSY_PHONE_MAX_WIDTH = 600;/.test(html) && /@media \(max-width: 600px\)/.test(html), 'the phone width is the phone-only layout breakpoint');
// ---- every landing path reads the one preference, so a phone lands on Travel View everywhere ----
const csi = fnSource('completeSignIn');
assert(/if \(loadTravelViewPref\(\)\) \{\n\s*try \{ await navigate\('travelview'\); \}/.test(csi), 'sign-in lands on Travel View through the preference');
assert(/else if \(wasSplashPreview\) \{ if \(!loadTravelViewPref\(\)\) await navigate\('home'\); \}/.test(csi), 'the splash-preview landing reads the same preference');
assert(/if \(force && loadTravelViewPref\(\) && tripsCache\)/.test(html), 'the offline auto-open reads the same preference');
const gate = fnSource('applyTripsOnlySignInGate');
assert(/\(tripsOnly \|\| tripsyIsPhoneDevice\(\)\) \? 'btn primary' : 'btn'/.test(gate) && /fullBtn\.style\.display = tripsOnly \? 'none' : ''/.test(gate),
  'on a phone the gate highlights Travel View but keeps the full-app button');
