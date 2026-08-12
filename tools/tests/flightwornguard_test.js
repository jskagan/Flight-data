// A flight-worn companion line (need is always exactly 1 -- you can only wear one top
// on the plane) must never be satisfied by BOTH a real garment pick and a generic
// placeholder at once: each was being independently wear-tracked as if it were a
// separate one-wear garment, so having both doubled the projected need and produced a
// false pair of "you're out of X" warnings on the same day for the SAME physical
// shortage -- found on a real trip 2026-08-11, where a real garment (a Henley shirt)
// picked for "Top -- wearing on the flight" coexisted with a leftover generic
// placeholder for the identical line. Two entry points let the owner pick a garment or
// a generic for this line -- the Plan Packing List page (tripsyWardrobePackForTrip) and
// the category drill-down's own pack panel (showTripsyAttireCategoryEvents) -- so both
// needed the guard.
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

const f1 = extractFn('tripsyWardrobePackForTrip');
const f2 = extractFn('showTripsyAttireCategoryEvents');

// ---- Site 1: Plan Packing List ----
assert(/if \(existing\) existing\.qty \+= n; else generics\.push\(\{ category: view\.tier,[\s\S]{0,700}if \(ln\.flightWorn\) \{[\s\S]{0,250}sel\.delete\(k\); packedByKey\.delete\(k\); \}[\s\S]{0,120}persistChosen\(\);/.test(f1),
  'adding a generic to a flight-worn line clears the matching real picks, then persists both');
assert(/sel\.set\(key, qty\);\s*\n\s*\/\/ Mirror of the generic-add guard[\s\S]{0,250}if \(lnHere\.flightWorn\) \{[\s\S]{0,250}generics = generics\.filter\([\s\S]{0,150}persistGenerics\(\);/.test(f1),
  'picking a real garment for a flight-worn line clears the matching generic, then persists both');

// ---- Site 2: category drill-down pack panel ----
assert(/if \(existing\) existing\.qty \+= n; else generics\.push\(\{ category, typeKey, name,[\s\S]{0,300}if \(lnForName && lnForName\.flightWorn\) \{[\s\S]{0,250}sel\.delete\(k\); packedByKey\.delete\(k\); \}[\s\S]{0,80}persistChosen\(\);/.test(f2),
  'site 2: adding a generic to a flight-worn line clears the matching real picks');
assert(/sel\.set\(key, qty\);\s*\n\s*if \(lnHere && lnHere\.flightWorn\) \{[\s\S]{0,200}generics = generics\.filter\([\s\S]{0,150}persistGenerics\(\);/.test(f2),
  'site 2: picking a real garment for a flight-worn line clears the matching generic');

// ---- The scoping predicates themselves, executed against synthetic data ----
// A non-flight-worn line must be completely unaffected -- over-selection (real +
// generic together) is INTENTIONAL there (tripsyWardrobePlaceholderCap deliberately
// allows need+2), so the guard must never fire outside flightWorn:true lines.
{
  const parseSelKey = k => {
    const i = k.indexOf('::'); const j = k.indexOf('::', i + 2);
    return { id: k.slice(0, i), category: k.slice(i + 2, j), line: k.slice(j + 2) };
  };
  const selKey = (id, cat, line) => `${id}::${cat}::${line || ''}`;

  // Adding a generic to a flight-worn line clears ONLY that line's real picks --
  // same tier+name+person, leaving every other line/person/tier untouched.
  let sel = new Map([
    [selKey('henley', 'casual', 'Top — wearing on the flight'), 1],
    [selKey('polo', 'casual', 'Top — wearing on the flight'), 1],   // a second pick on the SAME line -- also cleared
    [selKey('jeans', 'casual', 'Bottoms — wearing on the flight'), 1], // different LINE -- untouched
    [selKey('shirt', 'formal', 'Top — wearing on the flight'), 1],  // different TIER, same name -- untouched
  ]);
  const view = { tier: 'casual' };
  const ln = { name: 'Top — wearing on the flight', flightWorn: true };
  const person = 'him';
  for (const k of [...sel.keys()]) {
    const { category: c, line } = parseSelKey(k);
    if (c === view.tier && line === ln.name) sel.delete(k);
  }
  assert(!sel.has(selKey('henley', 'casual', 'Top — wearing on the flight')), 'clears the real pick on the exact same line');
  assert(!sel.has(selKey('polo', 'casual', 'Top — wearing on the flight')), 'and a second pick on that same line too');
  assert(sel.has(selKey('jeans', 'casual', 'Bottoms — wearing on the flight')), 'a different line on the same tier is untouched');
  assert(sel.has(selKey('shirt', 'formal', 'Top — wearing on the flight')), 'the same line name on a DIFFERENT tier is untouched');

  // Picking a real garment for a flight-worn line clears only the matching generic --
  // same category+name+person, leaving other people's/lines' generics alone.
  let generics = [
    { category: 'casual', name: 'Top — wearing on the flight', person: 'him', qty: 1 },
    { category: 'casual', name: 'Top — wearing on the flight', person: 'her', qty: 1 }, // his pick must not touch hers
    { category: 'casual', name: 'Bottoms — wearing on the flight', person: 'him', qty: 1 }, // different line
    { category: 'formal', name: 'Top — wearing on the flight', person: 'him', qty: 1 }, // different tier
  ];
  generics = generics.filter(x => !(x.category === view.tier && x.name === ln.name && (x.person || 'him') === person));
  assert(generics.length === 3, 'exactly one entry removed -> ' + JSON.stringify(generics));
  assert(!generics.some(x => x.person === 'him' && x.category === 'casual' && x.name === ln.name), 'his generic for that exact line is gone');
  assert(generics.some(x => x.person === 'her'), "her generic for the same line survives -- picks are per person");
  assert(generics.some(x => x.name === 'Bottoms — wearing on the flight'), 'a different line survives');
  assert(generics.some(x => x.category === 'formal'), 'a different tier survives');
}

// ---- Guard fires ONLY on flightWorn lines ----
assert(/if \(ln\.flightWorn\) \{/.test(f1) && !/if \(true\) \{[\s\S]{0,40}sel\.delete\(k\)/.test(f1),
  'the sel-clearing guard is conditioned on flightWorn, not unconditional');
