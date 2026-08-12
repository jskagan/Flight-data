// Plan Packing List's "Add Garment" button: a whole-wardrobe search (His/Hers, Type,
// Dress Level) that shows matching garments with photos and an Add button.
//
// THE BUG JUST REPORTED: cocktail suits weren't showing up under Type=Any,
// Dress Level=Cocktail for a real trip. Root cause -- the search originally matched
// against the tier's CURRENT ACTIVE need lines (tripsyWardrobeGarmentFillsLine against
// linesForTier), but tripsyWardrobeNeedByTier deliberately DROPS a tier's blazer+
// trousers lines once a packed suit already covers that tier (a suit packed for
// Formal also dresses Cocktail nights, so Cocktail asks for no separate jacket). That
// business rule is correct for "what's still needed", but Add Garment is a BROWSE
// tool, not a needed-items tool -- with the lines dropped, NO suit could ever match,
// even ones the owner hasn't packed yet. Fixed to match on the garment's own TIER TAGS
// directly (g.tiers.includes(tier)), independent of what's currently packed elsewhere.
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

// ---- the button exists, and hides on the garment sub-page like its siblings ----
assert(/<button class="btn" id="tw-select-addgarment">Add Garment<\/button>/.test(html),
  'the button is in the static Plan Packing List shell');
assert(/for \(const id of \['#tw-select-addgarment', '#tw-select-addline', '#tw-select-incomplete'\]\)/.test(html),
  'it is list-only, same as + Add Line and Show Incomplete -- hidden on a garment detail page');

// ---- z-index chain: dialog above the page, chooseQty above the dialog ----
const dialogFn = extractFn('tripsyWardrobeAddGarmentDialog');
assert(/ov\.style\.zIndex = '2147483100';/.test(dialogFn), 'the dialog clears the base Plan Packing List layer');
const qtyFn = extractFn('tripsyWardrobeChooseQty');
assert(/ov\.style\.zIndex = '2147483110';/.test(qtyFn),
  'the shared qty-chooser clears the Add Garment dialog too, or a >1-availability pick would open invisibly behind it');

// ---- the dialog's OWN filter: matches tier TAGS, not active need lines ----
assert(/\(tier === TRIPSY_WARDROBE_GENERAL_TIER \|\| \(g\.tiers \|\| \[\]\)\.includes\(tier\)\)/.test(dialogFn),
  'candidates are matched on the garment\'s own tier tags');
