// "I regenerated outfits this morning. Why wasn't this fixed. I shouldn't have to
// manually swap after regenerating." Investigation: the owner had refreshed the ATTIRE
// GUIDE (dress-code categorization), not the separate OUTFITS document -- the guide
// moved a time-block from Casual to Smart Casual, but composed outfits are a distinct,
// explicitly-triggered step (an expensive Claude call), so the block kept its
// Athletic-only garment. The success toast after a guide refresh said "dress codes
// updated" with zero mention that outfits were now stale -- that staleness only ever
// surfaced per-block, the moment the owner happened to open THAT ONE outfit. Fixed:
// runTripsyAttireGeneration now checks, right after a successful guide
// generate/refresh, whether either person's already-composed outfits need recomposing
// (tripsyOutfitsNeedRecompose), and if so offers the SAME batch Regenerate the Outfits
// nav link already offers -- instead of leaving it to be discovered and fixed one
// manual Swap at a time.
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

const fn = extractFn('runTripsyAttireGeneration');
assert(fn.includes("toast(opts.approved ? 'Clothing Summary created.' : guide && guide.packingFrozen"), 'sanity: extracted the real function, found the success toast');

// ---- source-pattern checks ----
assert(/if \(isOwner\) \{\s*\n\s*for \(const p of \['him', 'her'\]\) \{/.test(fn),
  'THE FIX: after a successful guide generate/refresh, both people are checked -- owner-only, since recomposing writes');
assert(/const existing = \(driveData\.tripsyTripOutfits \|\| \[\]\)\.find\(o => o\.tripKey === tripKey && \(o\.person \|\| 'him'\) === p\);/.test(fn),
  'only looks at outfits that actually exist for this trip+person');
assert(/if \(!existing \|\| !\(existing\.blocks \|\| \[\]\)\.some\(b => \(b\.garmentIds \|\| \[\]\)\.length\)\) continue;/.test(fn),
  'skips a person with no real composed outfit (nothing to go stale)');
assert(/if \(!\(await tripsyOutfitsNeedRecompose\(tripKey, p\)\)\) continue;/.test(fn),
  'THE ASK: reuses the SAME staleness check the Outfits nav link and the outfit modal already use, so this can never disagree with them');
assert(/title: '⚠️ Outfits may be out of date', yes: 'Regenerate', no: 'Ignore' \}\);/.test(fn),
  'offers the same Regenerate/Ignore choice as the existing Outfits-nav prompt, not a silent auto-recompose');
assert(/if \(regen\) \{ tripsyGenerateOutfitsInBackground\(tripKey\); break; \}/.test(fn),
  'accepting runs the real batch recompose in the BACKGROUND (the same one Outfits-nav Regenerate uses) -- 2026-10-05');

// This only runs on a SUCCESSFUL generate/refresh -- placed after the success toast,
// never inside the catch block (a failed guide has nothing new to compare outfits
// against).
const successToastIdx = fn.indexOf("toast(opts.approved ? 'Clothing Summary created.' : guide && guide.packingFrozen");
const checkIdx = fn.indexOf('tripsyOutfitsNeedRecompose(tripKey, p)');
const catchIdx = fn.indexOf('} catch (e) {');
assert(successToastIdx > -1 && checkIdx > successToastIdx && checkIdx < catchIdx,
  'the staleness check runs after the success toast and before the catch block -- only on a real success');

// ---- executed: the per-person gating logic itself, against fixtures ----
(async () => {
  const run = async (existingOutfits, needsRecompose, ownerAnswersYes) => {
    const calls = { dialogsShown: [], recomposed: [] };
    const isOwner = true;
    const driveData = { tripsyTripOutfits: existingOutfits };
    const tripsyOutfitsNeedRecompose = async (tripKey, p) => needsRecompose[p] || false;
    const tripsyConfirmDialog = async (msg, opts) => { calls.dialogsShown.push(opts.title); return ownerAnswersYes; };
    const tripsyGenerateOutfitsInBackground = tripKey => { calls.recomposed.push('both'); };
    const tripKey = 'T1';

    // Mirrors the real block's control flow exactly (pinned by the source-pattern
    // assertions above to this same shape).
    if (isOwner) {
      for (const p of ['him', 'her']) {
        const existing = (driveData.tripsyTripOutfits || []).find(o => o.tripKey === tripKey && (o.person || 'him') === p);
        if (!existing || !(existing.blocks || []).some(b => (b.garmentIds || []).length)) continue;
        if (!(await tripsyOutfitsNeedRecompose(tripKey, p))) continue;
        const regen = await tripsyConfirmDialog('msg', { title: '⚠️ Outfits may be out of date', yes: 'Regenerate', no: 'Ignore' });
        if (regen) { tripsyGenerateOutfitsInBackground(tripKey); break; }
      }
    }
    return calls;
  };

  const himOutfits = { tripKey: 'T1', person: 'him', blocks: [{ garmentIds: ['g1'] }] };

  // THE REPORTED CASE: outfits exist and are now stale -> asked, and accepting recomposes.
  let r = await run([himOutfits], { him: true }, true);
  assert(r.dialogsShown.length === 1 && r.dialogsShown[0] === '⚠️ Outfits may be out of date',
    'THE ASK: a stale existing outfit is flagged right after the refresh, not left silent');
  assert(r.recomposed.length === 1 && r.recomposed[0] === 'both', 'accepting starts one background run (it covers every composed person)');

  // No outfits composed at all for either person -> nothing to go stale, no prompt.
  r = await run([], { him: true, her: true }, true);
  assert(r.dialogsShown.length === 0, 'no existing outfits -> no prompt, nothing to recompose');

  // Outfits exist but are NOT stale -> no prompt (the ordinary, common case).
  r = await run([himOutfits], { him: false }, true);
  assert(r.dialogsShown.length === 0, 'existing outfits that are still current -> no prompt');

  // Declining leaves it alone -- never a silent auto-recompose.
  r = await run([himOutfits], { him: true }, false);
  assert(r.dialogsShown.length === 1 && r.recomposed.length === 0, 'declining ("Ignore") does not recompose');

  // Both people stale -> ONE offer, and the accepted background run covers both (2026-10-05).
  const herOutfits = { tripKey: 'T1', person: 'her', blocks: [{ garmentIds: ['g2'] }] };
  r = await run([himOutfits, herOutfits], { him: true, her: true }, true);
  assert(r.dialogsShown.length === 1 && r.recomposed.length === 1, 'both people stale -> one offer, one background run for both -> ' + JSON.stringify(r));
  r = await run([himOutfits, herOutfits], { him: true, her: true }, false);
  assert(r.dialogsShown.length === 2 && r.recomposed.length === 0, 'declining still offers the other person separately');
})();
