// "Is there a way to improve the whole generation process? The app says it can take a
// minute, but it always takes much longer." The guidance call (~100s+, the long pole of
// every attire generation) re-ran on EVERY pre-trip Refresh even when nothing
// packing-relevant had changed. It sizes every quantity off exactly two authoritative
// inputs -- the per-tier occasion counts and the tier-tagged time-blocks (tier + span)
// -- so generateTripsyAttireGuide now fingerprints those (guidanceFingerprint, saved on
// the guide) and, when unchanged, carries personGuidance/packingList/laundryDays over
// verbatim instead of re-running the slow call. Event names and weather are
// deliberately NOT fingerprinted: a retitle or a forecast wobble must not cost two
// minutes. Also: the static "can take a minute" message under-promised and read as
// hung; generateTripsyAttireGuide now reports live stages via onStage, rendered as a
// progress line in the overlay, with honest 2-3 minute framing.
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

const genFn = extractFn('generateTripsyAttireGuide');
assert(genFn.includes('runGuidancePhase'), 'sanity: extracted the real function');

// ---- source-pattern checks: the guidance-input fingerprint ----
assert(/guidanceFp = tripsyContentFingerprint\(\{\s*\n\s*tierCounts,\s*\n\s*blocks: tieredBlocks\.map\(b => \(\{ date: b\.date, tier: b\.tier, spanHours: b\.spanHours != null \? b\.spanHours : null \}\)\),\s*\n\s*\}\);/.test(genFn),
  'the fingerprint covers exactly what the guidance call sizes from: tier counts + each block\'s date/tier/span -- NOT event names or weather');
