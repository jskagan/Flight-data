// "After a wash is done, have the app re-calculate any additional wash days that are
// necessary on the trip. If adjustments can be made to daily outfits to avoid the need
// for another wash day or minimize the number of wash days needed, make those
// adjustments." Per the owner's explicit choice, adjustments are PROPOSED for approval
// (tripsyLaundryAdjustmentsDialog), never applied silently. tripsyLaundryFindAdjustments
// mirrors tripsyLaundryRunOutByDay's own wear-limit walk (garment by garment, day by
// day), but instead of just flagging a short day, looks for a real fix: is the garment
// even part of a COMPOSED outfit block that day (a tier-fallback wear day has nothing to
// swap within), and if so, is there a substitute through the SAME tripsyOutfitSwapCandidates
// rule Swap itself uses -- so a proposal here is always something the owner could
// equally have picked by hand.
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

// ---- the initial guide-generation prompt also biases toward fewer/later suggested
// washes, not just the reactive post-wash adjustment logic below ----
assert(/prefer FEWER, LATER washes over an evenly-spaced schedule/.test(html),
  'the laundry_days prompt instruction now says so explicitly');
assert(/Dirty laundry at the END of the trip is completely fine/.test(html),
  'and states the actual goal -- ending the trip with dirty laundry is fine, a mid-trip wash is the thing to avoid');
assert(/~9 days is a MAXIMUM cadence to plan around, not a target to hit/.test(html),
  'the old fixed "~every 9 days" cadence is now framed as an upper bound, not a schedule to fill');

// ---- source-pattern checks ----
const findSrc = extractFn('tripsyLaundryFindAdjustments');
assert(/if \(!\(limit > 0\) \|\| !isFinite\(limit\)\) continue; \/\/ can never go dirty -- nothing to fix/.test(findSrc),
  'a garment that can never go dirty (ties, tailoring, ...) is skipped outright');
assert(/const block = \(outfits\.blocks \|\| \[\]\)\.find\(b => b\.dayKey === dayKey && \(b\.garmentIds \|\| \[\]\)\.includes\(id\)\);/.test(findSrc),
  'only a garment actually part of a COMPOSED block that day is even attempted');
assert(/const \{ candidates \} = await tripsyOutfitSwapCandidates\(tripKey, block, id, person, liveTier\);/.test(findSrc),
  'candidates come from the exact same rule Swap itself uses');
assert(/const usableCandidates = candidates\.filter\(c => !claimed\.has\(c\.id\)\);/.test(findSrc),
  'a candidate already claimed by an earlier proposal this pass is not offered twice');
assert(/withWear\.sort\(\(a, b\) => a\.wornSoFar - b\.wornSoFar\);/.test(findSrc),
  'THE ASK: candidates are ranked by wear so far, least-worn first -- spreading wear evenly rather than favoring one garment');
assert(/usable = withWear\[0\]\.c;/.test(findSrc), 'and the least-worn candidate is the one actually proposed');
assert(/break; \/\/ one fix attempt per garment/.test(findSrc), 'only the first short day per garment is attempted');

const applySrc = extractFn('tripsyLaundryApplyAdjustments');
assert(/const i = \(p\.block\.garmentIds \|\| \[\]\)\.indexOf\(p\.oldId\);/.test(applySrc), 'applies by finding the old garment\'s slot in the live block');
assert(/if \(i >= 0\) p\.block\.garmentIds\[i\] = p\.newId;/.test(applySrc), 'and replacing it in place, exactly like a manual Swap pick');
assert(/return await Store\.saveTripsyTripOutfits\(outfits\);/.test(applySrc), 'then saves the whole outfits doc once, for every proposal together');

const dialogSrc = extractFn('tripsyLaundryAdjustmentsDialog');
assert(/data-adjust-skip/.test(dialogSrc) && /data-adjust-apply/.test(dialogSrc), 'the dialog offers Skip and Apply');
assert(/if \(e\.target === ov \|\| e\.target\.closest\('\[data-adjust-skip\]'\)\) \{ done\(false\); return; \}/.test(dialogSrc),
  'Skip (or tapping outside) resolves false -- nothing gets applied');

