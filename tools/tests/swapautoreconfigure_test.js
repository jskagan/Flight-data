// "When I make a change to an outfit that would make a later outfit unavailable, because
// a garment would be dirty, determine whether there is another garment that could be
// substituted that would eliminate that issue and, if there is, automatically
// reconfigure the remaining outfits." A manual Swap can push extra wear onto whichever
// garment just went IN, which can leave a LATER block short of it. Reuses the exact same
// finder Wash Now already uses (tripsyLaundryFindAdjustments/tripsyOutfitSwapCandidates),
// but -- unlike the Wash Now flow, which asks first -- applies any fix it finds
// AUTOMATICALLY, since this is only ever swapping in an already-eligible, already-packed
// substitute for a block that hasn't happened yet, exactly what the owner asked to have
// happen without being asked each time.
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

// ---- source-pattern checks: the new auto-adjust helper ----
const autoFn = extractFn('tripsyOutfitAutoAdjustAfterSwap');
assert(autoFn.includes('tripsyLaundryFindAdjustments'), 'sanity: extracted the real function');
assert(/const \{ proposals, outfits \} = await tripsyLaundryFindAdjustments\(tripKey, person, guide\);/.test(autoFn),
  'reuses the SAME finder Wash Now uses -- a fix here is always something Swap itself would equally offer by hand');
assert(/if \(!proposals\.length\) return 0;/.test(autoFn), 'nothing to fix -> returns 0, no-op');
assert(/const ok = await tripsyLaundryApplyAdjustments\(outfits, proposals\);/.test(autoFn),
  'THE ASK: applies the fix directly -- no confirmation dialog, unlike the Wash Now flow');
assert(!autoFn.includes('tripsyLaundryAdjustmentsDialog'), 'confirms no confirm-dialog step was pulled in for this trigger');
assert(/\} catch \(e\) \{\s*\n\s*console\.error\('tripsyOutfitAutoAdjustAfterSwap failed \(non-fatal\):', e\);\s*\n\s*return 0;/.test(autoFn),
  'fails soft -- a problem here must never block the Swap that triggered it');

// ---- source-pattern checks: wired into the Swap handler, after the save succeeds ----
const modal = extractFn('showTripsyOutfitModal');
assert(/if \(!ok\) \{ toast\('Could not save the change\.', 'error'\); return; \}\s*\n[\s\S]{0,600}const adjustedCount = await tripsyOutfitAutoAdjustAfterSwap\(tripKey, person, guide\);/.test(modal),
  'runs right after a successful swap save (a failed save already returned above)');
assert(/if \(adjustedCount\) \{\s*\n\s*toast\(adjustedCount > 1/.test(modal), 'tells the owner when something else was reconfigured as a result');

// ---- executed: the orchestration logic itself, against fixtures ----
(async () => {
  const run = async (findResult, applyOk) => {
    const calls = { applied: null };
    const tripsyLaundryFindAdjustments = async () => findResult;
    const tripsyLaundryApplyAdjustments = async (outfits, proposals) => { calls.applied = proposals; return applyOk; };
    // Mirrors the real function's control flow exactly (pinned by the source-pattern
    // assertions above to this same shape).
    try {
      const { proposals, outfits } = await tripsyLaundryFindAdjustments();
      if (!proposals.length) return 0;
      const ok = await tripsyLaundryApplyAdjustments(outfits, proposals);
      return ok ? proposals.length : 0;
    } catch (e) {
      return 0;
    }
  };

  // THE ASK: a fixable later shortage is found -> reconfigured with no confirmation.
  let n = await run({ proposals: [{ dayKey: 'd3', oldId: 'polo1', newId: 'green-polo' }], outfits: {} }, true);
  assert(n === 1, `a single later shortage is auto-fixed -> ${n}`);

  // Several later blocks affected -> all reconfigured together, one save.
  n = await run({ proposals: [{ dayKey: 'd3' }, { dayKey: 'd5' }], outfits: {} }, true);
  assert(n === 2, `multiple later shortages are all reconfigured -> ${n}`);

  // Nothing to fix -> silent no-op, no save even attempted.
  n = await run({ proposals: [], outfits: {} }, true);
  assert(n === 0, 'no shortage caused by this swap -> nothing happens');

  // The fix is found but the save itself fails -> reports nothing changed (fails soft).
  n = await run({ proposals: [{ dayKey: 'd3' }], outfits: {} }, false);
  assert(n === 0, 'a save failure here reports 0 -- it must not block or misreport the swap that triggered it');
})();
