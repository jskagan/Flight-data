// "When I press continue from the itinerary changes view, I am still
// getting error messages and the dialog box does not go away. The dialog
// box should disappear as soon as I hit continue, and there should be no
// errors" (2026-09-28). Continue is now fire-and-forget: the dialog closes
// IMMEDIATELY and the whole run happens in the background -- and an in-app
// generation failure (on the iPad the direct browser API call often can't
// get through at all: "Load failed") falls back to the CLOUD narrative
// relay (tripsyQueueItineraryChangesCloudRequest, riding the partial
// itinerary's request/answer machinery) instead of surfacing an error.
// This suite used to cover tripsyItineraryDoneDialog, the three-way
// Close / Itinerary View / Trips View dialog Continue ended in -- retired
// with the backgrounding (a modal popping up minutes later over whatever
// the owner is doing would be noise); completion is a toast.
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

const dlg = extractFn('showTripsyItineraryChangesDialog');
const handlerStart = dlg.indexOf("[data-icd-continue]').addEventListener");
const handler = dlg.slice(handlerStart);

// ---- the dialog closes the instant Continue is pressed ----
{
  const iRemove = handler.indexOf('overlay.remove()');
  const iWork = handler.indexOf('(async () => {');
  const iGenerate = handler.indexOf('tripsyGenerateNarrativeSections');
  assert(iRemove !== -1 && iWork !== -1 && iGenerate !== -1 && iRemove < iWork && iWork < iGenerate,
    'THE ASK: overlay.remove() runs synchronously in the click handler, BEFORE the background async block that does the work');
  assert(!/contBtn\.disabled/.test(handler) && !/status\.textContent/.test(handler),
    'no disabled-button wait and no in-dialog status line remain -- there is no dialog left to freeze');
}

// ---- an in-app generation failure falls back to the cloud relay ----
{
  assert(/catch \(genErr\) \{[\s\S]*?tripsyQueueItineraryChangesCloudRequest\(trip, checkedDayKeys\)/.test(handler),
    'THE NO-ERRORS RULE: a failed in-app generation (iPad "Load failed", rate limit) hands the SAME days to the cloud routine instead of erroring');
  assert(/being finished in the background/.test(handler),
    'the hand-off is announced as background work, not an error');
  const fallback = extractFn('tripsyQueueItineraryChangesCloudRequest');
  assert(/includeIntro: false, dayKeysToGenerate: checkedDayKeys, summaryDayKeys: checkedDayKeys/.test(fallback),
    'the cloud request scopes to exactly the checked days, day write-ups and summary rows alike (same scoping as the in-app call)');
  assert(/if \(!pending\)/.test(fallback) && /runTripsyRefreshViaWorker\(null\)/.test(fallback),
    'an already-pending request is never re-queued over (that would re-date it) -- just a fresh best-effort worker fire');
  assert(/tripsyBuildNarrativeCloudRequest\(trip, \{/.test(fallback),
    'it builds through the SHARED request builder, so its prompts are identical to the partial itinerary’s');
}

// ---- completion is a toast; the old done dialog is gone ----
assert(/toast\(checkedDayKeys\.length\s*\n?\s*\? `Itinerary updated/.test(handler)
  && /'Changes marked as reviewed\.'/.test(handler),
  'success reports as a toast, sized to what actually happened');
assert(!/function tripsyItineraryDoneDialog/.test(html) && !/data-itindone-/.test(html),
  'RETIRED: tripsyItineraryDoneDialog (Close / Itinerary View / Trips View) is gone -- no foreground moment remains to ask it in');

// ---- baseline still records before the photo prefetch (the stall lesson) ----
{
  const iBaseline = handler.indexOf('tripsyRecordItineraryBaseline(trip)');
  const iPhotos = handler.indexOf('Fetching photos for the new places');
  assert(iBaseline !== -1 && iPhotos !== -1 && iBaseline < iPhotos,
    'generate -> baseline -> photo prefetch order survives the backgrounding');
}

// ---- "Review changes" while a cloud rewrite is pending reports, not re-asks ----
assert(/Store\.listTripsyNarrativeRequests\(\)\.find\(r => r\.tripKey === tripKey\)/.test(html)
  && /already being rewritten in the background/.test(html),
  'reopening Review changes mid-rewrite explains the pending background run instead of inviting a duplicate ask');
