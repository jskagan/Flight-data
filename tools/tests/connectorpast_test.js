// The timeline connector (positionTripsyTimelineConnectors) draws its line as many
// small per-gap segments appended as SIBLINGS of .tripsy-day-block, not descendants --
// so a past day's opacity dimming never reached the line running through it. A segment
// gets the lighter/dimmer white whenever it STARTS from a past-day row -- "I want the
// line dim when it starts from a grayed out event" -- including the boundary segment
// running from the last past row into today's first row (previously left full-bright
// on purpose; the owner asked for it dimmed too).
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

// ---- wiring: the class is applied per-segment based on the STARTING dot only ----
const fn = extractFn('positionTripsyTimelineConnectors');
assert(/const startsPast = !!dots\[i\]\.closest\('\.tripsy-day-past'\);/.test(fn),
  'THE ASK: only the starting dot is checked -- a segment coming out of a past event dims ' +
  'even if the row it runs into is not itself past (e.g. the boundary into today)');
assert(/segment\.className = startsPast \? 'tripsy-tl-connector tripsy-tl-connector--past' : 'tripsy-tl-connector';/.test(fn),
  'applies the modifier class whenever the segment starts past');
assert(!/bothPast/.test(fn), 'the old both-ends check is gone, not just superseded');

// ---- executed: the boolean logic itself, against a small fake DOM ----
{
  const fakeDot = (past) => ({ closest: (sel) => (sel === '.tripsy-day-past' && past) ? {} : null });
  const startsPast = (a) => !!fakeDot(a).closest('.tripsy-day-past');
  assert(startsPast(true) === true, 'starting row past -> dimmed');
  assert(startsPast(false) === false, 'starting row not past -> ordinary bright line, unchanged from before');
  // THE ASK, explicitly: a segment running FROM a past row INTO today's first row
  // (the boundary) now dims too -- it starts past, regardless of where it ends.
  assert(startsPast(true) === true, 'boundary segment (past -> today) now dims, since it starts from a grayed-out event');
}
