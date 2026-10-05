// "The first step in the attire flow should be to determine which events fall into which
// categories of dress … when the user first presses the attire button before the guide has
// been generated, the user should see a dialog box that asks if the itinerary is complete …
// At that point, it should be the only option under the attire menu" (2026-10-05).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  const m = html.match(new RegExp(`\\n(async function ${name}\\(|function ${name}\\()`));
  const start = m.index + 1;
  let i = html.indexOf('{', html.indexOf(')', start)), depth = 0;
  for (; i < html.length; i++) { if (html[i] === '{') depth++; else if (html[i] === '}' && --depth === 0) break; }
  return html.slice(start, i + 1);
}
eval(extractFn('tripsyAttireGuideIsDressOnly'));
assert(tripsyAttireGuideIsDressOnly({ dressOnly: true }) === true, 'a dress-codes-only guide is recognized');
assert(tripsyAttireGuideIsDressOnly({ personGuidance: null }) === false && tripsyAttireGuideIsDressOnly(null) === false,
  'only the explicit flag counts -- an older full guide is never mistaken for one');

const gen = extractFn('generateTripsyAttireGuide');
assert(/async function generateTripsyAttireGuide\(tripKey, \{ onStage, dressOnly \} = \{\}\)/.test(gen), 'the generator takes a dressOnly stage');
assert(/const dressOnlyMode = dressOnly != null \? !!dressOnly : !!\(existing && tripsyAttireGuideIsDressOnly\(existing\)\);/.test(gen),
  'unspecified, a refresh keeps the saved guide at its stage');
assert(/if \(dressOnlyMode\) return null; \/\/ dress codes first/.test(gen), 'dress-codes-only never runs the packing guidance call');
assert(/dressOnly: dressOnlyMode \|\| undefined,/.test(gen), 'the saved guide is stamped with its stage');
assert(gen.indexOf("generateTripsyAttireCategories(effectiveTrip, currentEventsForPrompt, weatherByDay, { eventsOnly: true })") > 0,
  'the dress codes still come from the events categorization call');

const run = extractFn('runTripsyAttireGeneration');
assert(/generateTripsyAttireGuide\(tripKey, \{ onStage, dressOnly: opts\.dressOnly \}\)/.test(run), 'the run passes the stage through');
const dressBranch = run.slice(run.indexOf('if (tripsyAttireGuideIsDressOnly(guide)) {'));
assert(/showTripsyDailyDressGuide\(tripKey\)/.test(dressBranch.slice(0, 600)) && dressBranch.indexOf('return;') < dressBranch.indexOf('showTripsyAttireReviewDialog'),
  'THE ASK: after building, the suggestions are presented in the Daily Dress Guide (not the summary/review dialog)');

