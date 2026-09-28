// "When the user manually inputs a search term for a photo from the
// itinerary page, do not use a geographic restriction on the search"
// (2026-09-28). With neither locationBias nor locationRestriction, Places'
// searchText silently IP-BIASES results toward where the request came from
// -- typing "Marina Bay Sands" from Los Angeles skewed toward LA matches.
// The documented neutralizer is an explicit WORLDWIDE locationBias
// rectangle; both owner-typed search paths (the place-card 🔍 grid and the
// transportation card's manual search) now send it, while the AUTOMATIC
// searches stay untouched -- their queries embed the trip's own location
// in the text, and the local skew is what resolves a bare venue name to
// the right city.
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

assert(/const TRIPSY_WORLDWIDE_LOCATION_BIAS = \{\s*\n\s*rectangle: \{ low: \{ latitude: -90, longitude: -180 \}, high: \{ latitude: 90, longitude: 180 \} \},/.test(html),
  'the worldwide rectangle covers the whole globe -- the documented way to neutralize IP biasing');

// ---- executed: the shared candidates fetcher sends the bias ONLY when asked ----
(async () => {
  const src = extractFn('tripsyGatherPhotoCandidatesForQueries');
  if (!src) { assert(false, 'could not extract tripsyGatherPhotoCandidatesForQueries'); return; }
  const bodies = [];
  const fn = new Function('bodies', `
    const TRIPSY_WORLDWIDE_LOCATION_BIAS = { rectangle: { low: { latitude: -90, longitude: -180 }, high: { latitude: 90, longitude: 180 } } };
    const fetch = async (url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ places: [] }) }; };
    ${src}
    return tripsyGatherPhotoCandidatesForQueries;
  `)(bodies);
  await fn('key', ['marina bay sands'], { worldwide: true });
  await fn('key', ['four seasons bangkok hotel']);
  assert(bodies.length === 2
    && !!bodies[0].locationBias && bodies[0].locationBias.rectangle.high.latitude === 90,
    'THE ASK: an owner-typed query goes out with the worldwide bias -- no geographic restriction on the search');
  assert(bodies[1].locationBias === undefined,
    'an automatic (variant-built) query stays exactly as before -- its location lives in the query text');
})();

// ---- wiring: both manual entry points ----
assert(/tripsyGatherPhotoCandidatesForQueries\(apiKey, \[query\], \{ worldwide: true \}\)/.test(extractFn('tripsyGatherPlacePhotoThumbnailsForQuery')),
  'the place-card 🔍 manual search passes worldwide: true');
assert(/locationBias: TRIPSY_WORLDWIDE_LOCATION_BIAS/.test(extractFn('tripsyManualSearchTransportationPhoto')),
  'the transportation card’s manual search sends the same worldwide bias');
// The automatic candidate gatherers must NOT have picked it up.
assert(!/worldwide: true/.test(extractFn('tripsyGatherPlacePhotoCandidates') || '')
  && !/worldwide: true/.test(extractFn('tripsyFindFirstPlacePhotoName') || ''),
  'automatic photo searches are untouched (their local skew is deliberate)');
