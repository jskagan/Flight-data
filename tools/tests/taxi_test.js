// Taxi: a transportation type with its own yellow NYC checker-cab glyph, offered as a
// one-tap option on every missing leg in Verify Travel Details ("For missing transportation
// events, add an option to take a taxi. If the user selects that option, use a glyph for a
// yellow NYC cab with a checkerboard design on it," 2026-10-22). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) return null;
  let d = 0;
  for (let k = html.indexOf('{', i); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
const constDecl = n => {
  const i = html.indexOf('const ' + n + ' =');
  let k = i, d = 0;
  for (; ; k++) {
    const c = html[k];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) break;
  }
  return html.slice(i, k + 1).replace(/^const /, 'var ');
};
(0, eval)([
  'var esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]));',
  'var TRIPSY_BIKE_PHOTO_B64 = "BIKE";',
  'var TRIPSY_TIMELINE_TYPE_ICON = {}; var tripsyIsBarEvent = () => false; var tripsyIsTheaterEvent = () => false;',
  ...['TRIPSY_TRANSPORTATION_TYPES', 'TRIPSY_TRANSPORTATION_TYPE_ICON', 'TRIPSY_TRANSPORTATION_TYPE_COLOR', 'TRIPSY_BIKE_ICON_MARKER',
    'TRIPSY_TAXI_ICON_MARKER', 'TRIPSY_TAXI_GLYPH_SVG', 'TRIPSY_TAXI_GLYPH_URL'].map(constDecl),
  extractFn('tripsyDotGlyphHtml'), extractFn('tripsyTimelineDotIcon'),
].join('\n'));

assert(TRIPSY_TRANSPORTATION_TYPES.includes('taxi') && TRIPSY_TRANSPORTATION_TYPE_ICON.taxi === '🚕' && !!TRIPSY_TRANSPORTATION_TYPE_COLOR.taxi,
  'Taxi is a transportation type (Type menu, 🚕 header label, its own dot colour)');
assert(/<pattern id="ck"/.test(TRIPSY_TAXI_GLYPH_SVG) && /fill="url\(#ck\)"/.test(TRIPSY_TAXI_GLYPH_SVG)
  && /#FFC20E/.test(TRIPSY_TAXI_GLYPH_SVG) && /#111/.test(TRIPSY_TAXI_GLYPH_SVG) && /#fff/.test(TRIPSY_TAXI_GLYPH_SVG),
  'the glyph is a yellow cab with a black-and-white checkerboard band');
assert(TRIPSY_TAXI_GLYPH_URL.startsWith('data:image/svg+xml,') && decodeURIComponent(TRIPSY_TAXI_GLYPH_URL.slice(19)) === TRIPSY_TAXI_GLYPH_SVG,
  'the glyph is embedded as an SVG data URL (no external file)');
const taxiEv = { tripsyRaw: { resource: 'transportation', category: 'taxi' } };
assert(tripsyTimelineDotIcon(taxiEv) === TRIPSY_TAXI_ICON_MARKER, 'a taxi leg\'s dot icon is the taxi marker');
assert(tripsyDotGlyphHtml(TRIPSY_TAXI_ICON_MARKER, 24).includes(TRIPSY_TAXI_GLYPH_URL), 'the marker draws as the checker-cab picture');
assert(tripsyDotGlyphHtml('🚗') === '🚗' && /BIKE/.test(tripsyDotGlyphHtml(TRIPSY_BIKE_ICON_MARKER)),
  'emoji stay text; the bike marker draws its photo instead of the raw marker string');
assert(!/esc\(tripsyTimelineDotIcon\(ev\)\)/.test(html) && /tv-icon" style="background:\$\{bg\};">\$\{tripsyDotGlyphHtml\(glyph, 22\)\}/.test(html)
  && (html.match(/tripsyDotGlyphHtml\(tripsyTimelineDotIcon\(ev\), 64\)/g) || []).length === 2,
  'Travel View and the itinerary card fallbacks draw dot glyphs through tripsyDotGlyphHtml');
assert(/dotGlyph === TRIPSY_TAXI_ICON_MARKER\s*\?\s*tripsyDotGlyphHtml\(dotGlyph, 24\)/.test(extractFn('tripsyTimelineRowHtml')),
  'the My Trips timeline dot shows the cab');

// Verify Travel Details: a Taxi button beside every missing leg opens the prefilled form as a taxi.
const dlg = extractFn('showTripsyVerifyTravelDialog');
assert(/data-tvv-taxi data-tvv-idx="\$\{missingMoves\.indexOf\(m\)\}"/.test(dlg) && /src="\$\{TRIPSY_TAXI_GLYPH_URL\}"/.test(dlg),
  'each missing leg has a Taxi button showing the cab');
assert(/isWarning \? `[\s\S]*data-tvv-taxi[\s\S]*` : moveRowButton\(m, third, thirdColor, false\)/.test(dlg),
  'only MISSING legs get the Taxi option');
assert(/querySelectorAll\('\[data-tvv-taxi\]'\)[\s\S]{0,400}category: 'taxi'[\s\S]{0,40}label: 'Taxi'/.test(dlg),
  'tapping Taxi opens the itinerary-prefilled form with Type = Taxi');
assert(/label = gap\.label \|\| 'Transportation';/.test(extractFn('openTripsyVerifyGapEdit')), 'the form is headed Taxi');

// Itinerary: a taxi is treated like a car (no generated write-up) and its card shows the cab, no photo search.
assert((html.match(/raw\.category === 'airplane' \|\| raw\.category === 'car' \|\| raw\.category === 'taxi'/g) || []).length === 4,
  'every no-write-up rule for cars covers taxis too');
assert(/const isTaxi = category === 'taxi';\s*let photoDataUrl = \(isSkipped \|\| isTaxi\) \? null/.test(html)
  && /isTaxi \? `[\s\S]{0,200}TRIPSY_TAXI_GLYPH_URL/.test(html),
  'a taxi itinerary card shows the cab and never searches Places for a photo');

// The edit form hides Seat and Travel Agent for a taxi ("For a taxi event, there is no need
// to have fields for travel agent or seat," 2026-10-22), tracking the Type select.
const ep = extractFn('renderTripsyEditPanel');
assert(/const TRIPSY_TAXI_HIDDEN_EDIT_GROUPS = \['seat', 'travelAgent'\];/.test(html), 'the hidden sections are Seat and Travel Agent');
assert(/data-tripsy-edit-group="\$\{esc\(group\)\}"/.test(ep), 'every edit-form section is addressable by its group');
assert(/TRIPSY_NO_SEAT_OR_AGENT_TYPES\.includes\(categorySelect\.value\)[\s\S]{0,200}sec\.style\.display = isTaxi \? 'none' : ''/.test(ep)
  && /categorySelect\.addEventListener\('change', refreshTaxiSections\);\s*refreshTaxiSections\(\);/.test(ep),
  'the sections hide while Type is Taxi, on open and on every Type change');

// Walk gets the same (same day), and the unsaved-changes question opens ABOVE every form:
// on the Verify Travel Details form (z 10003) it used to open at 10002, behind it, so
// Cancel looked dead ("I hit the cancel button, nothing happened and the page stayed visible").
assert(/const TRIPSY_NO_SEAT_OR_AGENT_TYPES = \['taxi', 'walk'\];/.test(html), 'a walk also hides Seat and Travel Agent');
const discard = extractFn('tripsyConfirmDiscardChanges');
const z = Number((discard.match(/z-index:(\d+)/) || [])[1]);
assert(z > 10003 && z > 2147483000, `the discard question sits above the Verify form and other overlays (z ${z})`);
