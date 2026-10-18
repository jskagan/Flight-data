// "On the travel view, show the attire option on the header. If the user selects it show
// two options: today's outfit and laundry. If the user selects today's outfit, show the
// outfits selected for that day. If he selects laundry, open the page for doing laundry
// that day" (2026-10-18). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};

// ---- the pure day lookup ----
const blocksFor = new Function(fnSource('tripsyTodayOutfitBlocks') + '\nreturn tripsyTodayOutfitBlocks;')();
{
  const outfits = { blocks: [
    { dayKey: '2026-10-18', category: 'casual', label: 'Morning', garmentIds: ['g1'], eventIds: ['e1'] },
    { dayKey: '2026-10-18', category: 'formal', label: 'Gala', garmentIds: ['g2', 'g3'], eventIds: ['e2', 'e3'] },
    { dayKey: '2026-10-18', category: 'casual', label: 'empty', garmentIds: [], eventIds: ['e4'] },
    { dayKey: '2026-10-18', category: 'casual', label: 'no events', garmentIds: ['g9'], eventIds: [] },
    { dayKey: '2026-10-19', category: 'casual', label: 'Tomorrow', garmentIds: ['g1'], eventIds: ['e5'] },
  ] };
  const got = blocksFor(outfits, '2026-10-18');
  assert(got.map(b => b.label).join(',') === 'Morning,Gala', 'THE ASK: the outfits composed for THAT day, in order; empty and event-less blocks are not outfits');
  assert(blocksFor(outfits, '2026-10-20').length === 0 && blocksFor(null, '2026-10-18').length === 0 && blocksFor(outfits, null).length === 0, 'no outfits -> empty');
}
// ---- the header and its menu ----
const tv = fnSource('renderTravelView');
assert(/\(tvHasAttire \|\| tvHasOutfits\) \? `<button class="tv-iconbtn[^`]*id="tv-attire-btn" title="Attire — today's outfit, laundry">👔<\/button>`/.test(tv),
  'THE ASK: the 👔 Attire option sits on the Travel View header (with a guide or composed outfits)');
assert(/const tvHasOutfits = tvOutfitEventsByPerson\.him\.size > 0 \|\| tvOutfitEventsByPerson\.her\.size > 0;/.test(tv), 'composed outfits alone are enough to show it');
const todayAt = tv.indexOf("menuRow('data-tv-attire-today', '👔', \"Today's Outfit\"");
const laundryAt = tv.indexOf("menuRow('data-tv-attire-laundry', '🧺', 'Laundry'");
assert(todayAt > 0 && laundryAt > todayAt, "THE ASK: selecting it offers Today's Outfit and Laundry, in that order");
assert(/menuRow\('data-tv-attire-mode'/.test(tv) && tv.indexOf("menuRow('data-tv-attire-mode'") > laundryAt, 'the older colour-by-dress-code overlay is a third toggle row below a divider, no longer the tap itself');
assert(/if \(main\.querySelector\('#tv-attire-menu'\)\) \{ closeAttireMenu\(\); return; \}\n\s*openAttireMenu\(mainMenuHtml\(\)\);/.test(tv), 'a tap opens the menu (a second tap closes it) instead of toggling the colour mode');
// ---- Today's Outfit ----
assert(/tripsyTodayOutfitBlocks\(await Store\.getTripsyTripOutfits\(trip\.key, person\), todayKey\)/.test(tv), "Today's Outfit reads the composed outfits for the TRIP's today (todayKey, the trip-local day)");
assert(/if \(blocks\.length === 1\) \{ open\(blocks\[0\]\); return; \}/.test(tv) && /showTripsyOutfitModal\(trip\.key, b\.eventIds\[0\], person\)/.test(tv), 'one outfit today opens straight into the outfit view');
assert(/data-tv-attire-block="\$\{i\}"/.test(tv), 'several outfits today (an outfit change) are offered as a pick');
assert(/toast\(`No outfit has been composed for \$\{person === 'her' \? 'her' : 'him'\} today\.`\)/.test(tv), 'no outfit today says so');
// ---- Laundry ----
assert(/showTripsyLaundryDay\(trip\.key, todayKey, person\)/.test(tv), "THE ASK: Laundry opens the Daily Dress Guide's laundry screen for today");
assert(/const tvTripInProgress = !!\(eventsFirstDay && eventsLastDay && todayKey >= eventsFirstDay && todayKey <= eventsLastDay\);/.test(tv)
  && /if \(!tvTripInProgress\) \{ toast\('The trip is not in progress — there is no outfit for today\.'\); return; \}/.test(tv)
  && /if \(!tvTripInProgress\) \{ toast\('The trip is not in progress — nothing has been worn yet\.'\); return; \}/.test(tv),
  'outside the trip both options explain instead of opening an empty screen');
assert(/const tvPersonForAttire = async \(\) => \{[\s\S]*?tripsyChooseOutfitPersonDialog\('him'\); tripsySetTvOutfitPerson\(p\);/.test(tv), 'His/Hers is asked once and remembered, as the colour mode already did');
