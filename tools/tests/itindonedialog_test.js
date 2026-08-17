// "When there is a yellow triangle on itinerary for the user to review new items, and
// the user either selects or de-selects to generate a narrative, do not automatically
// open the itinerary view. Instead, display 3 buttons: close, itinerary view, or trips
// view." The changes dialog's Continue used to end in an unconditional
// previewTripsyItinerary() jump; it now ends in tripsyItineraryDoneDialog -- a
// three-way Close / Itinerary View / Trips View choice, shown AFTER the generating
// badge/progress cleanup has settled so nothing still claims a run is underway while
// the owner decides.
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

// ---- extract the Continue handler slice of showTripsyItineraryChangesDialog ----
const runStart = html.indexOf('const checkedDayKeys = [...new Set(');
const run = html.slice(runStart, html.indexOf('document.body.appendChild(overlay);', runStart));
assert(run.length > 500, 'sanity: found the Continue handler');

// ---- source-pattern checks: no auto-open; the choice dialog instead ----
assert(/let workSucceeded = false;/.test(html.slice(runStart - 400, runStart)) || /workSucceeded = true;/.test(run),
  'success is tracked so the choice dialog only shows when the work actually landed');
assert(/if \(!workSucceeded\) return;/.test(run), 'a failed run shows no destination dialog (the error stays visible in the changes dialog)');
assert(/const dest = await tripsyItineraryDoneDialog\(checkedDayKeys\.length\);/.test(run),
  'THE ASK: Continue ends in the three-way choice dialog, not an automatic jump');
const destIdx = run.indexOf('const dest = await tripsyItineraryDoneDialog');
const finallyIdx = run.indexOf('tripsyItineraryProgressWatchers.forEach');
assert(finallyIdx > -1 && destIdx > finallyIdx,
  'the dialog is asked AFTER the finally cleanup, so the glyph/progress dialog are settled while the owner decides');
assert(/if \(dest === 'itinerary'\) \{[\s\S]*?await previewTripsyItinerary\(trip\.key, \{ forceGeneratedView: true \}\);/.test(run),
  'Itinerary View opens the same preview the old auto-jump did (with the same first-photo allowance)');
const itinBranch = run.slice(run.indexOf("if (dest === 'itinerary')"), run.indexOf("} else if (dest === 'trips')"));
assert(/_tripsyAllowNewPlacePhotoFetch = true;/.test(itinBranch) && /finally \{ _tripsyAllowNewPlacePhotoFetch = false; \}/.test(itinBranch),
  'the new-place photo allowance still wraps the preview open, exactly as before');
assert(/else if \(dest === 'trips'\) \{[\s\S]*?if \(currentView !== 'tripsytrips'\) await navigate\('tripsytrips'\);/.test(run),
  'Trips View navigates to My Trips (or refreshes it when already there)');
const previewCalls = (run.match(/previewTripsyItinerary\(/g) || []).length;
assert(previewCalls === 1, `the preview opens ONLY from the Itinerary View choice -> ${previewCalls} call site`);

// ---- source-pattern checks: the dialog itself ----
const dlg = extractFn('tripsyItineraryDoneDialog');
assert(/data-itindone-close/.test(dlg) && /data-itindone-itinerary/.test(dlg) && /data-itindone-trips/.test(dlg),
  'THE ASK: exactly the three requested buttons -- Close, Itinerary View, Trips View');
assert(/>Close<\/button>/.test(dlg) && />Itinerary View<\/button>/.test(dlg) && />Trips View<\/button>/.test(dlg),
  'labeled as requested');
assert(/ov\.onclick = e => \{ if \(e\.target === ov\) done\('close'\); \};/.test(dlg),
  'clicking outside closes -- there is nothing to decline, only somewhere to go');
assert(/\$\{regeneratedCount \? 'Itinerary updated' : 'Changes reviewed'\}/.test(dlg),
  'the heading distinguishes a real regeneration from a mark-as-reviewed pass');
assert(/nothing was regenerated/.test(dlg), 'the de-selected-everything case says so honestly');

// ---- executed: the dialog resolves the right value per button ----
(async () => {
  // Minimal DOM stub: enough for the dialog to build, wire, and resolve.
  const nodes = {};
  const makeNode = () => ({
    style: {}, innerHTML: '', onclick: null,
    querySelector(sel) {
      const key = (sel.match(/data-itindone-(\w+)/) || [])[1];
      if (!key) return null;
      if (!nodes[key]) nodes[key] = { onclick: null };
      return nodes[key];
    },
  });
  const ov = makeNode();
  global.document = {
    getElementById: () => ov,
    createElement: () => makeNode(),
    body: { appendChild: () => {} },
  };
  eval(dlg.replace(/^function tripsyItineraryDoneDialog/, 'var tripsyItineraryDoneDialog = function'));

  let p = tripsyItineraryDoneDialog(2);
  nodes.itinerary.onclick();
  assert((await p) === 'itinerary', "the Itinerary View button resolves 'itinerary'");

  p = tripsyItineraryDoneDialog(0);
  nodes.trips.onclick();
  assert((await p) === 'trips', "the Trips View button resolves 'trips'");

  p = tripsyItineraryDoneDialog(0);
  nodes.close.onclick();
  assert((await p) === 'close', "the Close button resolves 'close'");

  p = tripsyItineraryDoneDialog(1);
  ov.onclick({ target: ov });
  assert((await p) === 'close', "clicking outside resolves 'close' too");
})();