assert(/const attireMenuItems = attireDressOnly\s*\n\s*\? menuListButtonHtml\(`data-tripsy-attire-nav="dressguide"[^\n]*'Daily Dress Guide'\)\s*\n\s*: \[/.test(html),
  'THE ASK: once built, the Daily Dress Guide is the only attire menu option');

const toggleAt = html.indexOf('wireTripsyHeaderMenuToggle("[data-tripsy-attire-menu-toggle]"');
const toggle = html.slice(toggleAt, toggleAt + 2500);
assert(/if \(isOwner && !\(driveData\.tripsyAttireGuides \|\| \[\]\)\.some\(g => g\.tripKey === tripKey\)\)/.test(toggle),
  'with no guide, the 👔 button asks first instead of opening a menu');
assert(/Is the itinerary complete, and are you ready to build the Daily Dress Guide\?/.test(toggle), 'THE ASK: the dialog asks whether the itinerary is complete');
assert(/if \(ready\) tripsyRunAttireGenerationSafely\(tripKey, \{ isRefresh: false, dressOnly: true \}\);\s*\n\s*return false;/.test(toggle),
  'Yes builds the dress codes only; either answer keeps the menu closed');

// "At the bottom of the daily dress guide have a green button that says 'Approved'. When the
// user selects that button, create the clothing summary, and then make that option available
// on the attire menu under the daily dress guide" (2026-10-05).
const dg = extractFn('renderTripsyDressGuideInto');
assert(/\$\{isOwner && tripsyAttireGuideIsDressOnly\(guide\) \? `<div class="tripsy-dg-approve-row"><button type="button" class="tripsy-dg-approve-btn" data-tripsy-dg-approve>Approved<\/button><\/div>` : ''\}/.test(dg),
  'THE ASK: an owner-only "Approved" button sits at the foot of a dress-codes-only guide');
assert(dg.indexOf('data-tripsy-dg-approve>Approved') > dg.indexOf('${dailyDressGuideHtml'), 'it renders below the days');
assert(/\.tripsy-dg-approve-btn \{\s*\n\s*background: #2e9d4f;/.test(html), 'and it is green');
assert(/approveBtn\.addEventListener\('click', \(\) => tripsyApproveDressCodes\(guide\.tripKey\)\)/.test(dg), 'pressing it approves');
const approve = extractFn('tripsyApproveDressCodes');
assert(/tripsyRunAttireGenerationSafely\(tripKey, \{ isRefresh: true, dressOnly: false, approved: true \}\)/.test(approve),
  'THE ASK: approving builds the full guide -- the Clothing Summary -- from the reviewed dress codes');
assert(/overlay\.style\.display = 'flex';/.test(approve) && approve.indexOf("display = 'flex'") < approve.indexOf('tripsyRunAttireGenerationSafely'),
  'the Clothing Summary opens first so its progress line shows');
assert(/if \(tripsyAttireGeneratingKeys\.has\(tripKey\)\)/.test(approve), 'a double press cannot start two builds');
assert(/summaryLiveForTrip\(\) && !opts\.approved && !opts\.minimal\)/.test(extractFn('runTripsyAttireGeneration')), 'no second review dialog after approving');
const menuAt = html.indexOf("menuListButtonHtml(`data-tripsy-attire-nav=\"dressguide\"", html.indexOf(': ['));
const fullMenu = html.slice(html.indexOf(': [', html.indexOf('const attireMenuItems = attireDressOnly')), html.indexOf("].join('')", html.indexOf('const attireMenuItems = attireDressOnly')));
assert(fullMenu.indexOf('nav="dressguide"') > 0 && fullMenu.indexOf('nav="dressguide"') < fullMenu.indexOf('nav="summary"'),
  'THE ASK: Clothing Summary sits under the Daily Dress Guide in the menu');

// "At the bottom of the clothing summary page put a green button that says 'Select Garments
// To Pack'. When the user selects that, bring up the Plan Packing List page, but change the
// name to packing list" (2026-10-05).
const summary = extractFn('renderTripsyAttireOverlayContent');
assert(/\$\{isOwner && guide\.personGuidance \? `<div class="tripsy-dg-approve-row"><button type="button" class="tripsy-dg-approve-btn" data-tripsy-attire-select-garments>Select Garments To Pack<\/button><\/div>` : ''\}/.test(summary),
  'THE ASK: an owner-only green "Select Garments To Pack" button sits at the foot of the Clothing Summary');
assert(summary.indexOf('data-tripsy-attire-select-garments>') > summary.indexOf('${personsHtml}'), 'below the Him/Her cards');
assert(/tripsyWardrobePackForTrip\(guide\.tripKey, trip \? trip\.name : '', tripsyDressGuidePerson \|\| 'him'\)/.test(summary),
  'pressing it opens the Packing List for the person the guide is showing');
assert(/>Packing List<\/h2>/.test(html) && /textContent = `Packing List\$\{tripName/.test(html), 'THE ASK: the page is titled "Packing List"');
assert(/'🧳', 'Packing List'\)/.test(html) && />Packing List<\/button>/.test(html), 'the menu item and the summary card button say "Packing List" too');
assert(!/[>'"`]Plan Packing List[<'"`]/.test(html.replace(/\/\/[^\n]*/g, '').replace(/<!--[\s\S]*?-->/g, '')),
  'no user-visible "Plan Packing List" wording remains');

// "when the list is complete, display a dialog box asking if the user wants to start packing
// now. If yes, display the packing status bar. If not, say select packing status when you are
// ready to start packing. In both cases, make the packing status menu option available" (2026-10-05).
const done = extractFn('tripsyPackingCompleteDialog');
assert(/'Your packing list is complete! Would you like to start packing now\?'/.test(done) && /yes: 'Start packing', no: 'Not yet'/.test(done),
  'THE ASK: completing the list asks whether to start packing now');
assert(done.indexOf("renderTripsyEventsList()") < done.indexOf('if (!startNow)'), 'both answers re-render My Trips so Packing Status joins the 👔 menu');
assert(/Select Packing Status from the 👔 Attire menu when you are ready to start packing\./.test(done), 'No says where to find Packing Status');
assert(/tripsyWardrobePackingList\(tripKey, trip \? trip\.name : '', person\)/.test(done) && done.indexOf("sel.style.display = 'none'") < done.indexOf('tripsyWardrobePackingList('),
  'Yes closes the Packing List and opens Packing Status for the same person');
assert(!/runTripsyOutfitComposition/.test(done), 'outfits are no longer offered here (Compose Outfits stays on the menu)');

// "create a menu item under attire called generate outfits … generate the outfits in the
// background … change the menu item from generate outfits to view outfits. If there are changes
// to the itinerary that make the generated outfits or garment counts obsolete, flash the yellow
// triangle by the appropriate menu item and, if the user selects it, bring up the same dialog
// boxes you use now … Always update attire-related pages in the background" (2026-10-05).
assert(/data-mode="generate" data-key="\$\{esc\(trip\.key\)\}"`, '✨', 'Generate Outfits', attireOutfitsGenHtml\)/.test(html),
  'THE ASK: the menu item is "Generate Outfits" before any outfit exists');
assert(/'✨', 'View Outfits', attireOutfitsGenHtml \+ `<span data-tripsy-outfits-warning/.test(html), 'and "View Outfits" once they exist');
const bg = extractFn('tripsyGenerateOutfitsInBackground');
assert(/tripsyOutfitComposingKeys\.add\(tripKey\)/.test(bg) && /await runTripsyOutfitComposition\(tripKey, p, \{ quiet: true \}\)/.test(bg)
  && /tripsyOutfitComposingKeys\.delete\(tripKey\)/.test(bg) && /renderTripsyEventsList\(\)/.test(bg),
  'generation runs in the background per complete person and re-renders My Trips when done (the item flips to View Outfits)');
assert(/Generate outfits for this trip now\?/.test(html) && /if \(ok\) tripsyGenerateOutfitsInBackground\(key\);/.test(html),
  'THE ASK: picking Generate Outfits asks first, then generates in the background');
assert(/\.tripsy-menu-flash \{ animation: tripsy-attire-badge-blink/.test(html)
  && /data-tripsy-attire-stale-warning="\$\{esc\(trip\.key\)\}" class="tripsy-menu-flash"/.test(html)
  && /data-tripsy-outfits-warning="\$\{esc\(trip\.key\)\}" class="tripsy-menu-flash"/.test(html),
  'THE ASK: the ⚠️ on Daily Dress Guide / Clothing Summary / View Outfits FLASHES');
assert(/'📅', 'Daily Dress Guide', attireStaleWarnHtml\)/.test(html) && /'👗', 'Clothing Summary', attireStaleWarnHtml\)/.test(html),
  'the guide pages carry the stale triangle');
assert(/data-tripsy-attire-stale-warning=\$\{CSS\.escape\(trip\.key\)\}/.test(extractFn('tripsyFlagStaleAttireButtons').replace(/"/g, '')),
  'the same stale pass that marks the 👔 button marks those rows');
assert(/if \(staleFlagged && isOwner && await tripsyAttireStalePrompt\(key\)\) return;/.test(html),
  'THE ASK: selecting a flagged row brings up the same out-of-date dialog the 👔 button uses');
assert(/return !\(await tripsyAttireStalePrompt\(tripKey\)\);/.test(html), 'the 👔 button itself uses that shared prompt');
assert(/if \(regen\) \{ tripsyGenerateOutfitsInBackground\(key\); return; \}/.test(html), 'a stale View Outfits regenerates in the background');
assert(!/tripsyShowOutfitComposingSpinner\(/.test(html), 'THE ASK: no blocking spinner is left anywhere -- attire pages update in the background');
