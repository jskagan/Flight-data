// "Change the message to say that an item on the wear schedule is not available because it
// is dirty. Also show the last day I wore the item" (2026-10-18). Synthetic fixtures only.
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
const text = new Function('tripsyDayHeaderLabel', fnSource('tripsyRunOutNoteText') + '\nreturn tripsyRunOutNoteText;')(k => 'Sat, Oct 17');
{
  const t = text('Charcoal Vuori Polo Shirt', '2026-10-17');
  assert(t === "Charcoal Vuori Polo Shirt is on today's wear schedule but isn't available — it's dirty. Last worn Sat, Oct 17.",
    'THE ASK: the bar says the garment is on the wear schedule, unavailable because dirty, and when it was last worn -> ' + t);
  assert(!/run out of/.test(t), 'the old "you run out of" wording is gone');
  const t2 = text('Loafers', null);
  assert(/isn't available — it's dirty\. No clean copy is with you today\.$/.test(t2), 'never worn before the short day (e.g. shipped home): says no clean copy is with you instead of inventing a date');
}
// ---- the walk records the last-worn day, and the guide renders it ----
const walk = fnSource('tripsyLaundryRunOutByDay');
assert(/const lastWornBefore = dayKey => wornDays\.filter\(d => d && d < dayKey\)\.sort\(\)\.pop\(\) \|\| null;/.test(walk), 'last worn = the latest wear day strictly BEFORE the short day');
assert(/note\(dayKey, name, lastWornBefore\(dayKey\)\)/.test(walk) && /return \{ runOut, lastWorn, hasWash: true \};/.test(walk) && /return \{ runOut, lastWorn: new Map\(\), hasWash: false \};/.test(walk),
  'both flagging sites record it and both returns carry a lastWorn map (runOut stays a plain list of names)');
const dg = fnSource('renderTripsyDressGuideInto');
assert(/const runOutLastWorn = \(laundryInfo\.lastWorn && laundryInfo\.lastWorn\.get\(day\.dayKey\)\) \|\| new Map\(\);/.test(dg)
  && /tripsyRunOutNoteText\(n, runOutLastWorn\.get\(n\)\)/.test(dg), 'the Daily Dress Guide bar is built from the sentence builder with that day\'s last-worn map');
