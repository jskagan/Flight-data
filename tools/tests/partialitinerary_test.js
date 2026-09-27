// "Under the itinerary menu item, create a new menu option called Create
// Partial, which will create a partial itinerary that does not include all
// events... display a menu that is similar to the Create Itinerary menu with
// check marks... The itinerary should only include those items and should be
// separate from the full itinerary... If a full itinerary is already
// prepared, the partial itinerary can simply copy the narratives from the
// already generated full itinerary... identical to the items on the full
// itinerary, except that it should include less items." (2026-09-26)
//
// Implementation: the partial is a render-time FILTER over the same print day
// data + narrative cache the full itinerary reads (buildTripsyPrintHtml's
// partialKeys option / tripsyFilterPrintDayDataForPartial) -- so it copies
// narratives by construction, stores none of its own, and never touches the
// full itinerary. The picker panel reuses tripsyGeneratePanelSections' rows
// (same sections as the Generate panel) with its own include/exclude
// checkboxes; the selection persists per trip in
// driveData.tripsyPartialItineraries.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
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

// ---- the menu item and its panel ----
assert(/data-tripsy-partial-itinerary data-key="\$\{esc\(trip\.key\)\}"`, '✂️', 'Create Partial'\)/.test(html),
  'THE ASK: a "Create Partial" option under the 🧭 Itinerary menu');
assert(/\$\{isOwner \? menuListButtonHtml\(`data-tripsy-partial-itinerary/.test(html),
  'owner-only: creating a partial saves a selection into driveData, which a viewer cannot write');
assert(/data-tripsy-partial-panel="\$\{esc\(trip\.key\)\}"/.test(html),
  'the picker panel node exists per trip card, alongside the Generate panel');
['TRIPSY_TRIP_PANEL_SELECTORS', 'freshlyRenderedEachTime'].forEach(() => {});
assert(/'\[data-tripsy-partial-panel\]',\s*\n\s*'\[data-tripsy-trip-menu\]',/.test(html),
  'registered in TRIPSY_TRIP_PANEL_SELECTORS so the generic outside-click close treats it like every other panel');
assert(/'\[data-tripsy-partial-itinerary\]',\s*\n\s*'\[data-tripsy-trip-menu-toggle\]',/.test(html),
  'the menu item is a registered trigger, so opening it is not read as an outside click');
