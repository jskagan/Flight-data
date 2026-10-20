// "In the packing list view, before the general section, add a section called gym
// clothes. In that section, show 5 garments: Gym Tops, Gym Shorts, Gym Pants, Socks, and
// Underwear. For gym tops, gym pants, and gym shorts, show all garments of each type marked
// as athletic, and allow the user to select as many as he wants. For socks and underwear,
// combine the number of each selected in the gym clothes section with those selected in
// general, but allow the user to put them in different packing cubes." (2026-10-19)
// Synthetic fixtures only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
function extractConst(name) {
  const start = html.indexOf(`const ${name} = `);
  if (start < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ';' && depth === 0) return html.slice(start, j + 1);
  }
}
const consts = ['TRIPSY_ATTIRE_CATEGORY_ORDER', 'TRIPSY_ATTIRE_CATEGORY_LABEL', 'TRIPSY_ATTIRE_ITEMIZED_CATEGORIES',
  'TRIPSY_ATTIRE_CAMEL_KEY', 'TRIPSY_WARDROBE_GENERAL_TIER', 'TRIPSY_FLIGHT_WORN_SUFFIX', 'TRIPSY_FLIGHT_WORN_ROLE_LABEL', 'TRIPSY_ATTIRE_PACKING_GROUPS',
  'TRIPSY_WARDROBE_GYM_TIER', 'TRIPSY_WARDROBE_GYM_LINES', 'TRIPSY_WARDROBE_OPEN_LINE_PLACEHOLDER_CAP', 'TRIPSY_WARDROBE_NEVER_PHOTOGRAPHED_TYPES',
].map(extractConst).join('\n');
const fns = ['tripsyGarmentTypeKey', 'tripsyAttirePackingGroupOf', 'tripsyAttireIsExcludedPackingItem',
  'tripsyAttireDisplayCategory', 'tripsyWardrobeFlightDepartureEvent', 'tripsyWardrobeFirstFlightBlockTier', 'tripsyWardrobeFlightWornClaimer',
  'tripsyWardrobeLineIsFlightWorn', 'tripsyWardrobePackedNeedLines', 'tripsyWardrobeGymLines', 'tripsyWardrobeNeedByTier',
  'tripsyWardrobeTierLabel', 'tripsyWardrobeGarmentEligibleForTier', 'tripsyWardrobeGarmentFillsGymLine', 'tripsyWardrobeGymEssentialTarget',
  'tripsyWardrobeGymEssentialsForGeneral', 'tripsyGarmentLineMatchType', 'tripsyWardrobeGarmentFillsLine', 'tripsyWardrobeLosesAccessoryLine',
  'tripsyWardrobeNameMatchesLine', 'tripsyGarmentNameTokens', 'tripsyGarmentNameSingular', 'tripsyWardrobeAssignGarments',
  'tripsyWardrobeLineIsNeverPhotographed', 'tripsyWearDaysGroupByDay', 'tripsyWardrobeWearDaysFromLines'].map(extractFn).join('\n');
const api = new Function('driveData', [
  "const TRIPSY_GARMENT_NAME_STOPWORDS = new Set(['for', 'and', 'the', 'with', 'set', 'pair']);",
  consts, fns,
  `return { needByTier: tripsyWardrobeNeedByTier, gymLines: tripsyWardrobeGymLines, label: tripsyWardrobeTierLabel,
    eligible: tripsyWardrobeGarmentEligibleForTier, fillsGym: tripsyWardrobeGarmentFillsGymLine, target: tripsyWardrobeGymEssentialTarget,
    forGeneral: tripsyWardrobeGymEssentialsForGeneral, fills: tripsyWardrobeGarmentFillsLine, assign: tripsyWardrobeAssignGarments,
    neverPhoto: tripsyWardrobeLineIsNeverPhotographed, wearDays: tripsyWardrobeWearDaysFromLines, GYM: TRIPSY_WARDROBE_GYM_TIER, GENERAL: TRIPSY_WARDROBE_GENERAL_TIER };`,
].join('\n'))({ tripsyTripCustomLines: {}, tripsyWardrobe: [], tripsyTripWardrobe: {} });

