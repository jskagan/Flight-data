// "On days with no scheduled events you still need to account for clothing.
// Use casual as the default for those days and show them on all packing plans
// and summaries — include the date and say 'No events planned'."
// tripsyAttireBuildDays now fills every gap between the trip's first and last
// event day with ONE synthetic free-day event (tripsyAttireFreeDayEvent,
// freeDay:true, stable id per day) — so free days form their own Casual
// time-block, count as Casual occasions in the guidance sizing, render under
// their date in the Daily Dress Guide / review dialog / drill-downs, are
// overridable like any event, and get outfits composed. The model prompt gets
// only REAL events (the apply loops default an unmatched event to 'casual' —
// exactly the rule); the fingerprint covers EVERYTHING so the staleness
// readers (which hash days.flatMap) can never disagree with generation.
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

// ---- source patterns ----
assert(/const TRIPSY_ATTIRE_FREE_DAY_NAME = 'No events planned';/.test(html),
  'THE ASK: the placeholder says exactly "No events planned"');
const build = extractFn('tripsyAttireBuildDays');
assert(/tripsyDayKeyRange\(days\[0\]\.dayKey, days\[days\.length - 1\]\.dayKey\)/.test(build),
  'the fill walks the first-to-last EVENT day span (the itinerary\'s own day-range rule), not the drifting trip start/end');
assert(/have\.get\(k\) \|\| \{ dayKey: k, events: \[tripsyAttireFreeDayEvent\(k\)\] \}/.test(build),
  'THE ASK: every gap day enters the guide with its free-day placeholder, in chronological order');
const gen = extractFn('generateTripsyAttireGuide');
assert(/const allGuideEvents = days\.flatMap\(d => d\.events\);\s*\n\s*const currentEventsForPrompt = allGuideEvents\.filter\(e => !e\.freeDay\);/.test(gen),
  'the MODEL prompt gets only real events; a free day has nothing to judge');
assert((gen.match(/tripsyAttireFingerprint\(allGuideEvents\)/g) || []).length === 2,
  'BOTH fingerprint sites (eventsUnchanged detection + the saved eventFingerprint) hash the FULL list -- the staleness readers hash days.flatMap, and a mismatch would read stale forever');
assert(/\(match && match\.category\) \|\| 'casual'/.test(gen) && /\(prior && prior\.category\) \|\| 'casual'/.test(gen),
  'THE ASK: both category apply loops default an unmatched event to casual -- the free-day rule needs no special case');
assert(/ev\.freeDay\s*\n\s*\? `<span style="color:var\(--muted\); font-style:italic;">/.test(html),
  'the Daily Dress Guide renders a free day as plain text, never as a jump-to-My-Trips button for an event that does not exist there');

// ---- executed: the gap fill against fixtures ----
{
  eval(extractFn('tripsyDayKeyRange').replace(/^function /, 'var tripsyDayKeyRange = function '));
  eval(html.slice(html.indexOf('const TRIPSY_ATTIRE_FREE_DAY_NAME'), html.indexOf('async function tripsyAttireBuildDays')));
  // Reproduce the builder's fill step exactly as written.
  const fill = days => {
    if (days.length) {
      const have = new Map(days.map(d => [d.dayKey, d]));
      const range = tripsyDayKeyRange(days[0].dayKey, days[days.length - 1].dayKey);
      if (range.length > days.length) {
        return range.map(k => have.get(k) || { dayKey: k, events: [tripsyAttireFreeDayEvent(k)] });
      }
    }
    return days;
  };

  const evDay = (dayKey, name) => ({ dayKey, events: [{ id: `activity-${name}`, name, date: dayKey, category: null }] });
  const days = fill([evDay('2026-11-06', 'Flight out'), evDay('2026-11-09', 'Dinner'), evDay('2026-11-10', 'Flight home')]);
  assert(days.length === 5 && days.map(d => d.dayKey).join(',') === '2026-11-06,2026-11-07,2026-11-08,2026-11-09,2026-11-10',
    'THE ASK: the two empty days appear, dated, in order');
  const free = days[1].events[0];
  assert(free.name === 'No events planned' && free.freeDay === true && free.id === 'freeday-2026-11-07' && free.category === null,
    'a gap day carries exactly one placeholder: named, flagged, stable per-day id, category left for the casual default');
  assert(days[1].events.length === 1 && days[3].events[0].name === 'Dinner',
    'real days are untouched; free days never get a second event');
  assert(!/\bhike|run|climb|bike/i.test(free.name) && free.name === 'No events planned',
    'sanity: the placeholder name can never trip the athletic keyword rule');

  const noGaps = fill([evDay('2026-12-01', 'A'), evDay('2026-12-02', 'B')]);
  assert(noGaps.length === 2, 'a trip with no empty days is returned exactly as before');
  assert(fill([]).length === 0, 'a trip with no dated events stays empty (no placeholder span to invent)');

  // Cross-generation stability: the id is derived from the date alone, so a
  // manual override keyed by id survives a refresh.
  assert(tripsyAttireFreeDayEvent('2026-11-07').id === tripsyAttireFreeDayEvent('2026-11-07').id,
    'free-day ids are deterministic, so overrides on a free day stick across regenerations');
}

// ---- executed: casual default + override flow through the real apply-loop shapes ----
{
  const applyFresh = (ev, match, prior) => {
    if (prior && prior.categoryOverridden) return { ...ev, category: prior.category, categoryOverridden: true };
    return { ...ev, category: (match && match.category) || 'casual' };
  };
  const free = { id: 'freeday-2026-11-07', name: 'No events planned', freeDay: true, category: null };
  assert(applyFresh(free, undefined, undefined).category === 'casual',
    'THE ASK: with no model match (free days are kept out of the prompt), a free day lands at Casual');
  assert(applyFresh(free, undefined, { category: 'athletic', categoryOverridden: true }).category === 'athletic',
    'an owner who re-tiered a free day (a beach day to Athletic, say) keeps that pick on every later refresh');
}
