// "Add an attire glyph to each event on the my trips page for which an outfit has been
// generated. When the user selects it, display the selected outfit for that event."
// tripsyOutfitEventPersonsMap reads driveData.tripsyTripOutfits (synchronously, since
// the My Trips card builder itself is not async) into eventId -> Set(persons with a
// real composed outfit covering it); the timeline row builder uses that to render a
// 👔 button (only when an outfit actually exists -- unlike the always-shown "Outfit"
// button already inside the read-only detail panel), available to every viewer since
// it's read-only info, same as that panel's own button. Tapping it opens the exact
// same showTripsyOutfitModal the rest of the app's outfit views use.
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

// ---- source-pattern checks ----
const mapFn = extractFn('tripsyOutfitEventPersonsMap');
assert(mapFn.includes("if (o.tripKey !== tripKey) continue;"), 'sanity: extracted the real map-building function');
assert(/if \(!\(b\.garmentIds \|\| \[\]\)\.length\) continue;/.test(mapFn),
  'an outfit block composed with nothing in it (gaps only) is skipped -- no glyph for an empty block');
assert(/map\.get\(id\)\.add\(person\);/.test(mapFn), 'each event accumulates every PERSON who has a real outfit covering it, not just a boolean');

assert(/const outfitEventPersons = tripsyOutfitEventPersonsMap\(trip\.key\);/.test(html),
  'wired into the My Trips card builder, once per trip');
assert(/const outfitPersons = outfitEventPersons\.get\(ev\.id\);/.test(html),
  'looked up per event by its own id (same id space blocks.eventIds already uses)');
assert(/const outfitGlyphHtml = outfitPersons && outfitPersons\.size\s*\n\s*\? `<button class="btn" data-tripsy-outfit-glyph data-trip-key="\$\{esc\(trip\.key\)\}" data-event-id="\$\{esc\(ev\.id\)\}" data-persons="\$\{esc\(\[\.\.\.outfitPersons\]\.join\(','\)\)\}" style="font-size:17px; padding:4px 10px;" title="View outfit">👔<\/button>`\s*\n\s*: '';/.test(html),
  'THE ASK: the glyph renders only when an outfit actually covers this event');

// THE ASK, explicitly: available to every viewer, not gated behind edit/delete access
// like the icons next to it.
assert(/const actionsHtml = \(outfitGlyphHtml \|\| ownerIconsHtml\)\s*\n\s*\? `<div style="display:flex; gap:6px; flex-shrink:0;">\$\{outfitGlyphHtml\}\$\{ownerIconsHtml\}<\/div>`\s*\n\s*: '';/.test(html),
  'the glyph is NOT behind the canEditDelete gate that hides ownerIconsHtml for a non-owner viewer');

// ---- wiring: tapping opens the SAME outfit modal, choosing the right person ----
const wireBlock = html.slice(html.indexOf('container.querySelectorAll("[data-tripsy-outfit-glyph]")'), html.indexOf('container.querySelectorAll("[data-tripsy-delete-attachment]")'));
assert(wireBlock.includes('showTripsyOutfitModal(tripKey, eventId, person);'), 'opens the standard outfit modal');
assert(/const person = persons\.includes\(tripsyDressGuidePerson\) \? tripsyDressGuidePerson : \(persons\[0\] \|\| 'him'\);/.test(wireBlock),
  'prefers the currently-selected Daily Dress Guide person when they have an outfit for this event, else falls back to whoever does');

// ---- executed: the map-building logic itself, against fixtures ----
(async () => {
  eval(mapFn.replace(/^function tripsyOutfitEventPersonsMap/, 'var tripsyOutfitEventPersonsMap = function'));
  const driveData = {
    tripsyTripOutfits: [
      { tripKey: 'T1', person: 'him', blocks: [
        { eventIds: ['e1', 'e2'], garmentIds: ['g1', 'g2'] },
        { eventIds: ['e3'], garmentIds: [] }, // composed with nothing -- must not count
      ] },
      { tripKey: 'T1', person: 'her', blocks: [
        { eventIds: ['e2'], garmentIds: ['g3'] }, // e2 has an outfit for BOTH people
      ] },
      { tripKey: 'T2', person: 'him', blocks: [{ eventIds: ['e9'], garmentIds: ['g9'] }] }, // a different trip
    ],
  };
  const map = tripsyOutfitEventPersonsMap('T1');
  assert([...map.get('e1')].join(',') === 'him', "e1 has an outfit for 'him' only -> " + JSON.stringify([...(map.get('e1') || [])]));
  assert([...map.get('e2')].sort().join(',') === 'her,him', "e2 has an outfit for BOTH -> " + JSON.stringify([...(map.get('e2') || [])].sort()));
  assert(!map.has('e3'), 'THE ASK: an empty-garments block gives its events no glyph at all');
  assert(!map.has('e9'), "another trip's outfits don't leak in");
})();
