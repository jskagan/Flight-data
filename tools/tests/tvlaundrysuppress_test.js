// "Once a wash is done, remove the 'next best wash day' banner on the travel view, but
// keep all later wash day banners." Travel View's laundry banner (tvAttireLaundry) used
// to just mirror the attire guide's suggested laundryDays verbatim, with no awareness
// of whether the owner had actually done a wash -- every suggested day kept showing its
// banner for the whole trip, even ones long since acted on. Now: once at least one real
// wash exists (either person, since laundryDays itself is trip-level, not per-person),
// every suggested day on or before the LATEST wash date is suppressed; anything later is
// still genuinely pending advice and stays.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- source-pattern checks: the fix is present in renderTravelView ----
const tvStart = html.indexOf('async function renderTravelView(');
const tvBlock = html.slice(tvStart, tvStart + 14000); // the attire-guide-load section is well into the function
assert(/const washedDayKeys = Store\.listTripsyLaundry\(trip\.key\)\.filter\(r => r\.washedAt\)\.map\(r => r\.dayKey\);/.test(tvBlock),
  'collects every actually-washed day (either person) for this trip');
assert(/const latestWashDayKey = washedDayKeys\.length \? washedDayKeys\.reduce\(\(a, b\) => \(b > a \? b : a\)\) : null;/.test(tvBlock),
  'finds the LATEST washed day');
assert(/if \(latestWashDayKey && l\.dayKey <= latestWashDayKey\) return; \/\/ already handled/.test(tvBlock),
  'THE FIX: a suggested day on or before the latest wash is suppressed');

// ---- executed: the exact suppression rule, against fixtures ----
{
  const suppress = (laundryDays, washedDayKeys) => {
    const tvAttireLaundry = new Map();
    const latestWashDayKey = washedDayKeys.length ? washedDayKeys.reduce((a, b) => (b > a ? b : a)) : null;
    laundryDays.forEach(l => {
      if (!l || !l.dayKey) return;
      if (latestWashDayKey && l.dayKey <= latestWashDayKey) return;
      tvAttireLaundry.set(l.dayKey, l.reason || '');
    });
    return tvAttireLaundry;
  };

  const laundryDays = [
    { dayKey: '2026-08-05', reason: 'relaxed morning' },
    { dayKey: '2026-08-14', reason: 'two-night stay, downtime before the next leg' },
    { dayKey: '2026-08-23', reason: 'last chance before the final push' },
  ];

  // No wash yet at all -> every suggested banner still shows.
  let result = suppress(laundryDays, []);
  assert(result.size === 3, 'with no wash yet, all three suggested banners still show -> ' + result.size);

  // A wash on the FIRST suggested day itself -> that one clears, the two LATER ones stay.
  result = suppress(laundryDays, ['2026-08-05']);
  assert(!result.has('2026-08-05'), 'THE FIX: the day that was just washed no longer shows its banner');
  assert(result.has('2026-08-14') && result.has('2026-08-23'), 'the two later suggested days are untouched -> ' + [...result.keys()]);

  // A wash on a day BETWEEN two suggestions (owner didn't wash exactly on the suggested
  // date, just sometime after it) -> the passed suggestion still clears.
  result = suppress(laundryDays, ['2026-08-09']);
  assert(!result.has('2026-08-05'), 'a wash after the suggested day still retires that suggestion');
  assert(result.has('2026-08-14') && result.has('2026-08-23'), 'later suggestions are unaffected by a wash that happened before them');

  // TWO washes done -> both the first and second suggestions clear, only the third
  // (still in the future relative to the latest wash) remains.
  result = suppress(laundryDays, ['2026-08-05', '2026-08-16']);
  assert(!result.has('2026-08-05') && !result.has('2026-08-14'), 'both suggestions on/before the LATEST wash are cleared');
  assert(result.has('2026-08-23'), 'the one suggestion still ahead of every wash so far remains -> ' + [...result.keys()]);

  // A wash on/after the LAST suggested day -> every banner clears, nothing left pending.
  result = suppress(laundryDays, ['2026-08-23']);
  assert(result.size === 0, 'a wash covering the final suggestion clears every banner -> ' + result.size);

  // Order of wash records doesn't matter -- "latest" is computed correctly either way.
  result = suppress(laundryDays, ['2026-08-16', '2026-08-05']);
  assert(!result.has('2026-08-14') && result.has('2026-08-23'),
    'the latest wash is found correctly regardless of the washes\' array order');
}
