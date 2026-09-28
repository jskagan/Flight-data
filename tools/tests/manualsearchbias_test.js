// "When the user manually inputs a search term for a photo from the
// itinerary page, do not use a geographic restriction on the search"
// (2026-09-28). With neither locationBias nor locationRestriction, Places'
// searchText silently IP-BIASES results toward where the request came from.
// There is no direct "no bias" switch, and the first attempt -- a single
// worldwide rectangle -- was REJECTED live: Places 400s any rectangle wider
// than 180° ("Invalid rectangle viewport"), which made every manual search
// silently find nothing ("When I hit the search button after typing in
// manual search for photos nothing happened", same day). The accepted
// neutralizer, verified against the live API: run the query once per
// HEMISPHERE (two exactly-180°-wide soft biases) and merge. Automatic
// searches stay untouched -- their queries embed the trip's own location
// in the text, and that local skew is deliberate.
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

// ---- THE 400 LESSON: no bias rectangle may be wider than 180° ----
const biasesSrc = (html.match(/const TRIPSY_UNBIASED_LOCATION_BIASES = \[[\s\S]*?\n\];/) || [null])[0];
assert(!!biasesSrc, 'the hemisphere bias pair exists');
const biases = biasesSrc ? new Function(`${biasesSrc} return TRIPSY_UNBIASED_LOCATION_BIASES;`)() : [];
assert(biases.length === 2
  && biases.every(b => (b.rectangle.high.longitude - b.rectangle.low.longitude) <= 180)
  && biases[0].rectangle.low.longitude === -180 && biases[0].rectangle.high.longitude === 0
  && biases[1].rectangle.low.longitude === 0 && biases[1].rectangle.high.longitude === 180,
  'two hemisphere rectangles, each EXACTLY 180° wide (a wider one is 400-rejected live), covering the globe together');
assert(!/TRIPSY_WORLDWIDE_LOCATION_BIAS/.test(html),
  'the rejected single worldwide rectangle is gone -- it made every manual search silently fail');

// ---- executed: the shared candidates fetcher fans out per hemisphere when asked ----
(async () => {
  const src = extractFn('tripsyGatherPhotoCandidatesForQueries');
  if (!src) { assert(false, 'could not extract tripsyGatherPhotoCandidatesForQueries'); return; }
  const bodies = [];
  const fn = new Function('bodies', `
    ${biasesSrc}
    const fetch = async (url, opts) => {
      const b = JSON.parse(opts.body);
      bodies.push(b);
      // One distinct photo per hemisphere, plus one shared across both, so
      // the merge/dedup is exercised.
      const east = b.locationBias && b.locationBias.rectangle.low.longitude === 0;
      return { ok: true, json: async () => ({ places: [{ photos: [{ name: 'shared' }, { name: east ? 'east-only' : 'west-only' }] }] }) };
    };
    ${src}
    return tripsyGatherPhotoCandidatesForQueries;
  `)(bodies);
  const manual = await fn('key', ['marina bay sands'], { worldwide: true });
  assert(bodies.length === 2
    && bodies.every(b => b.locationBias && (b.locationBias.rectangle.high.longitude - b.locationBias.rectangle.low.longitude) <= 180),
    'THE ASK: an owner-typed query fans out to one request per hemisphere -- no geographic restriction, in a shape the API accepts');
  assert(manual.length === 3 && manual.includes('west-only') && manual.includes('east-only') && manual.filter(n => n === 'shared').length === 1,
    'both hemispheres’ candidates merge, deduped');
  bodies.length = 0;
  await fn('key', ['four seasons bangkok hotel']);
  assert(bodies.length === 1 && bodies[0].locationBias === undefined,
    'an automatic (variant-built) query stays exactly as before -- one request, its location in the query text');
})();

// ---- wiring: both manual entry points ----
assert(/tripsyGatherPhotoCandidatesForQueries\(apiKey, \[query\], \{ worldwide: true \}\)/.test(extractFn('tripsyGatherPlacePhotoThumbnailsForQuery')),
  'the place-card 🔍 manual search passes worldwide: true');
assert(/for \(const bias of TRIPSY_UNBIASED_LOCATION_BIASES\)/.test(extractFn('tripsyManualSearchTransportationPhoto')),
  'the transportation card’s manual search runs the same per-hemisphere fan-out');
assert(!/worldwide: true/.test(extractFn('tripsyGatherPlacePhotoCandidates') || '')
  && !/worldwide: true/.test(extractFn('tripsyFindFirstPlacePhotoName') || ''),
  'automatic photo searches are untouched (their local skew is deliberate)');
