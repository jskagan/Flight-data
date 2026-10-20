// "When I am currently on a trip and view that trip from the my trips page, have the
// current day show as the top scrolled date by default" (2026-10-20). Trips open
// collapsed, so the once-per-visit jump saw no marked day; EXPANDING a trip now re-arms
// the jump for that trip. Synthetic only.
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
// A fake page: two trips, each with a marked today day bar at a known offset; a sticky
// header 70px tall; scrolls recorded. Timers run synchronously.
function makePage() {
  const scrolls = [];
  const bar = (trip, top) => ({ getBoundingClientRect: () => ({ top }), closest: () => ({ querySelector: () => ({ getBoundingClientRect: () => ({ height: 70 }) }) }) });
  const bars = { a: bar('a', 500), b: bar('b', 1500) };
  const document = { querySelector: sel => { const m = sel.match(/="([^"]+)"/); return m ? (bars[m[1]] || null) : bars.a; } };
  const window = { scrollY: 0, scrollTo: ({ top }) => scrolls.push(top) };
  const CSS = { escape: s => s };
  const api = new Function('document', 'window', 'CSS', 'requestAnimationFrame', 'setTimeout', [
    'let _tripsyMyTripsScrolledToToday = false; let _tripsyMyTripsTodayScrollTrip = null;',
    fnSource('resetTripsyMyTripsTodayScroll'), fnSource('tripsyMyTripsTodaySelector'), fnSource('tripsyStickyTripHeaderHeight'), fnSource('tripsyScrollMyTripsToToday'),
    'return { reset: resetTripsyMyTripsTodayScroll, scroll: tripsyScrollMyTripsToToday, selector: tripsyMyTripsTodaySelector, done: () => _tripsyMyTripsScrolledToToday };'].join('\n'))(
    document, window, CSS, f => f(), f => f());
  return { api, scrolls };
}
{
  const { api, scrolls } = makePage();
  api.reset('b');
  assert(api.selector() === '[data-tripsy-today-day="b"]', 'THE ASK: expanding a trip arms the jump for THAT trip');
  api.scroll();
  assert(scrolls.length && scrolls.every(y => y === 1500 - 8 - 70), `the jump lands trip b's today bar at the top, just below the 70px pinned header (got ${scrolls[0]})`);
  assert(api.done(), 'once it has scrolled it does not fire again on background re-renders');
  api.scroll();
  assert(scrolls.length === 4, 'a second call after the jump is a no-op (the first ran its rAF + 3 timed passes)');
}
{
  const { api, scrolls } = makePage();
  api.reset();
  assert(api.selector() === '[data-tripsy-today-day]', 'a fresh visit (no trip) still targets whichever in-progress trip is marked');
  api.scroll();
  assert(scrolls[0] === 500 - 8 - 70, 'and lands on it');
}
{
  const { api, scrolls } = makePage();
  api.reset('zzz'); // an expanded trip that is NOT in progress: no marked day
  api.scroll();
  assert(scrolls.length === 0 && !api.done(), 'expanding a trip with no today scrolls nothing and stays armed harmlessly');
}
// ---- wiring ----
assert(/const expanding = isTripsyTripCollapsed\(key\);\n\s*setTripsyTripCollapsed\(key, !expanding\);[\s\S]*?if \(expanding\) resetTripsyMyTripsTodayScroll\(key\);\n\s*renderTripsyEventsList\(\);/.test(html),
  'THE ASK: the header toggle re-arms the jump for the trip being EXPANDED, before the re-render that fires it');
assert(/resetTripsyMyTripsTodayScroll\(\); \/\/ a fresh visit re-arms the open-on-today jump/.test(html), 'a fresh visit still re-arms with no trip filter');
