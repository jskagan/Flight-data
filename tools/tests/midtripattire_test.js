// "When an attire guide needs to be re-generated mid-trip, do it automatically trying to
// make sure that no new clothes will be needed. If none are, don't do anything. If the
// current clothes are not sufficient, present a dialog explaining what else is needed and
// why." (2026-11-09) Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
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

// ---- the pure shortfall check ----
const roles = {
  'Navy Polo': ['tops'], 'Dress Shirt': ['tops'], 'Chinos': ['pants'], 'Loafers': ['footwear'],
  'Black Tuxedo': ['pants'], 'Silk Gown': ['tops', 'pants'], 'Heels': ['footwear'],
};
const m = new Function('TRIPSY_OUTFIT_ROLES', 'tripsyOutfitGarmentRoles', 'TRIPSY_ATTIRE_CATEGORY_LABEL', 'TRIPSY_FLIGHT_WORN_ROLE_LABEL', 'tripsyDayHeaderLabel',
  `${extractFn('tripsyAttireBlockShortfall')}\n${extractFn('tripsyAttireShortfallText')}\nreturn { tripsyAttireBlockShortfall, tripsyAttireShortfallText };`)(
  ['tops', 'pants', 'footwear'], g => roles[g.name] || [], { casual: 'Casual', formal: 'Formal' },
  { tops: 'Top', pants: 'Bottoms', footwear: 'Shoes' }, k => `Day ${k}`);

const casualKit = [
  { name: 'Navy Polo', tiers: ['casual'] }, { name: 'Chinos', tiers: ['casual', 'smart_casual'] }, { name: 'Loafers', tiers: ['casual'] },
];
assert(m.tripsyAttireBlockShortfall({ category: 'casual' }, casualKit).length === 0, 'a block the packed clothes cover has no shortfall');
assert(m.tripsyAttireBlockShortfall({ category: 'formal' }, casualKit).join(',') === 'tops,pants,footwear', 'a Formal block with only casual clothes packed lacks all three pieces');
const formalKit = [...casualKit, { name: 'Dress Shirt', tiers: ['formal'] }, { name: 'Black Tuxedo', tiers: ['formal'] }];
assert(m.tripsyAttireBlockShortfall({ category: 'formal' }, formalKit).join(',') === 'footwear', 'only the missing piece (formal shoes) is named');
assert(m.tripsyAttireBlockShortfall({ category: 'formal' }, [{ name: 'Silk Gown', tiers: ['formal'] }, { name: 'Heels', tiers: ['formal'] }]).length === 0, 'a gown covers top and bottoms');
assert(m.tripsyAttireBlockShortfall({ category: 'formal' }, [{ name: 'Dress Shirt' }, { name: 'Black Tuxedo' }, { name: 'Loafers' }]).length === 3, 'an untagged garment does not count for a dress code');
const text = m.tripsyAttireShortfallText([{ person: 'him', block: { dayKey: '2030-05-03', category: 'formal', label: 'Gala Dinner' }, missing: ['footwear'] }]);
assert(/His: Day 2030-05-03 — Formal \(Gala Dinner\): no shoes packed for Formal\./.test(text), 'the dialog names who, the day, the dress code, the events and the missing piece');
assert(/Buy Clothes/.test(text) && /applied automatically/.test(text), 'the dialog explains why and what can be done');

// ---- the flow ----
const auto = extractFn('tripsyAttireAutoUpdateMidTrip');
assert(/if \(!tripsyTripInProgress\(trip\)\) return;/.test(auto), 'only while the trip is underway');
assert(/!isOwner \|\| !trip \|\| appOfflineMode \|\| tripsyTripsAreOffline/.test(auto), 'owner only, and never against cached offline data');
assert(/tripsyAttireApplyNewEvents\(guide, currentDays, picks, \{ confirmed: false \}\)/.test(auto), 'new events take the suggested tier, merged with no dialog and not marked as owner overrides');
assert(!/showTripsyAttireNewEventsDialog|tripsyRunAttireGenerationSafely/.test(auto), 'nothing is asked and the packing guidance is never regenerated');
assert(/tripsyAttireAdoptNewEventsIntoOutfits/.test(auto), 'folded-in events join the existing outfits');
assert(/tripsyGenerateOutfitsInBackground\(trip\.key, \{ persons: dressable, silent: true \}\)/.test(auto), 'covered new blocks are dressed silently in the background');
assert(/if \(shortfalls\.length\)[\s\S]*?tripsyConfirmDialog\(tripsyAttireShortfallText/.test(auto), 'a shortfall shows the explaining dialog');
assert(/tripsyAttireAutoUpdatedStates\.has\(stateKey\)/.test(auto), 'each itinerary state is handled once per session');
const shortfalls = extractFn('tripsyAttireMidTripShortfalls');
assert(/tripsyShipHomeGoneIds\(tripKey, person, b\.dayKey\)/.test(shortfalls), 'garments shipped home before the day do not count');
assert(/tripsyOutfitsUncoveredBlocks\(guide, outfits\)/.test(shortfalls), 'with outfits, only blocks no outfit covers are checked');
const apply = extractFn('tripsyAttireApplyNewEvents');
assert(/categoryOverridden: confirmed && picks\.has\(ev\.id\)/.test(apply), 'an unconfirmed pick is not an override');
assert(/if \(stale && isOwner && tripsyTripInProgress\(trip\)\) tripsyAttireAutoUpdateMidTrip\(trip\);/.test(extractFn('tripsyFlagStaleAttireButtons')), 'the My Trips staleness pass triggers it');
assert(/tripsyTripInProgress\(trip\)\)\s*\{\s*tripsyAttireAutoUpdateMidTrip\(trip\);/.test(extractFn('showTripsyAttireOverlay')), 'the Clothing Summary hands a mid-trip stale guide to it instead of asking');
const gen = extractFn('tripsyGenerateOutfitsInBackground');
assert(/\(opts\.persons \|\| \['him', 'her'\]\)/.test(gen) && /if \(!opts\.silent\) toast\('Generating outfits/.test(gen), 'the background composer takes persons and a silent flag');