// ---- wiring: Wash Now triggers the whole flow, owner-only, proposal-gated ----
const laundryDay = extractFn('showTripsyLaundryDay');
const washBlock = laundryDay.slice(laundryDay.indexOf('[data-laundry-wash]'), laundryDay.indexOf('[data-laundry-unpick]'));
assert(/if \(isOwner\) \{/.test(washBlock), 'only the owner triggers this (writing outfits needs write access)');
assert(/const \{ proposals, outfits \} = await tripsyLaundryFindAdjustments\(tripKey, person, guide\);/.test(washBlock),
  'Wash Now runs the adjustment finder');
assert(/if \(!proposals\.length\) return;/.test(washBlock), 'nothing found -> no dialog, no interruption');
assert(/const accepted = await tripsyLaundryAdjustmentsDialog\(proposals\);/.test(washBlock),
  'THE ASK: adjustments are PROPOSED for approval, never applied silently');
assert(/if \(!accepted\) return;/.test(washBlock), 'declining leaves outfits untouched');
assert(/const ok = await tripsyLaundryApplyAdjustments\(outfits, proposals\);/.test(washBlock), 'accepting applies them');
assert(/if \(opts\.onChanged\) opts\.onChanged\(\);/.test(washBlock.slice(washBlock.indexOf('tripsyLaundryApplyAdjustments'))),
  'and refreshes the guide\'s run-out bar afterward, same callback the rest of the laundry flow uses');

// ---- executed: tripsyLaundryFindAdjustments' own orchestration, against fixtures ----
// (tripsyWardrobeWearDays and tripsyOutfitSwapCandidates are stubbed -- both are
// covered by their own test files; this exercises the walk + block-lookup + proposal
// logic that's unique to this function.)
(async () => {
  eval(extractFn('tripsyLaundryWearDebtStep').replace(/^function tripsyLaundryWearDebtStep/, 'var tripsyLaundryWearDebtStep = function'));
  eval(findSrc.replace(/^async function tripsyLaundryFindAdjustments/, 'var tripsyLaundryFindAdjustments = async function'));

  const guide = { days: [{ dayKey: 'd1' }, { dayKey: 'd2' }, { dayKey: 'd3' }] };
  const blockD1 = { dayKey: 'd1', garmentIds: ['polo1'] };
  const blockD3 = { dayKey: 'd3', garmentIds: ['polo1'] };
  let outfitsFixture = { blocks: [blockD1, blockD3] };
  let wearDaysFor = { polo1: ['d1', 'd3'] }; // worn twice, one owned copy, one-wear limit -> short on d3
  let washesFixture = [];
  let swapCandidatesFor = { polo1: [{ id: 'green-polo', name: 'Green Polo' }] };

  const Store = {
    getTripsyTripOutfits: async () => outfitsFixture,
    listTripsyLaundry: () => washesFixture,
    listLaundryNotDirty: () => [],
    listWardrobe: async () => [{ id: 'polo1', name: 'Blue Polo', person: 'him', group: 'tops' }],
    getTripWardrobe: async () => [{ id: 'polo1', qty: 1 }],
  };
  const tripsyNormalizeTripSelection = sel => sel;
  const tripsyWearsBeforeWash = () => 1; // a top: one wearing before dirty
  const tripsyWardrobeWearDays = async (tripKey, id) => ({ days: (wearDaysFor[id] || []).map(dayKey => ({ dayKey })) });
  const tripsyOutfitBlockLiveTier = () => 'casual';
  const tripsyOutfitSwapCandidates = async (tripKey, block, id) => ({ candidates: swapCandidatesFor[id] || [] });

  let { proposals } = await tripsyLaundryFindAdjustments('T', 'him', guide);
  assert(proposals.length === 1, `THE ASK: a fixable short day is found and proposed -> ${proposals.length}`);
  assert(proposals[0].dayKey === 'd3' && proposals[0].oldId === 'polo1' && proposals[0].newId === 'green-polo',
    'the proposal names the right day, the short garment, and its substitute -> ' + JSON.stringify(proposals[0]));
  assert(proposals[0].block === blockD3, 'the proposal carries a LIVE reference to the actual block (so apply can mutate it directly)');

  // No composed block on the short day (a tier-fallback wear day) -> nothing to
  // propose, even though the garment is genuinely short.
  outfitsFixture = { blocks: [blockD1] }; // no block on d3 at all
  ({ proposals } = await tripsyLaundryFindAdjustments('T', 'him', guide));
  assert(proposals.length === 0, 'a short day with no composed block to swap within proposes nothing');
  outfitsFixture = { blocks: [blockD1, blockD3] }; // restore

  // No substitute available -> nothing to propose either; this stays a real run-out.
  swapCandidatesFor = { polo1: [] };
  ({ proposals } = await tripsyLaundryFindAdjustments('T', 'him', guide));
  assert(proposals.length === 0, 'no usable substitute -> no proposal, the run-out bar is the honest answer');
  swapCandidatesFor = { polo1: [{ id: 'green-polo', name: 'Green Polo' }] }; // restore

  // A wash between d1 and d3 clears the shortage entirely -> nothing left to fix.
  washesFixture = [{ dayKey: 'd2', washedAt: '2026-08-01T00:00:00Z', person: 'him', bag: { 'g:polo1': 1 } }];
  ({ proposals } = await tripsyLaundryFindAdjustments('T', 'him', guide));
  assert(proposals.length === 0, 'a wash that already covers the shortage means nothing to propose');
  washesFixture = []; // restore

  // THE ASK: "maximize dirty clothes at the end of the trip" -- with several usable
  // candidates, the LEAST-worn-so-far one is picked, spreading wear evenly rather than
  // reusing a favorite. A pristine, never-worn candidate beats one already worn twice.
  swapCandidatesFor = { polo1: [{ id: 'worn-polo', name: 'Worn Polo' }, { id: 'fresh-polo', name: 'Fresh Polo' }] };
  wearDaysFor = { polo1: ['d1', 'd3'], 'worn-polo': ['d1', 'd2'], 'fresh-polo': [] };
  ({ proposals } = await tripsyLaundryFindAdjustments('T', 'him', guide));
  assert(proposals.length === 1 && proposals[0].newId === 'fresh-polo',
    'the never-worn candidate is preferred over one already worn twice -> ' + (proposals[0] && proposals[0].newId));
})();
