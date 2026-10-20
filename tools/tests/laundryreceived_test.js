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

// ---- the record actually changes (the real Store methods against a fake driveData) ----
// Found live ("I just marked that I had 7 sets of socks returned, but this is what the screen
// shows," 2026-10-20): markTripsyLaundryReturned looked the wash up through
// getTripsyLaundryBag, which by design returns only an UNWASHED bag, so it found nothing and
// returned false on every press. The earlier suite drove the credit maths on records directly
// and never ran this lookup.
const methodSource = name => {
  const i = html.indexOf('  ' + name + '(');
  const j = html.indexOf('  async ' + name + '(');
  let start = j >= 0 && (i < 0 || j < i) ? j : i;
  if (start < 0) throw new Error('missing method ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', start) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(start, k + 1).trim(); }
  }
  throw new Error('unterminated ' + name);
};
(async () => {
  const driveData = { tripsyLaundry: [
    { tripKey: 'T', person: 'him', dayKey: '2026-10-18', bag: { 'g:socks': 7, 'g:tee': 1 }, washedAt: '2026-10-18T10:00:00Z', awaitingReturn: true, returned: {} },
    { tripKey: 'T', person: 'him', dayKey: '2026-10-20', bag: { 'g:polo': 1 } }, // today's UNWASHED bag
  ] };
  let persisted = 0;
  const Store = new Function('driveData', 'persistDriveData', 'tripsyLaundryBagBaseCounts', [
    'const Store = {', methodSource('getTripsyLaundryBag') + ',', methodSource('getTripsyWashedRecord') + ',', methodSource('markTripsyLaundryReturned'), '};',
    'return Store;'].join('\n'))(driveData, async () => { persisted++; }, new Function(fnSource('tripsyLaundryBagBaseCounts') + '; return tripsyLaundryBagBaseCounts;')());
  assert(Store.getTripsyLaundryBag('T', 'him', '2026-10-18') === null && Store.getTripsyWashedRecord('T', 'him', '2026-10-18') === driveData.tripsyLaundry[0],
    'the washed record is reached through its own getter; the bag getter (unwashed only) does not see it');
  const ok = await Store.markTripsyLaundryReturned('T', 'him', '2026-10-18', 'g:socks', 7, '2026-10-20');
  const rec = driveData.tripsyLaundry[0];
  assert(ok === true && persisted === 1, 'THE BUG: a Received press on a washed record succeeds and persists');
  assert(rec.returned['g:socks'] && rec.returned['g:socks'].qty === 7 && rec.returned['g:socks'].dayKey === '2026-10-20', 'the 7 socks are recorded as back on the collect day');
  await Store.markTripsyLaundryReturned('T', 'him', '2026-10-18', 'g:socks::nn', 3, '2026-10-21');
  assert(rec.returned['g:socks'].qty === 7, 'capped at what went in; the ::nn half merges into its base key');
  assert(await Store.markTripsyLaundryReturned('T', 'him', '2026-10-20', 'g:polo', 1, '2026-10-20') === false, 'an unwashed bag has nothing to receive back');
  assert(/Store\.getTripsyWashedRecord\(tripKey, person, dayKey\)/.test(fnSource('showTripsyWashedDay')), 'the screen reads the record through the same getter Received writes to');
})();
