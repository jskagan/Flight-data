// "In the attire menu, add a menu item called 'Laundry'. Have this bring up the same page as
// the laundry button from the daily dress guide. When laundry is out, also show the laundry
// back option from this menu." (2026-10-19). Synthetic fixtures only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
// ---- the pure menu judgement ----
const api = new Function('tripsyTravelViewTodayKey', 'tripsyTodayDayKey', [
  extractFn('tripsyLaundryBagBaseCounts'), extractFn('tripsyLaundryOutstandingByWash'),
  extractFn('tripsyGarmentLocationLaundryDay'), extractFn('tripsyAttireMenuLaundry'),
  'return tripsyAttireMenuLaundry;'].join('\n'));
const guide = { days: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map(dayKey => ({ dayKey })) };
const trip = { key: 'T' };
const records = [
  { tripKey: 'T', person: 'him', dayKey: '2026-11-03', washedAt: 'x', awaitingReturn: true, bag: { 'g:a': 2, 'g:b': 1 }, returned: { 'g:a': { qty: 1, dayKey: '2026-11-03' } } },
  { tripKey: 'T', person: 'him', dayKey: '2026-11-02', washedAt: 'x', awaitingReturn: true, bag: { 'g:c': 3 }, returned: {} },
  { tripKey: 'T', person: 'him', dayKey: '2026-11-01', washedAt: 'x', awaitingReturn: true, bag: { 'g:d': 1 }, returned: { 'g:d': { qty: 1, dayKey: '2026-11-02' } } }, // all back
  { tripKey: 'T', person: 'her', dayKey: '2026-11-02', washedAt: 'x', awaitingReturn: true, bag: { 'g:e': 4 }, returned: {} }, // hers
  { tripKey: 'T', person: 'him', dayKey: '2026-11-03', bag: { 'g:f': 1 } }, // gathered, unwashed
];
{
  const r = api(() => '2026-11-03', () => '2026-11-03')(guide, trip, records, 'him');
  assert(r.dayKey === '2026-11-03', 'THE ASK: Laundry opens on the trip\'s today, as the guide\'s own button does');
  assert(r.outstanding.map(o => `${o.washDayKey}:${o.total}`).join(',') === '2026-11-02:3,2026-11-03:2', 'THE ASK: one Laundry back row per wash with copies still out (oldest first), hers and fully-returned washes excluded');
  const over = api(() => '2026-11-09', () => '2026-11-09')(guide, trip, records, 'him');
  assert(over.dayKey === '2026-11-04', 'after the trip the laundry day is its last day (Garment Location\'s rule)');
  const before = api(() => '2026-10-20', () => '2026-10-20')(guide, trip, records, 'him');
  assert(before.dayKey === null && before.outstanding.length === 2, 'before the trip there is no laundry day (nothing worn), the outstanding washes still list');
  assert(api(() => '2026-11-03', () => '2026-11-03')(guide, trip, [], 'him').outstanding.length === 0, 'nothing out -> no Laundry back rows');
}
// ---- the menu and its handler ----
{
  const i = html.indexOf('const attireMenuItems = attireDressOnly');
  const menu = html.slice(i, html.indexOf('].join(\'\');', i));
  assert(/tripsyAttireMenuLaundry\(attireGuideObj, trip, Store\.listTripsyLaundry\(trip\.key\), lp\)/.test(menu), 'the 👔 menu judges Laundry from the guide, the trip and the live laundry records');
  assert(/data-tripsy-attire-nav="laundry" data-key="\$\{esc\(trip\.key\)\}" data-day="\$\{esc\(laundryDay \|\| ''\)\}"`, '🧺', 'Laundry'\)/.test(menu), 'THE ASK: a Laundry item');
  assert(/outstanding\.map\(o => menuListButtonHtml\(`data-tripsy-attire-nav="laundryback"[^`]*data-wash="\$\{esc\(o\.washDayKey\)\}"`, '🧺', `Laundry back · \$\{o\.total\} out`\)\)/.test(menu), 'THE ASK: a "Laundry back · N out" row per outstanding wash');
  assert(menu.indexOf('Garment Location') < menu.indexOf("'Laundry'") && menu.indexOf("'Laundry'") < menu.indexOf('data-tripsy-attire-nav="refresh"'), 'both sit after Garment Location, before Refresh');
  assert(/\.\.\.\(isOwner && attireHasGuide \? \(\(\) => \{\n\s*const lp = tripsyDressGuidePerson;/.test(menu), 'owner-only, with a guide, for the person the Daily Dress Guide shows');
  const handler = html.slice(html.indexOf('container.querySelectorAll("[data-tripsy-attire-nav]")'), html.indexOf("case 'outfits': {"));
  assert(/case 'laundry': \{[\s\S]*?showTripsyLaundryDay\(key, btn\.dataset\.day, tripsyDressGuidePerson, \{ onChanged: \(\) => renderTripsyEventsList\(\) \}\);/.test(handler), 'THE ASK: Laundry opens the SAME screen the guide\'s button opens (showTripsyLaundryDay)');
  assert(/if \(!btn\.dataset\.day\) \{ toast\('The trip has not started yet — nothing has been worn\.'\); break; \}/.test(handler), 'before the trip it explains instead of opening an empty screen');
  assert(/case 'laundryback': \{[\s\S]*?showTripsyWashedDay\(key, btn\.dataset\.wash, tripsyDressGuidePerson, \{ collectDayKey: btn\.dataset\.day \|\| btn\.dataset\.wash, onChanged: \(\) => renderTripsyEventsList\(\) \}\);/.test(handler), 'THE ASK: Laundry back opens that wash\'s list with Received buttons, recording returns as of today');
}
