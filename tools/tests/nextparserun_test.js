// "When the user uploads a document for parsing, in the yellow-triangle window, tell
// the user the time for the next scheduled parse run and say the document will be
// parsed then, or give the parse now option" (2026-08-29). The panel used to say only
// "waiting for the next scheduled parse run", which names no time at all and reads as
// an unknowable delay.
//
// The awkward part: the schedule lives in the cloud Routine (claude.ai/code/routines),
// which this app cannot query, so TRIPSY_PARSE_RUN_UTC_TIMES is a hand-mirrored
// constant. That makes DRIFT the real hazard -- a stated time the Routine no longer
// honours is worse than no time, because the owner waits for a run that isn't coming.
// Hence the rule this suite exists to lock down: an EMPTY schedule must degrade to
// naming the cadence, never to a wrong or broken time.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  if (!m) return '';
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
  return '';
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- source-level: the constant and its safety valve ----
assert(/const TRIPSY_PARSE_RUN_UTC_TIMES = \[/.test(html),
  'the schedule is one named constant, so keeping it in sync with the Routine is a one-line edit');
assert(/\*\*UTC\*\*/.test(html) && /LEAVE THIS EMPTY IF YOU DON'T KNOW THE TIMES/.test(html),
  'it documents that entries are UTC (how a Routine cron is evaluated) and that empty is a legitimate state');
assert(/const TRIPSY_PARSE_RUN_CADENCE_LABEL = /.test(html),
  'the fallback cadence wording is its own constant rather than inline prose');

// ---- the shipped constant matches the Routine's actual cron ----
// Pinned deliberately: these two live in different systems (this file vs. the Routine at
// claude.ai/code/routines) and nothing enforces agreement at runtime, so this is the only
// place the relationship is checked at all. If the Routine's schedule changes, this fails
// and names what to update -- which is the intended outcome, not a nuisance.
{
  const m = html.match(/Currently mirroring the Routine's cron `([^`]+)`/);
  assert(!!m, 'the comment records WHICH cron expression the constant mirrors');
  const cron = m ? m[1] : '';
  assert(cron === '0 0,6,16 * * *', `the recorded cron is the one the owner confirmed (got: ${cron})`);
  // Derive the expected hours from the cron itself rather than restating them, so the
  // two halves of this check can't drift apart either.
  const [minute, hours] = cron.split(' ');
  const expected = hours.split(',').map(h => ({ hour: Number(h), minute: Number(minute) }));
  const decl = html.match(/const TRIPSY_PARSE_RUN_UTC_TIMES = (\[[^\]]*\]);/);
  assert(!!decl, 'the constant is a plain literal array, readable without executing the file');
  const actual = decl ? new Function(`return ${decl[1]};`)() : [];
  assert(actual.length === expected.length,
    `one entry per cron hour (expected ${expected.length}, got ${actual.length})`);
  assert(expected.every(e => actual.some(a => a.hour === e.hour && (a.minute || 0) === e.minute)),
    'every hour in the cron has a matching entry -- UTC, since Routine crons are evaluated in UTC');
}

// ---- executed: next-run selection, with a real schedule ----
const withSchedule = times => new Function(
  `const TRIPSY_PARSE_RUN_UTC_TIMES = ${JSON.stringify(times)};\n` +
  `const TRIPSY_PARSE_RUN_CADENCE_LABEL = 'three times a day';\n` +
  extractFn('tripsyNextScheduledParseRun') + '\n' +
  extractFn('tripsyFormatNextParseRun') + '\n' +
  extractFn('tripsyNextParseRunSentence') + '\n' +
  'return { tripsyNextScheduledParseRun, tripsyFormatNextParseRun, tripsyNextParseRunSentence };'
)();

{
  const F = withSchedule([{ hour: 6 }, { hour: 14 }, { hour: 22 }]);
  const next = iso => {
    const d = F.tripsyNextScheduledParseRun(new Date(iso));
    return d && d.toISOString();
  };
  assert(next('2026-08-29T05:00:00Z') === '2026-08-29T06:00:00.000Z', 'before the first slot -> that slot, today');
  assert(next('2026-08-29T13:59:00Z') === '2026-08-29T14:00:00.000Z', 'mid-day -> the next slot today');
  assert(next('2026-08-29T06:00:00Z') === '2026-08-29T14:00:00.000Z',
    'exactly ON a slot -> the NEXT one; "next run" must be strictly in the future or it would name a run already firing');
  assert(next('2026-08-29T22:30:00Z') === '2026-08-30T06:00:00.000Z',
    'past the last slot -> tomorrow\'s first, not null');
  assert(next('2026-12-31T23:00:00Z') === '2027-01-01T06:00:00.000Z',
    'the roll-forward crosses a year boundary correctly (UTC arithmetic, no local-date reasoning)');
}

// ---- unsorted entries still work, so a hand-edit can't silently break it ----
{
  const F = withSchedule([{ hour: 22 }, { hour: 6 }, { hour: 14 }]);
  const d = F.tripsyNextScheduledParseRun(new Date('2026-08-29T05:00:00Z'));
  assert(d && d.toISOString() === '2026-08-29T06:00:00.000Z',
    'entries listed out of order still resolve to the genuinely soonest slot');
}

// ---- minutes are honoured (a Routine anchored off :00) ----
{
  const F = withSchedule([{ hour: 6, minute: 30 }]);
  const d = F.tripsyNextScheduledParseRun(new Date('2026-08-29T06:00:00Z'));
  assert(d && d.toISOString() === '2026-08-29T06:30:00.000Z', 'a minute offset is respected, not floored to the hour');
}

// ---- THE DRIFT GUARD: unknown schedule degrades, never lies ----
{
  const F = withSchedule([]);
  assert(F.tripsyNextScheduledParseRun(new Date()) === null, 'no schedule -> null rather than a fabricated time');
  assert(F.tripsyFormatNextParseRun(null) === null, 'and formatting null is null, not "Invalid Date"');
  const sentence = F.tripsyNextParseRunSentence();
  assert(/three times a day/.test(sentence) && !/at \d/.test(sentence),
    'the sentence names the CADENCE and states no clock time when the times are unknown');
  assert(/parsed automatically/.test(sentence),
    'and still promises the document does get parsed -- the half of the ask that does not depend on knowing when');
}

// ---- the sentence names the time when it IS known ----
{
  const F = withSchedule([{ hour: 6 }, { hour: 14 }, { hour: 22 }]);
  const sentence = F.tripsyNextParseRunSentence();
  assert(/next scheduled run, (today|tomorrow|\w+day) at /.test(sentence),
    'THE ASK: with a schedule set, the sentence states when the document will actually be parsed');
}

// ---- panel wiring: the row exists, and the "or" half is the existing button ----
const computeStatus = extractFn('computeTripsyStatus');
assert(/if \(docsToParse\.length \|\| emailsToParse\) \{[\s\S]*?tripsyNextParseRunSentence\(\)/.test(computeStatus),
  'the next-run row is pushed whenever anything is actually awaiting a parse');
assert(/Run Parse Now below/.test(computeStatus),
  'and points at the on-demand alternative -- the "or give the parse now option" half of the ask');
{
  // One row for docs+emails together, not one each: a single run handles both, so
  // repeating the sentence would just say the same thing twice.
  const occurrences = (computeStatus.match(/tripsyNextParseRunSentence\(\)/g) || []).length;
  assert(occurrences === 1, 'the sentence is emitted once, not repeated per pending kind');
}
assert(/waiting for the next scheduled parse run/.test(computeStatus) === false,
  'the old timeless "waiting for the next scheduled parse run" wording is gone from the status rows');
const panel = extractFn('renderTripsyStatusPanel');
assert(/data-tripsy-status-open-routines/.test(panel) && /Run Parse Now/.test(panel),
  'the Run Parse Now button is still rendered for every non-green state');
