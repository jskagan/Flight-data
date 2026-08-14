// "I just regenerated my outfits but they did not regenerate." / "It said 'Could not
// save the composed outfits'. I selected regenerate from the dialog box saying outfits
// were out of date. No toast." Confirmed against real Drive data: the composed
// outfits' generatedAt was UNCHANGED after the owner clicked Regenerate -- the save
// never landed at all. Root cause: persistTripsyNarrativeCacheWithRetry's own inner
// retry only fires for a REVISION CONFLICT (e.chosen.conflict) -- a plain transient
// failure (a network blip, or a briefly backgrounded tab after the minute-plus Claude
// call) is not a conflict, so a single hiccup threw immediately with zero retries, and
// the whole (slow, costly) composition was discarded for nothing. Fixed two ways:
// (1) composeTripsyOutfits now retries the SAVE step itself (bounded, with backoff)
// regardless of error kind, since the composed outfits object is cheap and idempotent
// to re-save; (2) if it still fails after retries, the composed result is preserved on
// the thrown error (err.tripsyComposedOutfits) so runTripsyOutfitComposition can offer
// to retry JUST the save, instead of forcing the owner to redo the whole Claude call.
// Follow-up, same day: "a toast message just appeared - couldn't read it in time" --
// the final unrecovered-failure message was still a plain toast() (auto-dismisses in
// ~4s). Both the final failure message AND the retry-save offer now use
// tripsyConfirmDialog, which stays on screen until dismissed; a new no:null mode
// renders it as a single "OK" acknowledgement rather than a real Yes/No choice.
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

// ---- source-pattern checks: the save-step retry inside composeTripsyOutfits ----
const composeFn = extractFn('composeTripsyOutfits');
assert(/let ok = await Store\.saveTripsyTripOutfits\(outfits\);/.test(composeFn), 'sanity: extracted the real function');
assert(/for \(let attempt = 0; !ok && attempt < 3; attempt\+\+\) \{/.test(composeFn),
  'THE FIX: the save is retried up to 3 more times, not given up on after one failure');
assert(/await new Promise\(r => setTimeout\(r, 1000 \* \(attempt \+ 1\)\)\);/.test(composeFn),
  'with backoff between attempts, to ride out a brief hiccup rather than hammering immediately');
assert(/err\.tripsyComposedOutfits = outfits;/.test(composeFn),
  'THE ASK: the already-composed result is preserved on the error even when every retry fails');

// ---- source-pattern checks: the retry-save offer in runTripsyOutfitComposition ----
const runFn = extractFn('runTripsyOutfitComposition');
assert(/if \(e && e\.tripsyComposedOutfits\) \{/.test(runFn),
  'checks for the preserved composed result before giving up');
assert(/title: '⚠️ Could not save outfits', yes: 'Retry Save', no: 'Discard' \}\);/.test(runFn),
  'offers to retry JUST the save -- never silently re-running the whole (slow, costly) composition');
assert(/const ok = await Store\.saveTripsyTripOutfits\(e\.tripsyComposedOutfits\);/.test(runFn),
  'a retry re-saves the SAME already-composed object, not a fresh Claude call');
assert(/if \(ok\) \{ await tripsyOutfitComposeSucceeded\(tripKey\); return; \}/.test(runFn),
  'a successful retry-save finishes exactly like the normal success path (shared helper, can\'t drift)');

// ---- executed: the save-retry loop's own logic, against fixtures (no real timers) ----
(async () => {
  const runSaveRetry = async (saveResults) => {
    let i = 0;
    const Store = { saveTripsyTripOutfits: async () => saveResults[Math.min(i++, saveResults.length - 1)] };
    const sleep = async () => {}; // stub out the real setTimeout delay for the test
    let ok = await Store.saveTripsyTripOutfits();
    for (let attempt = 0; !ok && attempt < 3; attempt++) {
      await sleep();
      ok = await Store.saveTripsyTripOutfits();
    }
    return { ok, attempts: i };
  };

  // First try fails, second succeeds -> the retry alone recovers, no data lost.
  let r = await runSaveRetry([false, true]);
  assert(r.ok === true && r.attempts === 2, `THE ASK: a single transient failure now recovers via retry -> ${JSON.stringify(r)}`);

  // Every attempt fails -> gives up after 4 total tries (1 initial + 3 retries), not forever.
  r = await runSaveRetry([false, false, false, false]);
  assert(r.ok === false && r.attempts === 4, `bounded -- 4 total attempts, then gives up -> ${JSON.stringify(r)}`);

  // First try succeeds outright -> no retry needed at all.
  r = await runSaveRetry([true]);
  assert(r.ok === true && r.attempts === 1, `an ordinary successful save is unaffected -- no extra attempts -> ${JSON.stringify(r)}`);
})();

