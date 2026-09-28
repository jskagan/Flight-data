// "The itinerary does not show all of the concerts on the schedule. For
// example, on October 9 there are three concerts, but only one is
// mentioned" (2026-09-28). The document was the saved PARTIAL itinerary: a
// partial is a saved include-list, so events added to the trip AFTER it
// was saved were silently absent -- but a partial is made by REMOVING, so
// an event the owner never had the chance to exclude must default to
// INCLUDED. No schema change: locally-minted event ids are epoch-millis
// * 1000 (tripsyMintLocalId), so the id itself dates the event against the
// record's updatedAt (tripsyPartialEventPostdatesSave). Self-correcting:
// unchecking the new event in the picker re-saves the record, and the
// fresh updatedAt then postdates the id, so the exclusion sticks.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
  if (!m) return null;
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

const src = ['tripsyPartialBaseEventId', 'tripsyPartialEventPostdatesSave', 'tripsyPartialKeyPostdatesSave',
  'tripsyFilterPrintDayDataForPartial', 'tripsyMintLocalId'].map(extractFn).join('\n');
const env = new Function(`
  var tripsySummaryRowKey = item => item.psReservation ? 'ps:' + item.psReservation.reservationNumber : ('ev:' + item.ev.id);
  ${src}
  return { tripsyPartialEventPostdatesSave, tripsyPartialKeyPostdatesSave, tripsyFilterPrintDayDataForPartial, tripsyMintLocalId };
`)();

const SAVED_AT = '2026-09-27T02:37:47.313Z';
const savedMs = Date.parse(SAVED_AT);
// A locally-minted id from the day AFTER the save, and a Tripsy-era id.
const newId = `activity-${(savedMs + 86400000) * 1000}`;
const tripsyEraId = 'activity-3833276';

// ---- the dating rule itself ----
assert(env.tripsyPartialEventPostdatesSave(newId, savedMs),
  'an event minted after the save postdates it');
assert(!env.tripsyPartialEventPostdatesSave(tripsyEraId, savedMs),
  'a Tripsy-era id (small number) never postdates -- it existed at save time');
assert(!env.tripsyPartialEventPostdatesSave(newId, Date.parse('2026-09-29T00:00:00Z')),
  'SELF-CORRECTION: a later re-save (fresh updatedAt) makes the same event count as decided-on, so an explicit uncheck sticks');
assert(!env.tripsyPartialEventPostdatesSave(newId, 0) && !env.tripsyPartialEventPostdatesSave('activity-abc', savedMs),
  'no savedAt, or a non-numeric id, never triggers (falls back to keys-only, the old behavior)');
assert(env.tripsyPartialEventPostdatesSave(`${env.tripsyMintLocalId()}`, Date.now() - 60000),
  'an id minted NOW postdates a save from a minute ago -- the mint scale and the rule agree');
assert(env.tripsyPartialKeyPostdatesSave(`event:ev:${newId}`, savedMs)
  && !env.tripsyPartialKeyPostdatesSave(`event:ps:${(savedMs + 86400000) * 1000}`, savedMs),
  'the key-form wrapper (picker resume) matches only real event keys, never P/S rows');

// ---- executed: the filter keeps a post-save event it was never told about ----
{
  const mkItem = id => ({ ev: { id } });
  const data = {
    dayKeys: ['2026-10-09'],
    byDay: new Map(),
    placesByDay: new Map([['2026-10-09', [{ id: 'activity-kept' }, { id: newId }, { id: tripsyEraId }]]]),
    placeEvents: [{ id: 'activity-kept' }, { id: newId }, { id: tripsyEraId }],
    summaryByDay: new Map([['2026-10-09', [mkItem('activity-kept'), mkItem(newId), mkItem(tripsyEraId)]]]),
  };
  const keys = new Set(['day:2026-10-09', 'event:ev:activity-kept']);
  const out = env.tripsyFilterPrintDayDataForPartial(data, keys, SAVED_AT);
  const keptIds = (out.summaryByDay.get('2026-10-09') || []).map(i => i.ev.id);
  assert(keptIds.includes('activity-kept') && keptIds.includes(newId) && !keptIds.includes(tripsyEraId),
    'THE FIX: a post-save event renders in the partial alongside the explicitly-kept one; a pre-save excluded event stays out');
  assert(out.placeEvents.some(e => e.id === newId) && !out.placeEvents.some(e => e.id === tripsyEraId)
    && (out.placesByDay.get('2026-10-09') || []).some(e => e.id === newId),
    'placeEvents/placesByDay follow the same rule (photos and blurbs for the newcomer)');
  const before = env.tripsyFilterPrintDayDataForPartial(data, keys, null);
  assert(!(before.summaryByDay.get('2026-10-09') || []).some(i => i.ev.id === newId),
    'no savedAt (defensive) keeps the strict keys-only behavior');
}

// ---- wiring: savedAt actually reaches every render of the partial ----
assert(/summaryOnly = false, partialKeys = null, partialSavedAt = null/.test(extractFn('buildTripsyPrintHtml'))
  && /tripsyFilterPrintDayDataForPartial\(\{[^}]*\}, partialKeys, partialSavedAt\)/.test(extractFn('buildTripsyPrintHtml')),
  'buildTripsyPrintHtml threads partialSavedAt into the filter');
{
  const show = extractFn('showTripsyPartialItinerary');
  assert(/overlay\._partialSavedAt = savedAt/.test(show)
    && /partialSavedAt: savedAt/.test(show)
    && /tripsyPartialEnsureNarratives\(tripKey, keys, progress, savedAt\)/.test(show),
    'Show stashes the record’s updatedAt and passes it to the build and the narrative ensure');
}
assert(/partialSavedAt: overlay\._partialSavedAt \|\| null/.test(html),
  'Save as PDF from the partial overlay carries the same savedAt');
assert(/partialKeys: keys, summaryOnly: false, partialSavedAt: savedAt/.test(html),
  'the background photo-maintenance rebuild carries it too (else its repaint would drop the newcomers again)');
{
  const panel = extractFn('tripsyPartialPanelHtml');
  assert(/savedKeys\.has\(key\) \|\| tripsyPartialKeyPostdatesSave\(key, savedAtMs\)/.test(panel),
    'the Create Partial picker resumes a post-save event as CHECKED, so unchecking it is a real, sticking choice');
}