assert(/if \(existing && existing\.personGuidance && existing\.packingList && existing\.guidanceFingerprint === guidanceFp\) \{/.test(genFn),
  'THE FIX: matching fingerprint (with a real saved guidance+list to reuse) skips the slow guidance call');
assert(/if \(preservePacking\) return null;/.test(genFn),
  'the started-trip preservePacking path still short-circuits first, unchanged');
assert(/guidanceReused = true;/.test(genFn), 'reuse is tracked so the guide assembly can branch on it');
// BOTH branches (events unchanged / events changed) go through the one shared phase
// helper, so the reuse logic can never drift between them.
const phaseCalls = (genFn.match(/await runGuidancePhase\(tieredBlocks, tierCounts\)/g) || []).length;
assert(phaseCalls === 2, `both generation branches share the one runGuidancePhase helper -> ${phaseCalls} call sites`);

// ---- source-pattern checks: what a reuse carries over ----
assert(/laundryDays: \(preservePacking \|\| guidanceReused\) \? \(existing\.laundryDays \|\| \[\]\) : laundryDays,/.test(genFn),
  'a reuse carries laundryDays over verbatim, same as the started-trip path');
assert(/packingList: \(preservePacking \|\| guidanceReused\) \? existing\.packingList : \{ him: buildPackingList\('him'\), her: buildPackingList\('her'\) \},/.test(genFn),
  'and the packing list VERBATIM (picks/skips are keyed by tier + line NAME -- re-minting would strand them)');
assert(/guidanceFingerprint: guidanceFp,/.test(genFn),
  'the fingerprint is saved on the guide, so the chain holds across successive refreshes');
assert(/packingFrozen: preservePacking \|\| undefined,/.test(genFn),
  'packingFrozen stays tied to the trip having STARTED only -- a pre-trip reuse does not freeze anything');

// ---- source-pattern checks: live stage reporting + honest wording ----
assert(/async function generateTripsyAttireGuide\(tripKey, \{ onStage \} = \{\}\)/.test(html),
  'generateTripsyAttireGuide takes an optional onStage callback (existing callers unaffected)');
assert(/stage\('Categorizing events by dress code…'\);/.test(genFn), 'the events phase reports itself');
assert(/stage\('Writing the packing guidance — the slow step, typically 1–2 minutes…'\);/.test(genFn),
  'the slow phase says so honestly, with a real time estimate');
assert(/stage\('Packing needs unchanged — keeping the saved packing list…'\);/.test(genFn),
  'a reuse tells the owner why this run is fast');
const runGen = extractFn('runTripsyAttireGeneration');
assert(/data-attire-stage/.test(runGen), 'the overlay loading state has a live stage line');
assert(/const el = content\.querySelector\('\[data-attire-stage\]'\);\s*\n\s*if \(el\) el\.textContent = text;/.test(runGen),
  'onStage updates it in place as each phase starts');
assert(!/this can take a minute…/.test(runGen),
  'the old under-promising "can take a minute" toast wording is gone');
assert(/typically 2–3 minutes/.test(runGen), 'replaced with the honest full-generation estimate');

// ---- executed: the reuse decision + fingerprint sensitivity, against fixtures ----
{
  eval(extractFn('tripsyContentFingerprint').replace(/^function tripsyContentFingerprint/, 'var tripsyContentFingerprint = function'));
  const fpOf = (tierCounts, tieredBlocks) => tripsyContentFingerprint({
    tierCounts,
    blocks: tieredBlocks.map(b => ({ date: b.date, tier: b.tier, spanHours: b.spanHours != null ? b.spanHours : null })),
  });
  const decide = (preservePacking, existing, guidanceFp) => {
    if (preservePacking) return 'skip-frozen';
    if (existing && existing.personGuidance && existing.packingList && existing.guidanceFingerprint === guidanceFp) return 'reuse';
    return 'call';
  };

  const blocksA = [
    { date: 'd1', tier: 'casual', spanHours: 3, events: [{ id: 'e1', name: 'Walking Tour' }] },
    { date: 'd1', tier: 'formal', events: [{ id: 'e2', name: 'Gala' }] },
  ];
  const countsA = { casual: 1, formal: 1 };
  const fpA = fpOf(countsA, blocksA);
  const savedGuide = { personGuidance: { him: {} }, packingList: { him: [] }, guidanceFingerprint: fpA };

  // THE ASK: an event retitle (same tiers/spans/counts) -> fingerprint unchanged -> no slow call.
  const retitled = [
    { date: 'd1', tier: 'casual', spanHours: 3, events: [{ id: 'e1', name: 'RENAMED Tour' }] },
    { date: 'd1', tier: 'formal', events: [{ id: 'e2', name: 'Gala' }] },
  ];
  assert(fpOf(countsA, retitled) === fpA, 'a pure retitle leaves the fingerprint unchanged -- names are deliberately not fingerprinted');
  assert(decide(false, savedGuide, fpOf(countsA, retitled)) === 'reuse',
    'THE ASK: a refresh after a retitle reuses the saved guidance instead of a ~2-minute call');

  // A tier actually moving DOES invalidate -- the packing needs genuinely changed.
  const tierMoved = [
    { date: 'd1', tier: 'smart_casual', spanHours: 3, events: [{ id: 'e1', name: 'Walking Tour' }] },
    { date: 'd1', tier: 'formal', events: [{ id: 'e2', name: 'Gala' }] },
  ];
  assert(fpOf({ smart_casual: 1, formal: 1 }, tierMoved) !== fpA, 'a moved tier changes the fingerprint');
  assert(decide(false, savedGuide, fpOf({ smart_casual: 1, formal: 1 }, tierMoved)) === 'call',
    'a real dress-code change still re-runs the guidance call');

  // A changed span (the short-wearing re-wear rule reads it) invalidates too.
  const spanMoved = [
    { date: 'd1', tier: 'casual', spanHours: 8, events: [{ id: 'e1', name: 'Walking Tour' }] },
    { date: 'd1', tier: 'formal', events: [{ id: 'e2', name: 'Gala' }] },
  ];
  assert(fpOf(countsA, spanMoved) !== fpA, 'a changed block span changes the fingerprint (it feeds the <=4h re-wear rule)');

  // First generate (no saved guide) and a pre-fingerprint guide both still call.
  assert(decide(false, null, fpA) === 'call', 'a first generate always runs the call');
  assert(decide(false, { personGuidance: { him: {} }, packingList: {} }, fpA) === 'call',
    'a guide saved before guidanceFingerprint existed re-runs once (and records the fingerprint for next time)');

  // The started-trip freeze still wins outright.
  assert(decide(true, savedGuide, 'anything') === 'skip-frozen', 'preservePacking still short-circuits everything, unchanged');
}
