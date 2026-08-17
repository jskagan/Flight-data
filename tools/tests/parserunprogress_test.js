// "There is a yellow triangle saying there are new items to parse, but when I hit
// parse the triangle is still there with the same message." Working as designed --
// the button fires a CLOUD run that takes minutes, and the badge stays yellow until
// the run finishes AND the app pulls its results in -- but the design had two real
// gaps: (1) after pressing the button the panel read IDENTICALLY to before, so the
// press looked like a no-op; (2) the app never re-checked the relay files on its
// own -- results only ever arrived on the next badge tap or app open, so the
// triangle sat unchanged no matter how long the owner waited. Fixed: a successful
// fire records tripsyParseRunStartedAt, the panel shows a live "parse run in
// progress (started N min ago)" row while items still await parsing, and a few
// scheduled polls (90s..700s) call syncTripsyRelays to drain results automatically
// the moment they land.
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

// ---- source-pattern checks: the fire records itself and schedules relay polls ----
const fireFn = extractFn('runTripsyRefreshViaWorker');
assert(/tripsyParseRunStartedAt = Date\.now\(\);/.test(fireFn), 'a successful fire records when it started');
assert(/\[90, 180, 300, 480, 700\]\.forEach\(s => setTimeout\(\(\) => \{\s*\n\s*if \(tripsyParseRunStartedAt\) syncTripsyRelays\(\);\s*\n\s*\}, s \* 1000\)\);/.test(fireFn),
  'THE FIX: relay polls are scheduled across the run window, so results pull in with no further taps');
assert(/await updateTripsyStatusBadge\(\); \/\/ repaint the panel so it reflects the run NOW/.test(fireFn),
  'the panel repaints immediately after the fire, so the press visibly changed something');
assert(/results usually land within a few minutes and will be pulled in automatically/.test(fireFn),
  'the toast no longer tells the owner to come back and tap the badge again');
// The marker is only set on the SUCCESS path -- a failed fire must not claim a run.
const okBranch = fireFn.slice(fireFn.indexOf('if (res.ok) {'), fireFn.indexOf('} else if (res.status === 401)'));
assert(okBranch.includes('tripsyParseRunStartedAt = Date.now()'), 'the marker is set inside the res.ok branch');
assert((fireFn.match(/tripsyParseRunStartedAt = Date\.now\(\)/g) || []).length === 1, 'and nowhere else in the fire function');

// ---- source-pattern checks: the status panel shows the run while items still wait ----
const statusFn = extractFn('computeTripsyStatus');
assert(/if \(tripsyParseRunStartedAt && \(docsToParse\.length \|\| emailsToParse\)\) \{/.test(statusFn),
  'the in-progress row only shows while something is genuinely still waiting to parse');
assert(/A parse run is in progress \(started \$\{mins\} min ago\) — results are pulled in automatically when it finishes\./.test(statusFn),
  'THE FIX: the panel now says a run is underway instead of reading identically to before the press');
assert(/if \(ageMs <= TRIPSY_PARSE_RUN_WINDOW_MS\) \{/.test(statusFn),
  'the claim is time-bounded -- a run that never lands stops being claimed after the window');
assert(/\} else if \(tripsyParseRunStartedAt && !docsToParse\.length && !emailsToParse\) \{\s*\n\s*tripsyParseRunStartedAt = null;/.test(statusFn),
  'once nothing awaits parsing the marker clears, so a stale "in progress" line cannot outlive the work');

// ---- executed: the panel-row decision logic, against fixtures ----
{
  const WINDOW = 12 * 60 * 1000;
  const decide = (startedAt, now, waitingCount) => {
    // Mirrors the real block's control flow exactly (pinned by the source-pattern
    // assertions above to this same shape). Returns {row, cleared}.
    let tripsyParseRunStartedAt = startedAt;
    let row = null;
    if (tripsyParseRunStartedAt && waitingCount) {
      const ageMs = now - tripsyParseRunStartedAt;
      if (ageMs <= WINDOW) {
        const mins = Math.max(1, Math.round(ageMs / 60000));
        row = `A parse run is in progress (started ${mins} min ago) — results are pulled in automatically when it finishes.`;
      } else {
        tripsyParseRunStartedAt = null;
      }
    } else if (tripsyParseRunStartedAt && !waitingCount) {
      tripsyParseRunStartedAt = null;
    }
    return { row, cleared: tripsyParseRunStartedAt === null };
  };

  const t0 = 1000000000;
  // THE ASK: right after pressing the button, the panel says a run is underway.
  let r = decide(t0, t0 + 30 * 1000, 2);
  assert(r.row !== null && r.row.includes('started 1 min ago'), 'a just-started run shows as in progress (floored at 1 min) -> ' + r.row);

  // Five minutes in, still waiting -> still claimed, with an honest age.
  r = decide(t0, t0 + 5 * 60 * 1000, 2);
  assert(r.row !== null && r.row.includes('started 5 min ago'), 'the age updates as time passes');

  // The run landed and everything drained -> marker clears, no stale claim.
  r = decide(t0, t0 + 4 * 60 * 1000, 0);
  assert(r.row === null && r.cleared, 'nothing left waiting -> the marker clears rather than lingering');

  // A run that never lands stops being claimed after the window.
  r = decide(t0, t0 + 13 * 60 * 1000, 2);
  assert(r.row === null && r.cleared, 'past the window the panel stops claiming a run that evidently never landed');

  // No run ever fired -> no row, unchanged behavior.
  r = decide(null, t0, 2);
  assert(r.row === null, 'no fire recorded -> the panel reads exactly as before this change');
}