// ---- source-pattern checks: the final failure is a blocking dialog, not a fleeting
// toast -- reported 2026-08-14, right after the retry-save fix above shipped: "a toast
// message just appeared - couldn't read it in time" ----
assert(/await tripsyConfirmDialog\(`Could not compose outfits — \$\{e\.message \|\| 'unknown error'\}\.`,\s*\n\s*\{ title: '❌ Outfit composition failed', yes: 'OK', no: null \}\);/.test(runFn),
  'THE FIX: the final failure message is a blocking OK dialog (readable until dismissed), not toast() (auto-dismisses in ~4s)');

// ---- source-pattern checks: tripsyConfirmDialog's new single-button ("OK") mode ----
const dialogFn = extractFn('tripsyConfirmDialog');
assert(/const noButtonHtml = no !== null \? `<button class="btn" data-confirm-no>\$\{esc\(no\)\}<\/button>` : '';/.test(dialogFn),
  'the "No" button is omitted entirely when no is explicitly null, not just relabeled');
assert(/ov\.onclick = e => \{ if \(e\.target === ov\) done\(no === null\); \};/.test(dialogFn),
  'clicking outside a single-button dialog acknowledges it (resolves true) rather than declining, since there is nothing to decline');

// ---- executed: runTripsyOutfitComposition's retry-save offer, against fixtures ----
(async () => {
  const run = async (ownerAcceptsRetry, retrySaveSucceeds) => {
    const calls = { dialogsShown: [], succeeded: false };
    const tripsyConfirmDialog = async (msg, opts) => { calls.dialogsShown.push(opts.title); return ownerAcceptsRetry; };
    const Store = { saveTripsyTripOutfits: async () => retrySaveSucceeds };
    const tripsyOutfitComposeSucceeded = async () => { calls.succeeded = true; };

    // Mirrors the real catch block's control flow exactly (pinned by the
    // source-pattern assertions above to this same shape).
    const e = new Error('Could not save the composed outfits.');
    e.tripsyComposedOutfits = { blocks: ['fake'] };
    if (e && e.tripsyComposedOutfits) {
      const retry = await tripsyConfirmDialog('msg', { title: '⚠️ Could not save outfits', yes: 'Retry Save', no: 'Discard' });
      if (retry) {
        const ok = await Store.saveTripsyTripOutfits(e.tripsyComposedOutfits);
        if (ok) { await tripsyOutfitComposeSucceeded('T1'); return calls; }
      }
    }
    await tripsyConfirmDialog(`Could not compose outfits — ${e.message || 'unknown error'}.`,
      { title: '❌ Outfit composition failed', yes: 'OK', no: null });
    return calls;
  };

  let r = await run(true, true);
  assert(r.dialogsShown.length === 1 && r.dialogsShown[0] === '⚠️ Could not save outfits', 'THE ASK: the owner is offered a retry, not just a dead-end error');
  assert(r.succeeded === true, 'accepting and a successful retry-save finishes normally');

  r = await run(true, false);
  assert(r.succeeded === false && r.dialogsShown[1] === '❌ Outfit composition failed',
    'a retry-save that ALSO fails falls through to the blocking failure dialog, not a silent dead end');

  r = await run(false, true);
  assert(r.succeeded === false && r.dialogsShown[1] === '❌ Outfit composition failed',
    'declining ("Discard") shows the blocking failure dialog, same as any other unrecovered failure');
})();
