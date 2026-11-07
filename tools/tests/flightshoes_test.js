// "Yes, let flight shoes count for other lines" (2026-11-07): the pair picked for
// "Shoes — wearing on the flight" may also fill any other Packing List line, and is
// counted as one pair, not two. Synthetic fixtures only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const h = new Function([
  "const TRIPSY_FLIGHT_WORN_ROLE_LABEL = { tops: 'Top', pants: 'Bottoms', footwear: 'Shoes' };",
  "const TRIPSY_FLIGHT_WORN_SUFFIX = ' — wearing on the flight';",
  fnSource('tripsyWardrobeLineIsFlightShoes'), fnSource('tripsyWardrobeAllocationsShareCopy'), fnSource('tripsyWardrobePhysicalQtyById'),
  'return { isShoes: tripsyWardrobeLineIsFlightShoes, share: tripsyWardrobeAllocationsShareCopy, qty: tripsyWardrobePhysicalQtyById };'].join('\n'))();
const SHOES = 'Shoes — wearing on the flight', TOP = 'Top — wearing on the flight';

assert(h.isShoes(SHOES) && !h.isShoes(TOP) && !h.isShoes('Smart Casual shoes'), 'only the flight SHOES line is special');
assert(h.share(SHOES, 'Smart Casual shoes') && h.share('Smart Casual shoes', SHOES), 'THE ASK: the flight pair and another line share one copy, both ways');
assert(!h.share('Smart Casual shoes', 'waterproof boots'), 'two ordinary lines still each need their own copy');
assert(!h.share(TOP, 'casual tops'), 'the flight TOP still takes its own copy (a top is one wearing)');

const q = h.qty([
  { id: 'boots', line: SHOES, qty: 1 }, { id: 'boots', line: 'Smart Casual shoes', qty: 1 },
  { id: 'shirt', line: 'tops', qty: 2 }, { id: 'shirt', line: 'more tops', qty: 1 },
  { id: 'sneaks', line: SHOES, qty: 1 },
]);
assert(q.get('boots') === 1, 'one pair on the flight line AND Smart Casual shoes is ONE pair');
assert(q.get('shirt') === 3, 'ordinary lines still add up');
assert(q.get('sneaks') === 1, 'a pair only on the flight line counts once');
assert(h.qty([{ id: 'x', line: 'gym', qty: 1, category: 'gym' }], e => e.category !== 'gym').size === 0, 'the keep filter drops entries');

// The two pickers' availability rule
const allocs = html.match(/const allocElsewhere = \(id, cat, line\) => \{[^\n]*\};/g) || [];
assert(allocs.length === 2 && allocs.every(a => a.includes('!tripsyWardrobeAllocationsShareCopy(line, o.line)')), 'both pickers (Packing List + drill-down pack panel) let the flight pair fill another line');
// Every per-garment copy count goes through the overlap-aware helper
assert(!/qtyById\.set\(e\.id, \(qtyById\.get\(e\.id\) \|\| 0\) \+ e\.qty\)/.test(html), 'no reader sums a garment\'s copies across lines by hand any more');
assert((html.match(/tripsyWardrobePhysicalQtyById\(/g) || []).length >= 8, 'the copy counters use tripsyWardrobePhysicalQtyById');
