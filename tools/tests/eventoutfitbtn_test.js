// A My Trips event detail card gets an "Outfit" button, bottom right of the button
// row, opening the SAME outfit view the Daily Dress Guide's "See outfit" cue opens
// (showTripsyOutfitModal) for whichever person is currently selected there. The
// Travel View event-detail overlay shares this same renderTripsyViewPanel but must
// stay unaffected -- it never passes a tripKey.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
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

const panelFn = extractFn('renderTripsyViewPanel');

// ---- signature and default: the Travel View caller must stay unaffected ----
assert(/function renderTripsyViewPanel\(panel, raw, eventSummary, onEdit, tripKey = null\)/.test(panelFn),
  'tripKey is a new 5th param, defaulting to null so callers that omit it are unaffected');
const travelCaller = html.slice(html.indexOf('function showTripsyTravelEventDetail'), html.indexOf('function showTripsyTravelEventDetail') + 2000);
assert(/renderTripsyViewPanel\(body, raw, title, null\);/.test(travelCaller),
  'Travel View still calls it with the old 4-arg shape -- no tripKey, so no Outfit button there');

// ---- My Trips caller now threads tripKey through ----
assert(/renderTripsyViewPanel\(panel, effectiveRaw, display\.summary, onEdit, found\.tripKey\);/.test(html),
  'the My Trips timeline passes found.tripKey as the 5th arg');

// ---- id-space conversion: guide/outfit ids are "resource-id" (hyphen), this raw
// event's own key everywhere else is "resource:id" (colon) -- built straight from
// raw.resource/raw.id, not by re-deriving from a key string ----
assert(/const attireEventId = \(tripKey && raw && raw\.resource && raw\.id != null\) \? `\$\{raw\.resource\}-\$\{raw\.id\}` : null;/.test(panelFn),
  'attireEventId is built in the guide\'s hyphen id space, only when tripKey is present');

// ---- the button itself: bottom-right (margin-left:auto pushes it away from
// Edit/Close), conditional on having an id, opens the same modal the dress guide uses ----
assert(/data-tripsy-view-outfit style="margin-left:auto;/.test(panelFn),
  'the button sits in the same row as Edit/Close, pushed to the right');
assert(/\$\{attireEventId \? `<button class="btn" data-tripsy-view-outfit/.test(panelFn),
  'only rendered when a real attireEventId was computed (i.e. tripKey was supplied)');
assert(/showTripsyOutfitModal\(tripKey, attireEventId, tripsyDressGuidePerson\);/.test(panelFn),
  'opens showTripsyOutfitModal for whichever person the Daily Dress Guide currently has selected');
assert(/if \(attireEventId\) panel\.querySelector\("\[data-tripsy-view-outfit\]"\)\.addEventListener/.test(panelFn),
  'the click handler is only wired when the button was actually rendered');

// ---- executed: the id-space conversion itself, against fixtures ----
{
  const build = (tripKey, raw) => (tripKey && raw && raw.resource && raw.id != null) ? `${raw.resource}-${raw.id}` : null;
  assert(build('tripsy-1', { resource: 'activity', id: 12345 }) === 'activity-12345',
    'activity converts to hyphen form');
  assert(build('tripsy-1', { resource: 'hosting', id: 99 }) === 'hosting-99',
    'hosting converts too');
  assert(build(null, { resource: 'activity', id: 1 }) === null, 'no tripKey -> no button (Travel View path)');
  assert(build('tripsy-1', { resource: 'activity', id: 0 }) === 'activity-0',
    'an id of 0 is falsy but must still build -- the != null check, not truthiness, guards this');
  assert(build('tripsy-1', null) === null, 'a missing raw is handled without throwing');
}
