// "Why is the date not showing up for the last few days on my travel view" -- pinned
// down (via the owner) to the TOP CALENDAR STRIP: on any 2+ week trip the strip
// overflows Travel View's 560px column (18 cells x ~52px ~= 936px vs ~532px usable),
// its scrollbar is hidden, and the auto-centering that should scroll it to the
// selected day only ever fired EARLY (synchronously at render), while layout was
// still settling -- unlike the vertical open-on-today jump, which re-asserts itself
// at rAF + 120/350/800ms for exactly this reason. If that one early attempt landed
// wrong (or Element.scrollTo(options) silently no-opped in the older iPad WebView),
// the strip sat parked at the trip's first day with the last days cut off past the
// right edge. Fixed two ways: (1) stripScrollTo -- instant positioning assigns
// scrollLeft DIRECTLY (WebView-proof), smooth still tries scrollTo(options) with a
// fallback; (2) settleAlign now re-asserts recenterCal(false) alongside the vertical
// scroll on every settle pass, so the strip converges the same way the jump does.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- extract the strip-wiring block inside renderTravelView ----
const wireStart = html.indexOf("const strip = main.querySelector('.tv-strip');");
assert(wireStart > -1, 'sanity: found the strip wiring');
const wireBlock = html.slice(wireStart, html.indexOf('function ', wireStart + 100000) > -1 ? wireStart + 12000 : html.length);

// ---- source-pattern checks: the WebView-proof scroll choke point ----
assert(/const stripScrollTo = \(left, smooth\) => \{\s*\n\s*if \(smooth\) \{ try \{ strip\.scrollTo\(\{ left, behavior: 'smooth' \}\); return; \} catch \(e\) \{ \/\* fall through \*\/ \} \}\s*\n\s*strip\.scrollLeft = left;\s*\n\s*\};/.test(wireBlock),
  'THE FIX: instant positioning assigns scrollLeft directly; smooth tries scrollTo(options) with a direct fallback');
assert(/if \(Math\.abs\(strip\.scrollLeft - target\) >= 1\) stripScrollTo\(target, true\);/.test(wireBlock),
  'keepInDeadZone goes through the shared choke point');
assert(/stripScrollTo\(target, smooth\);/.test(wireBlock), 'recenterCal goes through it too');
assert(!/strip\.scrollTo\(\{ left: target/.test(wireBlock),
  'no remaining direct strip.scrollTo({left: target...}) call bypasses the choke point');

// ---- source-pattern checks: the strip position is re-asserted across the settle window ----
const settleStart = wireBlock.indexOf('const settleAlign = () => {');
assert(settleStart > -1, 'sanity: found settleAlign');
const settleBlock = wireBlock.slice(settleStart, wireBlock.indexOf('};', settleStart) + 2);
assert(/scrollItineraryTo\(initDay, false\);/.test(settleBlock), 'settleAlign still re-asserts the vertical jump (unchanged)');
assert(/recenterCal\(false\);/.test(settleBlock),
  'THE FIX: settleAlign now re-asserts the CALENDAR STRIP position too, same retry window as the vertical jump');
assert(/if \(ownerScrolled\) return;/.test(settleBlock),
  'and still stops the moment the owner touches the page, so a late pass can never fight a manual strip swipe');

// ---- executed: stripScrollTo's fallback behavior, against a fake strip ----
{
  const run = (scrollToThrows) => {
    const calls = { scrollToArgs: null, scrollLeftSet: null };
    const strip = {
      scrollLeft: 0,
      scrollTo(opts) { if (scrollToThrows) throw new Error('unsupported'); calls.scrollToArgs = opts; },
    };
    Object.defineProperty(strip, 'scrollLeft', {
      get() { return this._sl || 0; },
      set(v) { this._sl = v; calls.scrollLeftSet = v; },
    });
    const stripScrollTo = (left, smooth) => {
      if (smooth) { try { strip.scrollTo({ left, behavior: 'smooth' }); return; } catch (e) { /* fall through */ } }
      strip.scrollLeft = left;
    };
    return { calls, stripScrollTo };
  };

  // Instant mode NEVER touches scrollTo -- direct assignment only, WebView-proof.
  let { calls, stripScrollTo } = run(false);
  stripScrollTo(404, false);
  assert(calls.scrollLeftSet === 404 && calls.scrollToArgs === null,
    'instant positioning is a direct scrollLeft assignment, never a scrollTo(options) call');

  // Smooth mode uses scrollTo when it works...
  ({ calls, stripScrollTo } = run(false));
  stripScrollTo(200, true);
  assert(calls.scrollToArgs && calls.scrollToArgs.left === 200 && calls.scrollToArgs.behavior === 'smooth' && calls.scrollLeftSet === null,
    'smooth positioning uses scrollTo(options) for the easing when supported');

  // ...and falls back to the direct assignment when scrollTo(options) throws.
  ({ calls, stripScrollTo } = run(true));
  stripScrollTo(200, true);
  assert(calls.scrollLeftSet === 200, 'a throwing scrollTo(options) falls back to the direct assignment instead of leaving the strip parked');
}

// ---- executed: the recenter math itself -- the last few days genuinely come into view ----
{
  // 18-day trip, 52px stride, 532px viewport: scrollWidth 936, max scrollLeft 404.
  const stride = 52, clientWidth = 532, scrollWidth = 18 * stride;
  const clampLeft = x => Math.max(0, Math.min(x, scrollWidth - clientWidth));
  const offsetLeftOf = dayIndex => dayIndex * stride; // 0-based cell index
  const recenterTarget = dayIndex => clampLeft(offsetLeftOf(dayIndex) - 3.5 * stride);

  // Mid-trip today (day 14 of 18, e.g. Aug 15 of Aug 2-19): recentring clamps to the
  // right edge, so the LAST day's cell is inside the visible window.
  const target = recenterTarget(13);
  const lastCellLeft = offsetLeftOf(17);
  assert(target === 404, `today near the trip's end clamps the strip to its right edge -> ${target}`);
  assert(lastCellLeft >= target && lastCellLeft + stride <= target + clientWidth,
    'THE ASK: with the recenter actually applied, the final day\'s date cell is fully visible');

  // Day 1 of the trip: target clamps to 0 -- the strip correctly stays at the left edge.
  assert(recenterTarget(0) === 0, 'opening on the first day keeps the strip at its natural left edge');
}
