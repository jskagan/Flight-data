const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
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

// ---- today is the TRIP's today, shared by the graying and the scroll ----
const impl = html.slice(html.indexOf('const tlTodayKey = tripsyTravelViewTodayKey'), html.indexOf('const tlTodayKey = tripsyTravelViewTodayKey') + 900);
assert(/tripsyTravelViewTodayKey\(trip,/.test(impl),
  'today comes from the timezone-aware helper, not the device date');
assert(/g\.dayKey < tlTodayKey\) \? ' tripsy-day-past'/.test(impl), 'days before it are dimmed');
assert(/data-tripsy-today-day="\$\{esc\(trip\.key\)\}"/.test(impl), 'and today itself is marked for the scroll');
assert(!/g\.dayKey > tlTodayKey/.test(impl), 'future days get no class at all -- they are the default state');
// One pass drives both, so the dimming and the jump can never disagree.
assert((impl.match(/tlTodayKey/g) || []).length >= 3, 'both behaviours read the SAME computed key');

// ---- dimming is visual only ----
const css = (html.match(/\.tripsy-day-past \{[^}]*\}/) || [''])[0];
assert(/opacity: 0\.45/.test(css), 'a past day is dimmed, not hidden -> ' + css);
assert(!/display: none/.test(css), 'its events stay in the page');
assert(/\.tripsy-day-past:hover[^{]*\{ opacity: 1; \}/.test(html), 'and come back on hover');

// ---- the scroll ----
const fn = extractFn('tripsyScrollMyTripsToToday');
assert(/if \(_tripsyMyTripsScrolledToToday\) return;/.test(fn),
  'it fires once per visit, so a background re-render cannot yank you back');
assert(/if \(!target\) return;/.test(fn) && /no trip is in progress/.test(fn),
  'a trip that has not started (or is over) leaves the page where it opened');
assert(/window\.scrollY \+ el\.getBoundingClientRect\(\)\.top/.test(fn),
  'it scrolls to an ABSOLUTE position, not by a relative delta');
assert(/\[120, 350, 800\]\.forEach/.test(fn) && /requestAnimationFrame/.test(fn),
  'and re-runs, since cards grow as photos and weather arrive');
assert(/const el = document\.querySelector\('\[data-tripsy-today-day\]'\)/.test(fn),
  'each pass re-queries the target, which a re-render may have replaced');
assert(/Math\.max\(0, y\)/.test(fn), 'and never asks for a negative scroll position');
// The latch has to be re-armed when the page is entered afresh.
assert(/resetTripsyMyTripsTodayScroll\(\); \/\/ a fresh visit/.test(html), 'navigating to My Trips re-arms it');
assert(/run\.then\(\(\) => tripsyScrollMyTripsToToday\(\)\)/.test(html), 'and it runs after the render, not before');

// ---- the Daily Dress Guide gets the same treatment ----
// Slice to the END of the day loop, not a fixed character budget -- these lines are long
// and a fixed window stopped short of the markup it was meant to check.
const dgStart = html.indexOf('const dgDayKeys = ');
const dg = html.slice(dgStart, html.indexOf('const filterNoteHtml = filterOn', dgStart));
assert(/tripsyTravelViewTodayKey\(dgTrip,/.test(dg), 'the guide uses the same timezone-aware today');
assert(/dgDayKeys\[0\] \|\| null, dgDayKeys\[dgDayKeys\.length - 1\] \|\| null/.test(dg),
  'bounded by the guide\'s own first and last day');
assert(/const dgPast = dgTodayKey && day\.dayKey < dgTodayKey/.test(dg), 'past days are flagged');
assert(/dgPast \? ' tripsy-attire-day-past' : ''/.test(dg), 'and dimmed via their own class');
assert(/day\.dayKey === dgTodayKey \? ' data-tripsy-dg-today' : ''/.test(dg), 'today is marked for the scroll');
assert(/\.tripsy-attire-day-past \{ opacity: 0\.45/.test(html), 'dimmed, not hidden');
assert(/\.tripsy-attire-day-past:hover[^{]*\{ opacity: 1; \}/.test(html), 'and lifts on hover');
// A guide for a trip that isn't loaded must not blow up.
assert(/const dgTodayKey = dgTrip\s*\n?\s*\? tripsyTravelViewTodayKey/.test(dg),
  'a guide whose trip is not loaded simply has no today');

// The scrolling itself now lives in the shared target function; ScrollToToday is a
// one-line delegator, so assert against the implementation rather than the wrapper.
const dgScroll = extractFn('tripsyDressGuideScrollToTarget');
assert(/overlay\.scrollTop \+ el\.getBoundingClientRect\(\)\.top - overlay\.getBoundingClientRect\(\)\.top/.test(dgScroll),
  'it scrolls the OVERLAY, which is what has the overflow here -- not the window');
assert(/if \(!el\) return;/.test(dgScroll), 'no today means the guide opens at the top, unchanged');
assert(/\[120, 350, 800\]\.forEach/.test(dgScroll), 'and re-runs as weather chips change the height above it');
assert(/Math\.max\(0, y\)/.test(dgScroll), 'never asking for a negative position');
// A deliberate jump to one event (the trip back from My Trips) must win over the default.
assert(/if \(scrollToEventId\) tripsyAttireScrollToEventRow\(scrollToEventId\);/.test(html),
  'an explicit event destination beats the open-on-today default');

// ---- 👔 on a My Trips day header opens the guide at that date ----
const hdr = html.slice(html.indexOf('const dgGlyphHtml ='), html.indexOf('const dgGlyphHtml =') + 1400);
assert(/tripsyAttireGuides \|\| \[\]\)\.some\(g => g\.tripKey === trip\.key\)/.test(hdr),
  'the glyph only appears when the trip HAS a guide -- otherwise it would open an empty page');
assert(/data-tripsy-day-attire="\$\{esc\(dayKey\)\}"/.test(hdr), 'and carries the day it belongs to');
assert(/\$\{dayNumHtml\}\$\{dgGlyphHtml\}/.test(html), 'it sits immediately right of the Day N indicator');
// The Attire page's own day bar is a deliberate copy of this header and must NOT get one.
const attireBar = extractFn('tripsyAttireDayBarHtml');
assert(!/dgGlyphHtml|data-tripsy-day-attire/.test(attireBar),
  'the Attire day bar, a copy of this header, is left alone');
const wiring = html.slice(html.indexOf('[data-tripsy-day-attire]'), html.indexOf('[data-tripsy-day-attire]') + 500);
assert(/e\.stopPropagation\(\)/.test(wiring), 'clicking it does not trigger the timeline row beneath');
assert(/showTripsyDailyDressGuide\(btn\.dataset\.tripKey, null, btn\.getAttribute\('data-tripsy-day-attire'\)\)/.test(wiring),
  'and opens the guide at that day');
// Every day is addressable, not just today.
assert(/data-tripsy-dg-day="\$\{esc\(day\.dayKey\)\}"/.test(html), 'each guide day section is addressable');
const toDay = extractFn('tripsyDressGuideScrollToDay');
assert(/CSS\.escape\(dayKey\)/.test(toDay), 'the day key is escaped into the selector');
const target = extractFn('tripsyDressGuideScrollToTarget');
assert(/if \(flash && !flashed\)/.test(target),
  'the arrival flash fires ONCE, not on each retry pass, which would blink');
assert(/el\.firstElementChild \|\| el/.test(target), 'and flashes the day bar itself, not the whole section');
// Priority: a specific event still beats a day, which beats today.
assert(/if \(scrollToEventId\)[\s\S]{0,120}else if \(scrollToDayKey\)[\s\S]{0,80}else tripsyDressGuideScrollToToday\(\)/.test(html),
  'event beats day beats today');

// ---- "Do Laundry Today" ----
assert(/data-tripsy-laundry-day="\$\{esc\(day\.dayKey\)\}"/.test(html), 'the button carries its day');
const lb = html.slice(html.indexOf('const laundryRow = '), html.indexOf('const laundryRow = ') + 600);
assert(/i === 0 && isOwner/.test(lb),
  'only after the day\'s FIRST instruction box, and only for the owner');
// It is OUTSIDE the instruction bar now: its own row, appended after whichever shape of
// bar was emitted, so neither variant contains it.
assert(/class="tripsy-dg-laundry-row"/.test(lb), 'the button gets its own row');
assert(/\)\) \+ laundryRow;/.test(html), 'which follows the bar rather than sitting inside it');
assert(!/\$\{leadInText\}\$\{laundry/.test(html), 'the plain bar no longer carries it');
assert(!/See outfit<\/span>\$\{laundry/.test(html), 'nor does the outfit-linked one');
assert(!/dressguide-instruction--wide/.test(html),
  'so the stretch-the-bar variant is gone with it');
// Nothing above it is a tap target now, but a bubble would still reach the outfit bar's
// handler on the way up, so the guard stays.
const lw = html.slice(html.indexOf("[data-tripsy-laundry-day]"), html.indexOf("[data-tripsy-laundry-day]") + 520);
assert(/e\.stopPropagation\(\)/.test(lw), 'tapping it does not open a block outfit behind it');
assert(/showTripsyLaundryDay\(guide\.tripKey, el\.getAttribute\('data-tripsy-laundry-day'\), person\)/.test(lw),
  'and it opens that day for the person being shown');
assert(/\.tripsy-attire-dressguide-instruction \{[^}]*display: inline-flex/.test(html),
  'every instruction bar hugs its text as a compact pill again');
const rowCss = (html.match(/\.tripsy-dg-laundry-row \{[^}]*\}/) || [''])[0];
assert(/justify-content: flex-end/.test(rowCss),
  'the row puts the button flush right -> ' + rowCss.slice(0, 70));
const btnCss = (html.match(/\.tripsy-dg-laundry-btn \{[^}]*\}/) || [''])[0];
assert(!/margin-left: auto/.test(btnCss),
  'the button no longer pushes itself right -- its row does that');
assert(/var\(--amber\)/.test(btnCss) && /rgba\(227,164,56/.test(btnCss),
  'and it is still coloured to pair with the bar above it');
// The overlay itself.
const lo = extractFn('showTripsyLaundryDay');
assert(/tw-photo-glyph/.test(lo) && /tripsyGarmentGlyph/.test(lo),
  'a garment with no photo falls back to its glyph');
assert(/data-tw-photo="\$\{esc\(it\.driveFileId\)\}"/.test(lo), 'and one with a photo shows it');
assert(/tripsyWardrobeLoadPhotos\(body\)/.test(lo), 'photos are painted from Drive');
assert(/if \(!ov\.contains\(body\)\) return;/.test(lo), 'closing it mid-computation does not then overwrite it');
assert(/Nothing needs washing today/.test(lo), 'and an empty result explains itself');

// ---- the Laundry Bag ----
assert(/const remaining = it => it\.count - \(inBag\.get\(it\.key\) \|\| 0\)/.test(lo),
  'what is still dirty is the count MINUS what is already in the bag');
assert(/const dirty = items\.filter\(it => remaining\(it\) > 0\)/.test(lo),
  'a garment fully in the bag drops off the grid');
assert(/remaining\(it\) > 1 \?/.test(lo), 'and a partly-bagged one shows its reduced count');
assert(/Laundry Bag/.test(lo), 'the bag has its own card');
assert(/inBag\.get\(it\.key\) > 1 \? ` <b[^>]*>×\$\{inBag\.get\(it\.key\)\}/.test(lo),
  'a bag entry shows how many of that garment are in it');
assert(/Nothing in the bag yet/.test(lo), 'and says so while empty');
// One copy needs no dialog; several ask, so you can wash 2 of 3 and leave the third.
assert(/if \(left > 1\) \{/.test(lo) && /title: 'How many to wash\?', subtitle: 'dirty'/.test(lo),
  'several copies ask how many, in laundry wording rather than the packing dialog\'s');
assert(/if \(n == null \|\| n <= 0\) return;/.test(lo), 'cancelling that dialog changes nothing');
assert(/Math\.min\(n, left\)/.test(lo), 'and you can never bag more than are dirty');
assert(/data-laundry-unpick/.test(lo), 'anything bagged can be taken back out');

// ---- the bag survives the session, and Wash Now makes those clothes clean ----
assert(/const saved = Store\.getTripsyLaundryBag\(tripKey, person, dayKey\)/.test(lo),
  'the bag is reloaded when the day is reopened');
assert(/const persistBag = \(\) => Store\.saveTripsyLaundryBag/.test(lo), 'and written back on change');
// Exactly two call sites: putting something in, and taking it back out. (The definition
// reads `persistBag = () =>`, which is not a call, so it does not match.)
assert((lo.match(/persistBag\(\);/g) || []).length === 2,
  'persisted on both adding and removing -> ' + (lo.match(/persistBag\(\);/g) || []).length);
assert(/data-laundry-wash/.test(lo), 'the bag card has a Wash Now button');
assert(/bagged\.length \? `<button class="btn primary" data-laundry-wash/.test(lo),
  'shown only when there is something to wash');
// OPTIMISTIC writes: neither Wash Now nor Not Dirty awaits its Drive write before
// rebuilding -- the in-memory mutation is synchronous, so the screen updates at once
// and a background failure surfaces as a toast instead of dead air.
assert(!/await Store\.washTripsyLaundryBag/.test(lo), 'Wash Now does not block the rebuild on the Drive write');
assert(!/await Store\.addLaundryNotDirty/.test(lo), 'nor does Not Dirty');
assert(/washTripsyLaundryBag\(tripKey, person, dayKey\)\s*\n?\s*\.then\(ok => \{ if \(!ok\) toast\(/.test(lo),
  'a failed wash write still says so, from the background');
assert(/addLaundryNotDirty\(tripKey, person, dayKey, it\.key, Math\.min\(n, left\)\)\s*\n?\s*\.then\(ok => \{ if \(!ok\) toast\(/.test(lo),
  'and so does a failed Not Dirty write');
// The shared count dialog must sit ABOVE the laundry overlay (which raises itself
// to ...120): it opened BEHIND it once, invisibly, with the caller awaiting forever.
const qd = extractFn('tripsyWardrobeChoosePackedCount');
assert(/zIndex = '2147483200'/.test(qd), 'the count dialog outranks every caller overlay');
assert(!/const opts = Array\.from/.test(qd) && /optionsHtml/.test(qd),
  'and its option markup no longer shadows the opts parameter that carries custom wording');
assert(/opts\.title \|\| 'How many packed\?'/.test(qd), 'so a custom title actually renders');
assert(/showTripsyLaundryDay\(tripKey, dayKey, person\);/.test(lo),
  'and the screen is rebuilt from the recomputed truth, not patched in place');
// Order: the bag card comes BEFORE the garment grid.
assert(lo.indexOf('tripsy-laundry-bag') < lo.indexOf('dirty.map(cardHtml)'),
  'the Laundry Bag card renders above the grid');
// Storage semantics.
const st = html.slice(html.indexOf('  listTripsyLaundry(tripKey)'), html.indexOf('  // ---- Favorites'));
assert(/&& !r\.washedAt\) \|\| null/.test(st), 'the open bag is the unwashed record for that day');
assert(/Object\.keys\(bag \|\| \{\}\)\.length/.test(st), 'an emptied bag is removed rather than stored empty');
assert(/rec\.washedAt = new Date\(\)\.toISOString\(\)/.test(st), 'washing stamps the record');
assert(/if \(!rec \|\| !Object\.keys\(rec\.bag \|\| \{\}\)\.length\) return false;/.test(st),
  'and washing an empty bag is refused');
// The shared count dialog kept its own wording for its existing caller.
const cnt = extractFn('tripsyWardrobeChoosePackedCount');
assert(/opts\.title \|\| 'How many packed\?'/.test(cnt), 'the packing dialog is unchanged by default');

// ---- after a wash: orange advice off, red run-out on ----
const dgRender = html.slice(html.indexOf('const laundryInfo ='), html.indexOf('const filterNoteHtml = filterOn'));
assert(/const laundryReason = laundryInfo\.hasWash \? undefined : laundryByDay\.get\(day\.dayKey\)/.test(dgRender),
  'once a wash exists the orange "best day for laundry" bar is suppressed');
assert(/laundryInfo\.runOut\.get\(day\.dayKey\)/.test(dgRender), 'and a run-out day gets its own bar');
assert(/tripsy-attire-runout-note/.test(dgRender), 'in its own red style');
// One bar PER GARMENT: garments sharing a day were previously merged into one line.
assert(/runOutNames\s*\n?\s*\.map\(n => `<div class="tripsy-attire-runout-note"/.test(dgRender),
  'each garment gets its own bar rather than sharing one');
assert(!/join\('<\/b>, <b>'\)/.test(dgRender), 'and names are no longer merged into a single line');
assert(dgRender.indexOf('runOutHtml') < dgRender.indexOf('${laundryHtml}'),
  'the run-out bar renders above the (now suppressed) laundry note');
assert(/\{ runOut: new Map\(\), hasWash: false \}/.test(html),
  'a caller that supplies no projection behaves exactly as before');
// It is computed ONCE per opening, not per re-render -- it walks every garment's wear days.
assert(/renderOpts\.laundryInfo = await tripsyLaundryRunOutByDay\(tripKey, tripsyDressGuidePerson \|\| 'him', guide\)/.test(html),
  'computed once when the guide opens');
assert(/catch \(e\) \{\s*\n\s*console\.error\('Laundry run-out projection failed:'/.test(html),
  'and a failure there must not stop the guide rendering');