assert(!/linesForTier\.some\(ln => tripsyWardrobeGarmentFillsLine/.test(dialogFn),
  'the old need-line fit-test is gone from the search filter -- that was the bug');

// ---- wiring: the caller still resolves a specific LINE to allocate against, with a
// fallback for a tier whose need for this garment's type was dropped elsewhere ----
const packFn = extractFn('tripsyWardrobePackForTrip');
assert(/tripsyWardrobeAddGarmentDialog\(guide, garments, person\)/.test(packFn), 'opened with the current guide/garments/person');
assert(/let matchLine = linesForTier\.find\(ln => tripsyWardrobeGarmentFillsLine\(g, ln, linesForTier\)\);/.test(packFn),
  'tries the tier\'s ACTIVE lines first -- the common, everyday case');
assert(/const fallbackName = TRIPSY_GARMENT_TYPE_LABEL\[gType\] \|\| TRIPSY_ATTIRE_PACKING_GROUP_LABEL\[tripsyAttirePackingGroupOf\(g\)\] \|\| 'Other';/.test(packFn),
  'falls back to a TYPE-derived line name (general-purpose, not suit-specific) when no active line matches');
assert(/matchLine = \{ name: fallbackName, need: 1 \};/.test(packFn) && /usedFallbackLine = true;/.test(packFn),
  'the fallback still produces a real line to allocate against, flagged so the toast can explain it');
assert(!/Could not find a matching line for that garment/.test(packFn),
  'Add no longer fails outright on a dropped-line garment -- that was exactly the reported case');
assert(/const key = selKey\(g\.id, picked\.tier, matchLine\.name\);/.test(packFn) && /sel\.set\(key, qty\);/.test(packFn),
  'writes into the SAME sel Map every other pick path uses -- not a separate, parallel selection mechanism');
assert(/if \(targetPerson !== person\) \{[\s\S]{0,300}renderPersonToggle\(\);/.test(packFn),
  "adding the OTHER person's garment switches the page to show them");
assert(/toast\(usedFallbackLine\s*\n\s*\? `Added/.test(packFn),
  'the success toast explains the fallback case differently from an ordinary add');

// ---- executed: the search filter itself, against fixtures modeling the real bug ----
{
  const TRIPSY_WARDROBE_GENERAL_TIER = 'general';
  const groupSrc = extractFn('tripsyAttirePackingGroupOf');
  const constsNeeded = ['TRIPSY_ATTIRE_PACKING_GROUPS'];
  const consts = constsNeeded.map(n => {
    const s = html.indexOf(`const ${n} = `);
    let depth = 0;
    for (let j = s; j < html.length; j++) {
      const c = html[j];
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
      else if (c === ';' && depth === 0) return html.slice(s, j + 1);
    }
  }).join('\n');
  eval(consts + '\n' + groupSrc);

  const wardrobe = [
    // The exact reported scenario: a cocktail-tagged suit, with Cocktail's own
    // blazer/trousers lines already dropped elsewhere (irrelevant to this filter now).
    { id: 'suit1', name: 'Navy Suit', person: 'him', group: 'dress_wear', tiers: ['cocktail', 'formal'] },
    { id: 'suit2', name: 'Brown Suit', person: 'him', group: 'dress_wear', tiers: ['semi_formal', 'cocktail'] },
    { id: 'casual', name: 'Casual Polo', person: 'him', group: 'tops', tiers: ['casual'] }, // not cocktail-tagged
    { id: 'her-suit', name: 'Her Cocktail Dress', person: 'her', group: 'dress_wear', tiers: ['cocktail'] },
    { id: 'untagged', name: 'Mystery Jacket', person: 'him', group: 'dress_wear', tiers: [] },
  ];
  const candidatesFor = (person, type, tier) => wardrobe.filter(g => (g.person || 'him') === person
    && (!type || tripsyAttirePackingGroupOf(g) === type)
    && (tier === TRIPSY_WARDROBE_GENERAL_TIER || (g.tiers || []).includes(tier)));

  let got = candidatesFor('him', '', 'cocktail').map(g => g.id);
  assert(got.includes('suit1') && got.includes('suit2'),
    'THE FIX: both cocktail suits now appear, independent of whether Cocktail has an active blazer/trousers line');
  assert(!got.includes('casual'), 'a garment not tagged for this tier is still excluded');
  assert(!got.includes('her-suit'), "the other person's garments are still excluded");
  assert(!got.includes('untagged'), 'an untagged garment (empty tiers) does not show for a specific dress level');

  got = candidatesFor('him', 'dress_wear', 'cocktail').map(g => g.id);
  assert(got.length === 2, 'the Type filter still narrows further, on top of the tier-tag match');

  got = candidatesFor('him', '', 'general').map(g => g.id);
  assert(got.includes('untagged'), 'General matches everything for that person, tags or not -- same as Pack-for-tier');
}

// ---- executed: the fallback line-name derivation, against the real TYPE label map ----
{
  const typeKeySrc = extractFn('tripsyGarmentTypeKey');
  const groupSrc = extractFn('tripsyAttirePackingGroupOf');
  // `const` from a direct eval() is scoped to the eval CALL itself, invisible outside
  // it even within the same block -- swap to `var` so these actually leak out.
  const asVar = s => s.replace(/^const /, 'var ');
  const labelConst = asVar(html.slice(html.indexOf('const TRIPSY_GARMENT_TYPE_LABEL'), html.indexOf(';', html.indexOf('const TRIPSY_GARMENT_TYPE_LABEL')) + 1));
  const groupLabelConst = asVar(html.slice(html.indexOf('const TRIPSY_ATTIRE_PACKING_GROUP_LABEL'), html.indexOf(';', html.indexOf('const TRIPSY_ATTIRE_PACKING_GROUP_LABEL')) + 1));
  const groupsConst = asVar(html.slice(html.indexOf('const TRIPSY_ATTIRE_PACKING_GROUPS'), html.indexOf(';', html.indexOf('const TRIPSY_ATTIRE_PACKING_GROUPS')) + 1));
  eval(groupsConst + '\n' + groupLabelConst + '\n' + labelConst + '\n' + typeKeySrc + '\n' + groupSrc);

  const fallbackNameFor = g => {
    const gType = tripsyGarmentTypeKey(g.name || '');
    return TRIPSY_GARMENT_TYPE_LABEL[gType] || TRIPSY_ATTIRE_PACKING_GROUP_LABEL[tripsyAttirePackingGroupOf(g)] || 'Other';
  };
  assert(fallbackNameFor({ name: 'Navy Blue Tom Ford Mohair Suit', group: 'dress_wear' }) === 'Suits',
    'a suit falls back to the same "Suits" line real guides already use for that type');
  assert(fallbackNameFor({ name: 'Silk Tie', group: 'dress_wear' }) === 'Ties', 'general-purpose -- works for any type, not just suits');
}
