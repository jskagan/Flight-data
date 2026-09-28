// "Sometimes when I open the app and select my trips there is a delay when I
// select a trip to open" (2026-09-28). Expanding a trip re-renders My Trips,
// and renderTripsyEventsListImpl used to `await tripsyLoadWeather(...)` BEFORE
// assigning container.innerHTML -- serial per-city geocoding, forecast fetches
// for every day of every expanded trip, and tripsyLoadWeather's own whole-file
// persistDriveData() all stood in front of the paint. With everything cached
// and fresh that await cost nothing, which is exactly why the delay read as
// "sometimes": it bit on the first render/expand after the forecast TTL
// lapsed, i.e. typically right after opening the app. Now the render paints
// from CACHE immediately, the weather loads in the background, and
// tripsyRefreshMyTripsWeatherChips patches the day bars' chip slots in place
// (never a full re-render, which would tear down open panels mid-read).
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

// ---- THE FIX: the render never awaits the weather fetch ----
const impl = extractFn('renderTripsyEventsListImpl');
assert(!/await tripsyLoadWeather/.test(impl),
  'THE ASK: renderTripsyEventsListImpl never awaits tripsyLoadWeather -- the paint cannot stand behind geocoding, forecasts, or the weather cache\'s Drive write');
assert(/tripsyLoadWeather\(allTargets\)\s*\n\s*\.then\(\(\) => tripsyRefreshMyTripsWeatherChips\(container, tripsyMyTripsWeather\)\)/.test(impl)
  && /\.catch\(e => console\.error\('background My Trips weather load failed', e\)\)/.test(impl),
  'the fetch runs in the BACKGROUND and patches the chip slots in place when it lands; a failure is logged, never breaks the render');
assert(/data-tripsy-wx-slot data-tripsy-wx-trip="\$\{esc\(trip\.key\)\}" data-tripsy-wx-day="\$\{esc\(dayKey\)\}"/.test(impl)
  && /tripsyMyTripsDayWxChipHtml\(trip\.key, dayKey, tripsyMyTripsWeather\)/.test(impl),
  'every day bar ALWAYS emits a chip slot span (empty when uncached) built by the ONE shared chip builder, so a chip arriving later has a place to land and shifts nothing');

// ---- executed: the shared chip builder ----
const runChip = (rec) => new Function('tripsyGetWeather', 'tripsyWeatherChipHtml',
  extractFn('tripsyMyTripsDayWxChipHtml')
  + '\nconst m = new Map([["t1", new Map([["2026-10-09", [{ city: "Singapore", country: "SG" }]]])]]);'
  + '\nreturn { hit: tripsyMyTripsDayWxChipHtml("t1", "2026-10-09", m), missDay: tripsyMyTripsDayWxChipHtml("t1", "2026-10-10", m), missTrip: tripsyMyTripsDayWxChipHtml("t2", "2026-10-09", m) };')(
  () => rec, (r, city, country, dayKey, style) => `CHIP[${r.kind}|${city}|${dayKey}|${/border:1px solid/.test(style) ? 'boxed' : 'plain'}]`);
{
  const r = runChip({ kind: 'forecast' });
  assert(r.hit === 'CHIP[forecast|Singapore|2026-10-09|plain]' && r.missDay === '' && r.missTrip === '',
    'the chip builder renders a cached forecast plain and returns "" for an uncached day/trip (the empty slot)');
  assert(runChip({ kind: 'typical' }).hit.endsWith('|boxed]'),
    'a climate-normal record keeps its thin outline box cue');
}

// ---- executed: the in-place patch fills empty slots and never blanks one ----
{
  const mkSlot = (tripKey, dayKey, inner) => ({
    attrs: { 'data-tripsy-wx-trip': tripKey, 'data-tripsy-wx-day': dayKey },
    getAttribute(n) { return this.attrs[n]; },
    innerHTML: inner,
  });
  const slots = [mkSlot('t1', 'd1', ''), mkSlot('t1', 'd2', 'OLD-CHIP')];
  const container = { querySelectorAll: sel => (sel === '[data-tripsy-wx-slot]' ? slots : []) };
  const cache = { 'Paris|d1': { kind: 'forecast' } }; // d2's record was pruned/missing
  new Function('container', 'weatherByTrip', 'tripsyGetWeather', 'tripsyWeatherChipHtml',
    extractFn('tripsyMyTripsDayWxChipHtml') + '\n' + extractFn('tripsyRefreshMyTripsWeatherChips')
    + '\ntripsyRefreshMyTripsWeatherChips(container, weatherByTrip);')(
    container,
    new Map([['t1', new Map([['d1', [{ city: 'Paris', country: 'FR' }]], ['d2', [{ city: 'Paris', country: 'FR' }]]])]]),
    (city, country, dayKey) => cache[`${city}|${dayKey}`] || null,
    (r, city, country, dayKey) => `NEW-CHIP[${dayKey}]`);
  assert(slots[0].innerHTML === 'NEW-CHIP[d1]',
    'when the background load lands, an empty slot fills in place -- no full re-render');
  assert(slots[1].innerHTML === 'OLD-CHIP',
    'a slot whose day resolves nothing KEEPS what it shows -- a background pass never blanks a chip');
}
