// Plan Packing List gets an "Add Garment" button: a whole-wardrobe search (His/Hers,
// Type, Dress Level) that shows matching garments with photos and an Add button,
// wiring straight into the same selection machinery the per-line garment page uses.
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
const listOnly = (html.match(/for \(const id of \['#tw-select-addgarment', '#tw-select-addline', '#tw-select-incomplete'\]\)/) || [])[0];
assert(!!listOnly, 'it is list-only, same as + Add Line and Show Incomplete -- hidden on a garment detail page');

// ---- z-index chain: dialog above the page, chooseQty above the dialog ----
const dialogFn = extractFn('tripsyWardrobeAddGarmentDialog');
assert(/ov\.style\.zIndex = '2147483100';/.test(dialogFn), 'the dialog clears the base Plan Packing List layer');
const qtyFn = extractFn('tripsyWardrobeChooseQty');
assert(/ov\.style\.zIndex = '2147483110';/.test(qtyFn),
  'the shared qty-chooser now clears the Add Garment dialog too, or a >1-availability pick would open invisibly behind it');

// ---- wiring: the caller resolves a LINE and writes through the same sel/persistChosen path ----
const packFn = extractFn('tripsyWardrobePackForTrip');
assert(/tripsyWardrobeAddGarmentDialog\(guide, garments, person\)/.test(packFn), 'opened with the current guide/garments/person');
assert(/const matchLine = linesForTier\.find\(ln => tripsyWardrobeGarmentFillsLine\(g, ln, linesForTier\)\);/.test(packFn),
  'resolves which line via the SAME fit-test the per-line garment page uses');
assert(/if \(!matchLine\) \{ toast\(/.test(packFn), 'a search result that somehow fits no line fails loudly rather than silently no-op-ing');
assert(/const key = selKey\(g\.id, picked\.tier, matchLine\.name\);/.test(packFn) && /sel\.set\(key, qty\);/.test(packFn),
  'writes into the SAME sel Map every other pick path uses -- not a separate, parallel selection mechanism');
assert(/if \(targetPerson !== person\) \{[\s\S]{0,300}renderPersonToggle\(\);/.test(packFn),
  'adding the OTHER person\'s garment switches the page to show them');

// ---- executed: the candidate filter (person + type + fits-a-line), against fixtures ----
{
  assert(/linesForTier\.some\(ln => tripsyWardrobeGarmentFillsLine\(g, ln, linesForTier\)\)/.test(dialogFn),
    'the dialog\'s own candidate filter uses this exact fit-test');
  // Re-express that same filter below and prove it against the REAL
  // tripsyWardrobeGarmentFillsLine/tripsyAttirePackingGroupOf, not a stand-in.
  const fillsSrc = extractFn('tripsyWardrobeGarmentFillsLine');
  const groupSrc = extractFn('tripsyAttirePackingGroupOf');
  const typeKeySrc = extractFn('tripsyGarmentTypeKey');
  const losesAccessorySrc = extractFn('tripsyWardrobeLosesAccessoryLine');
  const nameMatchesSrc = extractFn('tripsyWardrobeNameMatchesLine');
  const constsNeeded = ['TRIPSY_ATTIRE_PACKING_GROUPS', 'TRIPSY_GARMENT_NAME_STOPWORDS'];
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
  eval(consts + '\n' + typeKeySrc + '\n' + nameMatchesSrc + '\n' + losesAccessorySrc + '\n' + groupSrc + '\n' + fillsSrc);

  const linesForTier = [
    { name: 'Dress shirt', typeKey: 'dress-shirt', group: 'tops', need: 2 },
    { name: 'Trousers', typeKey: 'trousers', group: 'pants', need: 1 },
  ];
  const wardrobe = [
    { id: 'a', name: 'White Dress Shirt', person: 'him', group: 'tops' },
    { id: 'b', name: 'Casual Polo', person: 'him', group: 'tops' }, // wrong typeKey for the Dress shirt line
    { id: 'c', name: 'Grey Trousers', person: 'him', group: 'pants' },
    { id: 'd', name: 'Her Dress Shirt', person: 'her', group: 'tops' },
  ];
  const candidatesFor = (person, type) => wardrobe.filter(g => (g.person || 'him') === person
    && (!type || tripsyAttirePackingGroupOf(g) === type)
    && linesForTier.some(ln => tripsyWardrobeGarmentFillsLine(g, ln, linesForTier)));

  let got = candidatesFor('him', '').map(g => g.id);
  assert(got.includes('a'), 'a real dress shirt fits the Dress shirt line');
  assert(got.includes('c'), 'trousers fit the Trousers line');
  assert(!got.includes('b'), 'a polo (wrong type) fits neither line at this dress level');
  assert(!got.includes('d'), "the other person's garments are excluded");

  got = candidatesFor('him', 'pants').map(g => g.id);
  assert(got.length === 1 && got[0] === 'c', 'the Type filter narrows further, on top of the fits-a-line check');
}
