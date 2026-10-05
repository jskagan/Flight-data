// "When there is a flashing triangle by any menu item in the attire guide and the user selects
// that menu item, explain the precise changes that caused the triangle to appear and ask if
// the user wants to update the item. Always do the minimum amount of work required to address
// the issue that triggered the triangle." (2026-10-05). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  const m = html.match(new RegExp(`\\n(async function ${name}\\(|function ${name}\\()`));
  const start = m.index + 1;
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const tripsyDayHeaderLabel = k => `D(${k})`;
eval(extractFn('tripsyAttireGuideChanges'));
eval(extractFn('tripsyAttireChangeSummaryText'));

// ---- the diff names exactly the four kinds of change the fingerprint can see ----
const E = (id, name, date, startTime) => ({ id, name, date, startTime });
const guide = { days: [
  { dayKey: '2030-05-01', events: [E('a', 'Breakfast', '2030-05-01', '8:00 AM'), E('b', 'Museum', '2030-05-01', '10:00 AM')] },
  { dayKey: '2030-05-02', events: [{ id: 'freeday-2030-05-02', name: 'No events planned', freeDay: true, date: '2030-05-02' }] },
  { dayKey: '2030-05-03', events: [E('c', 'Dinner', '2030-05-03', '7:00 PM'), E('d', 'Show', '2030-05-03', '9:00 PM')] },
] };
const current = [
  { dayKey: '2030-05-01', events: [E('a', 'Breakfast', '2030-05-01', '8:00 AM'), E('b', 'Museum', '2030-05-01', '11:30 AM')] },
  { dayKey: '2030-05-02', events: [E('c', 'Dinner', '2030-05-02', '7:00 PM'), E('n', 'Concert', '2030-05-02', '8:00 PM')] },
  { dayKey: '2030-05-03', events: [{ id: 'freeday-2030-05-03', name: 'No events planned', freeDay: true, date: '2030-05-03' }] },
];
const ch = tripsyAttireGuideChanges(guide, current);
assert(ch.added.length === 1 && ch.added[0].name === 'Concert', 'an added event is listed');
assert(ch.removed.length === 1 && ch.removed[0].name === 'Show', 'a removed event is listed');
assert(ch.moved.length === 1 && ch.moved[0].ev.name === 'Dinner' && ch.moved[0].from === '2030-05-03', 'an event moved to another day is listed with where it came from');
assert(ch.retimed.length === 1 && ch.retimed[0].ev.name === 'Museum' && ch.retimed[0].from === '10:00 AM', 'a time change is listed with the old time');
assert(ch.total === 4, 'free-day placeholders are never counted as changes');
const text = tripsyAttireChangeSummaryText(ch);
assert(/• Added: Concert — D\(2030-05-02\) at 8:00 PM/.test(text), 'THE ASK: the dialog names the precise change -> ' + text.split('\n')[0]);
assert(/• Removed: Show/.test(text) && /• Moved: Dinner — D\(2030-05-03\) → D\(2030-05-02\)/.test(text) && /• Time changed: Museum — 10:00 AM → 11:30 AM/.test(text),
  'removed / moved / re-timed each get their own precise line');
const big = { added: Array.from({ length: 15 }, (_, i) => E(`x${i}`, `Ev ${i}`, '2030-05-01', '')), removed: [], moved: [], retimed: [] };
assert(/…and 3 more$/.test(tripsyAttireChangeSummaryText(big)), 'a long list is capped with a count');
assert(tripsyAttireGuideChanges(guide, guide.days).total === 0, 'an unchanged itinerary has no changes');

// ---- the prompt: explains, asks, and hands off to the MINIMAL update ----
const prompt = extractFn('tripsyAttireStalePrompt');
assert(/const changes = tripsyAttireGuideChanges\(guide, currentDays\);/.test(prompt) && /tripsyAttireChangeSummaryText\(changes\)/.test(prompt),
  'THE ASK: the out-of-date dialog lists the precise changes');
assert(/Since this was built, the itinerary changed:/.test(prompt) && /yes: 'Update', no: 'Not now'/.test(prompt), 'and asks whether to update');
assert(/countsAffected = guide\.guidanceFingerprint \? fp !== guide\.guidanceFingerprint : true;/.test(prompt),
  'it works out BEFORE updating whether the packing counts are even affected');
assert(/Your packing counts are unaffected — nothing else will be regenerated\./.test(prompt), 'and says so when they are not');
assert(/tripsyAttireMinimalUpdate\(tripKey, \{ currentDays, newEvents, countsAffected \}\);/.test(prompt), 'Yes runs the minimal update');
assert(!/tripsyRunAttireGenerationSafely/.test(prompt), 'the prompt itself never fires a full regeneration');

const min = extractFn('tripsyAttireMinimalUpdate');
assert(/picks = await showTripsyAttireNewEventsDialog\(newEvents\);/.test(min) && /if \(!picks\) return;/.test(min),
  'new events get their dress codes asked (no Claude call); cancelling changes nothing');
assert(/await tripsyAttireApplyNewEvents\(guide, currentDays, picks\)/.test(min), 'THE MINIMUM: a mechanical merge keeps every saved dress code');
assert(/await tripsyAttireAdoptNewEventsIntoOutfits\(tripKey, guide\)/.test(min), 'folded-in events adopt existing outfits for free');
assert(/if \(!tripsyAttireGuideIsDressOnly\(guide\) && countsAffected\) \{[\s\S]*tripsyRunAttireGenerationSafely\(tripKey, \{ isRefresh: true, minimal: true \}\);/.test(min),
  'the packing guidance is re-run ONLY when the tier counts/blocks actually moved, in the background');
assert(min.indexOf("toast('Attire guide updated.', 'success')") > 0, 'otherwise the update ends with no regeneration at all');
assert(!/tripsyAttireStalePrompt = async/.test(html) && /return !\(await tripsyAttireStalePrompt\(tripKey\)\);/.test(html),
  'the 👔 button and the flagged menu rows share the one top-level prompt');

// ---- outfits: the precise blocks, and only those re-dressed ----
const reasons = extractFn('tripsyOutfitStaleReasons');
assert(/tripsyOutfitsUncoveredBlocks\(guide, outfits\)/.test(reasons) && /no outfit for \$\{tripsyDayHeaderLabel\(b\.dayKey\)\}/.test(reasons),
  'uncovered time-blocks are named by day and dress code');
assert(/no longer packed/.test(reasons) && /!selected\.has\(id\)/.test(reasons), 'outfits wearing an unpacked garment are named with the garment');
assert(/const reasons = await tripsyOutfitStaleReasons\(key\);/.test(html) && /Since these outfits were composed:\\n\$\{list\}/.test(html),
  'THE ASK: the View Outfits dialog lists those precise reasons');
assert(/every other outfit is kept as it is\./.test(html), 'and promises only the minimum');
assert(/white-space:pre-line/.test(extractFn('tripsyConfirmDialog')), 'the confirm dialog renders the list line by line');