assert(/freshlyRenderedEachTime = new Set\(\[.*'\[data-tripsy-partial-panel\]'/.test(html),
  'freshly rendered per open, same as the Generate panel');
assert(/closest\('button, a, \[data-tripsy-add-item-menu\][^)]*\[data-tripsy-partial-panel\]/.test(html),
  'clicks inside the picker cannot bubble into the card header and collapse the trip (the sort-menu checkbox lesson)');
assert(/\[data-tripsy-partial-panel\],\s*\n\s*\[data-tripsy-add-item-menu\] \{ min-width: 0 !important/.test(html),
  'phone width cap applies to this panel like every other Tripsy dropdown');

// ---- the picker reuses the Generate panel sections and persists selection ----
{
  const wireStart = html.indexOf('container.querySelectorAll("[data-tripsy-partial-itinerary]")');
  const wire = html.slice(wireStart, wireStart + 2200);
  assert(/tripsyGeneratePanelSections\(tripKey, effectiveTrip, dayKeys, summaryByDay, narrativeCache\)/.test(wire),
    'THE ASK: the picker lists the SAME sections as the Create (Generate) panel -- one builder, so they can never disagree');
  assert(/Store\.getTripsyPartialItinerary\(tripKey\)/.test(wire) && /new Set\(saved\.keys\)/.test(wire),
    'a saved selection resumes pre-checked');
  assert(/const rect = btn\.getBoundingClientRect\(\);\s*\n\s*closeAllTripsyTripPanels\(\);/.test(wire),
    'rect captured BEFORE closing panels (the Generate panel\'s own collapse lesson)');
}
const wirePanel = extractFn('wireTripsyPartialPanel');
assert(/if \(panel\.dataset\.tripsyPartialWired\) return;/.test(wirePanel),
  'the delegated listener is wired once per panel node -- re-opening must not stack a second toggle per tap');
assert(/data-partial-day="\$\{CSS\.escape\(dayKey\)\}"/.test(wirePanel),
  'toggling a DAY checkbox carries its own events with it');
assert(/if \(!keys\.some\(k => k\.startsWith\('event:'\)\)\)/.test(wirePanel),
  'a selection with zero events is refused rather than rendering an empty document');
assert(/Store\.saveTripsyPartialItinerary\(tripKey, keys, \{ mode, title, startDayKey, endDayKey \}\)\.then/.test(wirePanel)
  && /closeAllTripsyTripPanels\(\);\s*\n\s*showTripsyPartialItinerary\(tripKey, new Set\(keys\), mode, \{ generateFirst: mode === 'full' && isOwner \}\);/.test(wirePanel),
  'View saves in the background (optimistic, with mode/title/span) and opens the document immediately');

// ---- separate, read-only view; narratives come from the same cache ----
const show = extractFn('showTripsyPartialItinerary');
assert(/buildTripsyPrintHtml\(tripKey, \{ partialKeys: keys, summaryOnly: mode === 'summary' \}\)/.test(show),
  'THE ASK: the partial renders through the SAME print build as the full itinerary, filtered -- its narratives are the full itinerary\'s, by construction');
const buildStart = html.indexOf('async function buildTripsyPrintHtml(');
const buildSlice = html.slice(buildStart, buildStart + 4000);
assert(/\{ summaryOnly = false, partialKeys = null \}/.test(buildSlice),
  'buildTripsyPrintHtml takes partialKeys');
assert(/tripsyTripGeographySummary\(headerPlaceEvents/.test(html) && /tripsyHeaderBackgroundPhotoUrl\(headerPlaceEvents\)/.test(html),
  'the cover header still describes the WHOLE trip -- a partial is a cut of the same itinerary, not a different trip');
assert(/const introEntry = \(partialKeys && !partialKeys\.has\('overview'\)\) \? null : narrativeCache\[`\$\{tripKey\}::intro`\];/.test(html),
  'the Overview narrative is read from the cache only when included -- never deleted or regenerated');
assert(/if \(partialKeys && !partialKeys\.has\(`day:\$\{dayKey\}`\)\) return null;/.test(html),
  'a day\'s narrative is likewise read-if-included; the full itinerary\'s cache entries are untouched');
assert(/const partialDatedKeys = partialKeys \? \[\.\.\.eventDayKeySet\]\.sort\(\) : null;/.test(html),
  'the calendar span is bounded to the kept days (excluded days must not render as fake "No events scheduled" blocks), while day NUMBERS stay date-derived and identical to the full itinerary');
assert(/openTripsyItineraryPrintView\(tripKey, \{ summaryOnly = false, partialKeys = null \}/.test(
  html.slice(html.indexOf('async function openTripsyItineraryPrintView'), html.indexOf('async function openTripsyItineraryPrintView') + 200).replace(/\n/g, ' ')) || /partialKeys = null \} = \{\}\) \{\s*\n\s*const html = await buildTripsyPrintHtml\(tripKey, \{ summaryOnly, partialKeys \}\);/.test(html),
  'Save as PDF goes through the same print path with the same filter');

// ---- storage + prune ----
assert(/async getTripsyPartialItinerary\(tripKey\)/.test(html) && /async saveTripsyPartialItinerary\(tripKey, keys, extra = \{\}\)/.test(html),
  'selection persists per trip in driveData.tripsyPartialItineraries');
assert(/driveData\.tripsyPartialItineraries = driveData\.tripsyPartialItineraries\.filter\(p => keys\.has\(p\.tripKey\)\);/.test(html),
  'pruneDriveDataInMemory drops a selection whose trip no longer exists (every new driveData key needs its prune rule)');

// ---- executed: the base-id rule and the filter itself ----
{
  eval(extractFn('tripsyPartialBaseEventId').replace(/^function /, 'var tripsyPartialBaseEventId = function '));
  eval(extractFn('tripsySummaryRowKey').replace(/^function /, 'var tripsySummaryRowKey = function '));
  eval(extractFn('tripsyFilterPrintDayDataForPartial').replace(/^function /, 'var tripsyFilterPrintDayDataForPartial = function '));

  assert(tripsyPartialBaseEventId('12345-checkin') === '12345' && tripsyPartialBaseEventId('12345-checkout') === '12345'
    && tripsyPartialBaseEventId('777-begin') === '777' && tripsyPartialBaseEventId('777-end') === '777',
    'split multi-day halves resolve to one base id -- keeping the check-in row keeps the check-out row, they are one event');
  assert(tripsyPartialBaseEventId('9001') === '9001' && tripsyPartialBaseEventId('pending-create-8f2e') === 'pending-create-8f2e',
    'ordinary ids (numeric, pending-create) pass through untouched');

  // Fixture: day 1 = flight A, layover, flight B, PS row; day 2 = hotel
  // check-in (head half); day 3 = dinner; day 4 = hotel check-out (end half).
  const evItem = (dayKey, id, extra = {}) => ({ dayKey, ev: { id, ...extra } });
  const d1 = [
    evItem('2026-11-01', 'A'),
    { dayKey: '2026-11-01', isLayover: true },
    evItem('2026-11-01', 'B'),
    { dayKey: '2026-11-01', psReservation: { reservationNumber: 'R9' } },
  ];
  const d2 = [evItem('2026-11-02', 'H-checkin', { _splitHalf: 'begin' })];
  const d3 = [evItem('2026-11-03', 'D')];
  const d4 = [evItem('2026-11-04', 'H-checkout', { _splitHalf: 'end' })];
  const mkData = () => ({
    dayKeys: ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'],
    byDay: new Map(),
    summaryByDay: new Map([['2026-11-01', d1], ['2026-11-02', d2], ['2026-11-03', d3], ['2026-11-04', d4]]),
    placeEvents: [{ id: 'H' }, { id: 'D' }],
    placesByDay: new Map([['2026-11-02', [{ id: 'H' }]], ['2026-11-03', [{ id: 'D' }]]]),
  });

  // Include both flights + the hotel; exclude the dinner and the PS row.
  let out = tripsyFilterPrintDayDataForPartial(mkData(), new Set(['event:ev:A', 'event:ev:B', 'event:ev:H-checkin', 'day:2026-11-01']));
  assert(out.dayKeys.join(',') === '2026-11-01,2026-11-02,2026-11-04',
    'THE ASK: only days with included items survive -- the dinner\'s day drops out');
  assert(out.summaryByDay.get('2026-11-01').length === 3 && out.summaryByDay.get('2026-11-01')[1].isLayover === true,
    'the layover between two KEPT flights is kept (the connection still exists on paper)');
  assert(!out.summaryByDay.get('2026-11-01').some(it => it.psReservation),
    'an unchecked P/S row is excluded even though its flight is kept');
  assert(out.summaryByDay.get('2026-11-04')[0].ev.id === 'H-checkout',
    'keeping the hotel\'s check-in row (the only one the picker lists) keeps its check-out row too');
  assert(out.placeEvents.length === 1 && out.placeEvents[0].id === 'H' && !out.placesByDay.has('2026-11-03'),
    'placeEvents/placesByDay (photo + day-city machinery) are filtered on the same base ids');

  // Exclude one flight: the layover must go with it.
  out = tripsyFilterPrintDayDataForPartial(mkData(), new Set(['event:ev:A', 'event:ev:H-checkin']));
  assert(out.summaryByDay.get('2026-11-01').length === 1 && out.summaryByDay.get('2026-11-01')[0].ev.id === 'A',
    'a layover next to an EXCLUDED flight is dropped -- it would describe a connection this document does not show');

  // PS row included by its own key.
  out = tripsyFilterPrintDayDataForPartial(mkData(), new Set(['event:ps:R9']));
  assert(out.dayKeys.join(',') === '2026-11-01' && out.summaryByDay.get('2026-11-01').length === 1
    && out.summaryByDay.get('2026-11-01')[0].psReservation.reservationNumber === 'R9',
    'a P/S reservation row is independently selectable by its own row key');
}

// ---- executed: the picker defaults and saved-selection resume ----
{
  global.esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  eval(extractFn('tripsyPartialCheckboxHtml').replace(/^function /, 'var tripsyPartialCheckboxHtml = function '));
  eval(extractFn('tripsyPartialPanelRowHtml').replace(/^function /, 'var tripsyPartialPanelRowHtml = function '));
  eval(html.slice(html.indexOf('const TRIPSY_PARTIAL_PANEL_VIEW_BTN_HTML'), html.indexOf('function tripsyPartialPanelHtml')).replace(/^const /, 'var '));
  eval(extractFn('tripsyPartialPanelHtml').replace(/^function /, 'var tripsyPartialPanelHtml = function '));

  const sections = {
    overview: { label: 'Overview' },
    days: [{ dayKey: '2026-11-01', label: 'Day 1', events: [
      { rowKey: 'ev:A', label: 'Flight A' },
      { rowKey: null, label: 'unkeyed row never gets a checkbox' },
    ] }],
  };
  const fresh = tripsyPartialPanelHtml({ name: 'Cirrus Training' }, sections, null);
  assert((fresh.match(/aria-checked="true"/g) || []).length === 3 && !/aria-checked="false"/.test(fresh),
    'no saved selection -> everything starts INCLUDED (a partial is made by removing)');
  assert(/data-tripsy-partial-checkbox="day:2026-11-01" data-partial-daykey="2026-11-01"/.test(fresh)
    && /data-tripsy-partial-checkbox="event:ev:A" data-partial-day="2026-11-01"/.test(fresh),
    'day rows carry the toggle-my-events key; event rows carry their day, so the day toggle finds exactly its own rows');
  assert((fresh.match(/data-tripsy-partial-view/g) || []).length === 2,
    'View button at top AND bottom, same convention as the Generate panel\'s Update');

  const resumed = tripsyPartialPanelHtml({ name: 'T' }, sections, new Set(['event:ev:A']));
  assert(/data-tripsy-partial-checkbox="event:ev:A"[^>]*aria-checked="true"/.test(resumed)
    && /data-tripsy-partial-checkbox="overview"[^>]*aria-checked="false"/.test(resumed),
    'a saved selection resumes exactly as it was left');
}
