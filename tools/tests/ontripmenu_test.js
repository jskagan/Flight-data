// "When I am on a trip, do not show the packing list or clothing summary items on the
// clothes menu" (2026-10-20). Synthetic fixtures only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const inProgress = new Function('tripsyDayKey', 'isTripsyEventEffectivelyHidden', [
  fnSource('tripsyItineraryStartDayKey'), fnSource('tripsyItineraryEndDayKey'), fnSource('tripsyTodayDayKey'), fnSource('tripsyTripInProgress'),
  'return tripsyTripInProgress;'].join('\n'))(v => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : ''), ev => !!ev.hidden);

const trip = { key: 't1', start: '2026-10-01', end: '2026-10-30', events: [
  { start: '2026-10-10T08:00', end: '2026-10-10T10:00' },
  { start: '2026-10-20T19:00' },
  { start: '2026-10-25T09:00', hidden: true },
] };
assert(inProgress(trip, '2026-10-15') === true, 'THE ASK: a day between the first and last event day is "on the trip"');
assert(inProgress(trip, '2026-10-10') === true && inProgress(trip, '2026-10-20') === true, 'both ends inclusive -- departure day and last day count');
assert(inProgress(trip, '2026-10-09') === false, 'the day before departure is not on the trip (the Packing List is exactly what is needed then)');
assert(inProgress(trip, '2026-10-21') === false, 'the day after the last EVENT day is not, even inside the stale trip.end');
assert(inProgress(trip, '2026-10-24') === false, 'a hidden event does not extend the trip');
assert(inProgress({ key: 't2', events: [] }, '2026-10-15') === false, 'a trip with no dated events is never in progress');
assert(inProgress({ key: 't3', events: [{ start: '2026-10-15T09:00' }] }, '2026-10-15') === true, 'a one-day trip is in progress on its day');

// ---- the menu gates ----
{
  const start = html.indexOf('const attireMenuItems = attireDressOnly');
  const menu = html.slice(start, html.indexOf('].join', start));
  assert(/const attireTripUnderway = tripsyTripInProgress\(trip\);/.test(html.slice(start - 1500, start)), 'the card builder judges the trip once per render');
  assert(/attireHasGuide && !attireTripUnderway \? menuListButtonHtml\(`data-tripsy-attire-nav="summary"/.test(menu), 'THE ASK: Clothing Summary is hidden while the trip is underway');
  assert(/isOwner && attireHasGuide && !attireTripUnderway \? menuListButtonHtml\(`data-tripsy-attire-nav="pack"/.test(menu), 'THE ASK: Packing List is hidden while the trip is underway');
  for (const nav of ['dressguide', 'packlist', 'outfits', 'location', 'laundry', 'refresh']) {
    const line = (menu.match(new RegExp(`[^\\n]*data-tripsy-attire-nav="${nav}"[^\\n]*`)) || [''])[0];
    assert(line && !/attireTripUnderway/.test(line), `${nav} stays on the menu during the trip`);
  }
}
