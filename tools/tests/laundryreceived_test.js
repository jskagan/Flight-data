// "When I mark an item received back from laundry, that item should be immediately removed
// from the list of items that are out for laundry" (2026-10-20). Synthetic only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
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
const split = new Function(fnSource('tripsyWashedDayListSplit') + '; return tripsyWashedDayListSplit;')();
const items = [
  { key: 'g:a', name: 'Polo', count: 1, back: 1, left: 0 },      // confirmed back
  { key: 'g:b', name: 'Tee', count: 3, back: 1, left: 2 },       // partly back
  { key: 'g:c', name: 'Socks', count: 2, back: 0, left: 2 },     // still out
];
{
  const r = split(items, true, 4);
  assert(r.shown.map(i => i.key).join() === 'g:b,g:c', 'THE ASK: a garment confirmed fully back leaves the list of what is out at once');
  assert(r.backLine.map(i => i.key).join() === 'g:a', 'and is named in the compact Back line instead');
}
{
  const all = items.map(i => ({ ...i, back: i.count, left: 0 }));
  const r = split(all, true, 0);
  assert(r.shown.length === 3 && r.backLine.length === 0, 'once everything is back the full list is the record of the wash');
}
{
  const r = split(items, false, 0);
  assert(r.shown.length === 3 && r.backLine.length === 0, 'a wash from before returns existed lists everything, no Back line');
}
// ---- wiring ----
const screen = fnSource('showTripsyWashedDay');
assert(/const \{ shown, backLine \} = tripsyWashedDayListSplit\(items, awaiting, outstanding\);/.test(screen) && /shown\.map\(cardHtml\)/.test(screen),
  'the screen renders the split, not the raw item list');
assert(/✓ Back: \$\{backLine\.map/.test(screen), 'the Back line names the returned garments');
assert(/const p = Store\.markTripsyLaundryReturned\([\s\S]*?showTripsyWashedDay\(tripKey, dayKey, person, opts\);/.test(screen),
  'a Received press rebuilds the screen from the (optimistically mutated) record immediately, not after the write');
