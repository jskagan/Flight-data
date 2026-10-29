
let driveData = { tripsyHiddenEventOverrides: {}, tripsyEventOverrides: {} };
function parseTripLocalParts(iso) {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { year: Number(y), month: Number(mo), day: Number(d), hour: h != null ? Number(h) : null, minute: mi != null ? Number(mi) : null };
}
function tripsyDayKey(iso) {
  const p = parseTripLocalParts(iso);
  return p ? `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}` : null;
}
function tripsyEventKey(tripsyRaw) {
  return tripsyRaw ? `${tripsyRaw.resource}:${tripsyRaw.id}` : null;
}
function getTripsyEventOverride(eventKey) {
  return (driveData.tripsyEventOverrides || {})[eventKey] || null;
}
function isTripsyEventEffectivelyHidden(ev) {
  const eventKey = tripsyEventKey(ev.tripsyRaw);
  if (eventKey) {
    const override = getTripsyEventOverride(eventKey);
    if (override === 'shown') return false;
    if (override === 'hidden') return true;
  }
  return !!ev.hidden;
}
function tripsyItineraryStartDayKey(trip) {
  let earliest = null;
  for (const ev of ((trip && trip.events) || [])) {
    if (ev._pendingDeleteId || isTripsyEventEffectivelyHidden(ev)) continue;
    const k = tripsyDayKey(ev.start) || tripsyDayKey(ev.end);
    if (k && (earliest === null || k < earliest)) earliest = k;
  }
  return earliest || tripsyDayKey(trip && trip.start);
}
function tripsyDayNumberFromTripStart(dayKey, tripStartDayKey) {
  if (!dayKey || !tripStartDayKey) return null;
  const toDayIndex = k => {
    const [y, m, d] = k.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  };
  return toDayIndex(dayKey) - toDayIndex(tripStartDayKey) + 1;
}
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// The real trip: declared Aug 2-19, but the first actual event is Aug 3.
const trip = { start:'2026-08-02', end:'2026-08-19', events:[
  { start:'2026-08-03T09:00:00', tripsyRaw:{resource:'transportation', id:1} },
  { start:'2026-08-05T12:00:00', tripsyRaw:{resource:'activity', id:2} },
]};
const startKey = tripsyItineraryStartDayKey(trip);
assert(startKey === '2026-08-03', 'Day 1 anchors on the first EVENT day (Aug 3), not trip.start Aug 2 -> ' + startKey);
assert(tripsyDayNumberFromTripStart('2026-08-03', startKey) === 1, 'Aug 3 = Day 1');
assert(tripsyDayNumberFromTripStart('2026-08-05', startKey) === 3, 'Aug 5 (today) = Day 3');
// vs the OLD trip.start-based numbering, which is what produced the mismatch.
assert(tripsyDayNumberFromTripStart('2026-08-05', '2026-08-02') === 4, 'old trip.start rule called today Day 4 -- the inconsistency reported');
