// The timeline connector (positionTripsyTimelineConnectors) draws its line as many
// small per-gap segments appended as SIBLINGS of .tripsy-day-block, not descendants --
// so a past day's opacity dimming never reached the line running through it. A segment
// spanning two past-day rows now gets a lighter/dimmer white instead.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  const start = m.index;
  let i = html.indexOf('(', start), paren = 0;
  for (; i < html.length; i++) {
    if (html[i] === '(') paren++;
    else if (html[i] === ')') { paren--; if (!paren) { i++; break; } }
  }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- CSS: a distinct, lighter modifier class exists ----
assert(/\.tripsy-tl-connector--past \{ background:rgba\(255,255,255,0\.32\); \}/.test(html),
  'a lighter background is defined for the --past modifier');
const baseBg = (html.match(/\.tripsy-tl-connector \{[^}]*background:rgba\(([\d.,\s]+)\)/) || [])[1];
const pastBg = (html.match(/\.tripsy-tl-connector--past \{ background:rgba\(([\d.,\s]+)\)/) || [])[1];
const baseAlpha = parseFloat(baseBg.split(',')[3]);
const pastAlpha = parseFloat(pastBg.split(',')[3]);
assert(pastAlpha < baseAlpha, `the past variant is genuinely lighter -> base alpha ${baseAlpha}, past alpha ${pastAlpha}`);

// ---- wiring: the class is applied per-segment based on BOTH endpoint dots ----
const fn = extractFn('positionTripsyTimelineConnectors');
assert(/const bothPast = dots\[i\]\.closest\('\.tripsy-day-past'\) && dots\[i \+ 1\]\.closest\('\.tripsy-day-past'\);/.test(fn),
  'checks both endpoints, not just one -- a boundary segment (past -> today) must stay bright');
assert(/segment\.className = bothPast \? 'tripsy-tl-connector tripsy-tl-connector--past' : 'tripsy-tl-connector';/.test(fn),
  'applies the modifier class only when both ends are past');

// ---- executed: the boolean logic itself, against a small fake DOM ----
{
  const fakeDot = (past) => ({ closest: (sel) => (sel === '.tripsy-day-past' && past) ? {} : null });
  const bothPast = (a, b) => !!(fakeDot(a).closest('.tripsy-day-past') && fakeDot(b).closest('.tripsy-day-past'));
  assert(bothPast(true, true) === true, 'both rows past -> dimmed');
  assert(bothPast(true, false) === false, 'past row connecting into today -> stays bright, marks the boundary');
  assert(bothPast(false, true) === false, 'and the reverse order too');
  assert(bothPast(false, false) === false, 'neither past -> ordinary bright line, unchanged from before');
}