// ---- the five fixed lines, last in the need-line map ----
{
  const lines = api.gymLines();
  assert(lines.map(l => l.name).join(',') === 'Gym Tops,Gym Shorts,Gym Pants,Socks,Underwear', 'THE ASK: the five garments, in order');
  assert(lines.every(l => l.need === 0 && l.open === true && l.gym), 'each is OPEN -- no need, pick as many as you like');
  assert(api.label(api.GYM) === 'Gym Clothes' && api.label(api.GENERAL) === 'General', 'the section is titled Gym Clothes');
  const guide = { tripKey: 'T1', counts: { casual: 2 }, days: [{ dayKey: '2026-11-01', events: [{ id: 'e1', resource: 'activity', name: 'Dinner', category: 'casual', displayCategory: 'casual' }] }],
    packingList: { him: [{ name: 'casual tops', quantity: '3', category: 'casual', group: 'tops' }, { name: 'socks', quantity: '6', category: '', group: 'essentials' }, { name: 'underwear', quantity: '6', category: '', group: 'essentials' }] } };
  const byTier = api.needByTier(guide, 'him');
  assert(Array.isArray(byTier[api.GYM]) && byTier[api.GYM].length === 5, 'tripsyWardrobeNeedByTier carries the gym lines (so stored gym picks are never dropped as orphans)');
  assert(byTier[api.GENERAL].some(l => l.name === 'socks') && byTier[api.GENERAL].some(l => l.name === 'underwear'), 'General keeps its own socks/underwear lines');
  assert(api.needByTier({ tripKey: 'T2', days: [], packingList: { him: [] } }, 'him')[api.GYM].length === 5, 'the section exists even for a guide listing no garments');
}
// ---- what each line offers ----
{
  // The lines read the wardrobe-only GYM tag ("Add a new category before athletic called
  // 'Gym' … let me decide which ones to also include in the gym category," 2026-10-19), so an
  // athletic-tagged piece the owner did NOT tag Gym is left out.
  const g = (name, tiers, extra = {}) => ({ id: name, name, tiers, person: 'him', quantity: 1, ...extra });
  const athTee = g('Black gym tee', ['gym', 'athletic']), casTee = g('White tee', ['casual']), athOnlyTee = g('Hiking tee', ['athletic']);
  const athShorts = g('Running shorts', ['gym', 'athletic']), casShorts = g('Chino shorts', ['casual']);
  const athPants = g('Track pants', ['gym']), jeans = g('Jeans', ['casual', 'smart_casual']), swim = g('Board shorts', ['gym', 'athletic']);
  const socks = g('Socks', [], { group: 'essentials', quantity: 10 }), dressSocks = g('Dress socks', ['formal']), underwear = g('Boxer briefs', [], { group: 'essentials', quantity: 10 });
  const lines = api.gymLines();
  const [tops, shorts, pants, sock, under] = lines;
  assert(api.fills(athTee, tops, lines) && !api.fills(casTee, tops, lines) && !api.fills(athOnlyTee, tops, lines), 'THE ASK: Gym Tops offers tops tagged GYM -- not a casual tee, and not an athletic piece the owner left out of Gym');
  assert(api.fills(athShorts, shorts, lines) && !api.fills(casShorts, shorts, lines) && !api.fills(athPants, shorts, lines), 'Gym Shorts: Gym-tagged shorts only');
  assert(api.fills(athPants, pants, lines) && !api.fills(jeans, pants, lines) && !api.fills(athShorts, pants, lines) && !api.fills(swim, pants, lines), 'Gym Pants: Gym-tagged long bottoms -- never shorts or swimwear');
  // ---- the Gym tag itself ----
  const opts = new Function([extractConst('TRIPSY_WARDROBE_GENERAL_TIER'), extractConst('TRIPSY_WARDROBE_GYM_TIER'), extractConst('TRIPSY_ATTIRE_CATEGORY_ORDER'),
    'const TRIPSY_ATTIRE_CATEGORY_LABEL = { athletic: "Athletic" };', extractFn('tripsyWardrobeTierLabel'), extractFn('tripsyWardrobeTierOptions'), extractFn('tripsyWardrobeTagLabel'),
    'return { options: tripsyWardrobeTierOptions(), tag: tripsyWardrobeTagLabel };'].join('\n'))();
  assert(opts.options[0] === 'gym' && opts.options[1] === 'athletic' && opts.options[opts.options.length - 1] === 'general', 'THE ASK: the garment form lists Gym first, directly before Athletic, General still last');
  assert(opts.tag('gym') === 'Gym' && opts.tag('athletic') === 'Athletic' && opts.tag('general') === 'General', 'the tag reads "Gym" on the form (the packing section stays "Gym Clothes")');
  assert(/<label class="tw-tier-opt"><input type="checkbox" data-tw-tier="\$\{t\}" \$\{tierSet\.has\(t\) \? 'checked' : ''\}>\$\{esc\(tripsyWardrobeTagLabel\(t\)\)\}<\/label>/.test(html), 'the garment form and the bulk-edit rows render the tag label');
  assert(!/TRIPSY_ATTIRE_CATEGORY_ORDER = \['gym'/.test(html), 'Gym is NOT a dress code: the attire guide\'s own category list is untouched');
  assert(api.fills(socks, sock, lines) && !api.fills(dressSocks, sock, lines) && !api.fills(underwear, sock, lines), 'Socks: by type, no athletic tag required (essentials carry none); dress socks are a different type');
  assert(api.fills(underwear, under, lines) && !api.fills(socks, under, lines), 'Underwear: by type');
  assert(api.eligible(casTee, api.GYM) && api.eligible(casTee, api.GENERAL) && !api.eligible(casTee, 'formal'), 'the tier gate is open for Gym Clothes (the line rule does the filtering), as for General');
  assert(api.neverPhoto(sock) && api.neverPhoto(under) && !api.neverPhoto(tops), 'the socks/underwear lines count as never-photographed, so no duplicate No Picture card');
}
// ---- socks/underwear: counted on General, kept as their own entries ----
{
  const general = [{ name: 'casual socks', typeKey: 'socks', group: 'essentials', need: 6 }, { name: 'dress socks', typeKey: 'dress-socks', group: 'dress_wear', need: 2 }, { name: 'underwear', typeKey: 'underwear', group: 'essentials', need: 6 }];
  assert(api.target(general, 'Socks').name === 'casual socks', 'gym Socks count toward General\'s socks line (never the dress-socks line)');
  assert(api.target(general, 'Underwear').name === 'underwear', 'gym Underwear toward General\'s underwear line');
  assert(api.target(general, 'Gym Tops') === null && api.target([], 'Socks') === null, 'tops never cross over; no General line -> the pick stays in the gym section alone');
  const entries = [
    { id: 'S', category: 'gym', line: 'Socks', qty: 2, packed: 2, cubes: ['cubeB', 'cubeB'] },
    { id: 'S', category: 'general', line: 'casual socks', qty: 4, packed: 4, cubes: ['cubeA', 'cubeA', 'cubeA', 'cubeA'] },
    { id: 'T', category: 'gym', line: 'Gym Tops', qty: 1, packed: 0, cubes: [] },
  ];
  const extra = api.forGeneral(entries, general);
  assert(extra.length === 1 && extra[0].id === 'S' && extra[0].line === 'casual socks' && extra[0].gymLine === 'Socks' && extra[0].category === 'gym', 'THE ASK: the gym sock pick is re-addressed to General\'s line but keeps its gym identity');
  assert(extra[0].cubes.join(',') === 'cubeB,cubeB', 'THE ASK: …and its OWN cubes -- a different cube from the General pick is simply a different entry');
  // The fill math, as both packing pages run it for General: own picks + the gym extras.
  const socks = { id: 'S', name: 'Socks', group: 'essentials', quantity: 10 };
  const items = [{ g: socks, qty: 4, line: 'casual socks' }, ...extra.map(e => ({ g: socks, qty: e.qty, line: e.line }))];
  const { fill } = api.assign(general, items);
  assert(fill[0] === 6, 'THE ASK: General\'s socks Selected = 4 general + 2 gym = 6 ("combine the number")');
}
// ---- wear days: the gym is on no itinerary ----
{
  const guide = { days: [{ dayKey: '2026-11-01', events: [{ id: 'e1', category: 'casual', displayCategory: 'casual' }] }], packingList: { him: [] } };
  const r = api.wearDays(guide, 'him', [{ category: 'gym', line: 'Socks' }], 'Socks');
  assert(r.days.length === 0 && r.basis === 'gym', 'a Gym Clothes allocation has no known wear days (never "worn every day" like General socks)');
}
// ---- the pages ----
{
  const plan = extractFn('tripsyWardrobePackForTrip');
  assert(/if \(\(needLines\[TRIPSY_WARDROBE_GYM_TIER\] \|\| \[\]\)\.length > 0\) t\.push\(TRIPSY_WARDROBE_GYM_TIER\);\n\s*if \(\(needLines\[TRIPSY_WARDROBE_GENERAL_TIER\] \|\| \[\]\)\.length > 0\) t\.push\(TRIPSY_WARDROBE_GENERAL_TIER\);/.test(plan),
    'THE ASK: on the Packing List the Gym Clothes section comes directly before General');
  assert(/packedForTier\.push\(\.\.\.tripsyWardrobeGymEssentialsForGeneral\(allEntries, lines\)/.test(plan), 'the Packing List counts gym socks/underwear on General\'s lines');
  assert(/tripsyWardrobeGarmentEligibleForTier\(x\.g, tier\)/.test(plan) && /tripsyWardrobeGarmentEligibleForTier\(g, tier\) && tripsyWardrobeGarmentFillsLine\(g, ln, lines\)/.test(plan), 'the tier gate goes through the shared helper on both the fill math and the garment page');
  assert(/const neededCell = ln\.open \? '<span style="color:var\(--muted\); font-weight:600;">any<\/span>'/.test(plan) && /pick as many as you like/.test(plan), 'THE ASK: an open line reads "any" and invites any number');
  assert(/if \(ln\.open\) return; totSel \+= ln\.selected;/.test(plan), 'open lines never count toward the trip-wide Selected/Needed');
  assert(/incl\. \$\{gymCounted\} from Gym Clothes \(needed \+\$\{gymCounted\}\)/.test(plan), 'General\'s socks/underwear page says how many came from Gym Clothes');
  // "for each socks and underwear that the user selects from the gym clothes section, add 1
  // to the 'needed' column for that garment" (2026-10-19, same day).
  assert(/const effectiveNeed = Math\.max\(0, ln\.need - skipped\) \+ gymExtraFor\(tier, ln\);/.test(plan), 'THE ASK: each gym sock/underwear pick adds 1 to General\'s Needed on the Packing List');
  assert(/const gymExtraFor = \(tier, ln\) => \{\n\s*if \(tier !== TRIPSY_WARDROBE_GENERAL_TIER\) return 0;/.test(plan), 'only General lines are raised');
  assert(/const effectiveNeed = \(tier, ln\) => Math\.max\(0, ln\.need - tripsyAttireSkippedFor\(skips, person, tier, ln\)\) \+ gymExtraFor\(tier, ln\);/.test(extractFn('tripsyWardrobePackingList')),
    'Packing Status raises Needed the same way, so the two pages agree');
  assert(/lnHere\.open \? TRIPSY_WARDROBE_OPEN_LINE_PLACEHOLDER_CAP : tripsyWardrobePlaceholderCap\(lnHere\.need\)/.test(plan), 'a placeholder on an open line is not capped by a need of zero');
  const status = extractFn('tripsyWardrobePackingList');
  assert(/const TIER_ROWS = \[\.\.\.TRIPSY_ATTIRE_CATEGORY_ORDER\.slice\(\)\.reverse\(\), TRIPSY_WARDROBE_GYM_TIER, TRIPSY_WARDROBE_GENERAL_TIER\];/.test(status), 'Packing Status lists Gym Clothes before General too');
  assert(/items\.push\(\.\.\.tripsyWardrobeGymEssentialsForGeneral\(selEntries, needLines\[tier\] \|\| \[\]\)/.test(status) && /entryLine: e\.gymLine, fromGym: true/.test(status),
    'Packing Status shows the gym socks/underwear picks on General\'s pages as their own entries');
  // "The packing status page layout for gym clothes should match the packing list page"
  // (2026-10-20): all five gym rows list on Packing Status too (the first cut hid the gym
  // Socks/Underwear rows there).
  assert(!/statusLineHidden/.test(status), 'THE ASK: Packing Status lists every Gym Clothes line, as the Packing List does -- no row is hidden');
  assert(/data-tw-entry-cat="\$\{esc\(entryCategory \|\| ''\)\}" data-tw-entry-line="\$\{esc\(entryLine \|\| ''\)\}"/.test(status)
    && /markGarmentPacked\(gEl\.getAttribute\('data-tw-detail-garment'\), gEl\.getAttribute\('data-tw-entry-cat'\), gEl\.getAttribute\('data-tw-entry-line'\)\)/.test(status)
    && /const exact = selEntries\.find\(x => x\.id === id && x\.category === entryCategory && x\.line === entryLine\);/.test(status),
    'THE ASK: a tap packs EXACTLY that entry, so the gym socks go into their own cube beside the General socks');
  assert(/from Gym Clothes<\/div>/.test(status), 'the card says it is the Gym Clothes pick');
  assert(/\$\{selected\}\/\$\{ln\.open \? 'any' : need\}/.test(status), 'the open line\'s header reads N/any');
  assert(/if \(e\.category === TRIPSY_WARDROBE_GYM_TIER\) continue; qtyById\.set/.test(extractFn('tripsyShipHomeCandidates')), 'Ship Home never recommends gym clothes (their wear days are unknown)');
  assert(/for \(const tier of TRIPSY_ATTIRE_CATEGORY_ORDER\) \{ \/\/ dress codes only -- General excluded/.test(extractFn('tripsyPlanPackingIsComplete')), 'an empty gym section never holds the Packing List back from "complete"');
}
