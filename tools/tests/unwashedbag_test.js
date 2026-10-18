// "Keep the laundry button on any day with an unwashed bag" (2026-10-18): a bag gathered
// but never marked washed became unreachable once the trip's today moved past its day.
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  if (html.slice(i - 6, i) === 'async ') i -= 6;
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const bags = new Function(fnSource('tripsyUnwashedLaundryBagsByDay') + '\nreturn tripsyUnwashedLaundryBagsByDay;')();
{
  const recs = [
    { tripKey: 'T', person: 'him', dayKey: '2026-10-18', washedAt: null, bag: { 'g:a': 9, 'g:b': 1, 'g:c::nn': 1 } },
    { tripKey: 'T', person: 'him', dayKey: '2026-10-15', washedAt: '2026-10-15T10:00:00Z', bag: { 'g:a': 3 } }, // washed -- not pending
    { tripKey: 'T', person: 'her', dayKey: '2026-10-18', washedAt: null, bag: { 'g:z': 2 } },                   // other person
    { tripKey: 'T', person: 'him', dayKey: '2026-10-16', washedAt: null, bag: {} },                            // nothing in it
    { tripKey: 'T', dayKey: '2026-10-17', bag: { 'g:q': 2 } },                                                 // no person = him
  ];
  const m = bags(recs, 'him');
  assert(m.get('2026-10-18') === 11, 'THE ASK: a gathered, unwashed bag counts every copy in it (both halves of a split garment)');
  assert(!m.has('2026-10-15'), 'a washed bag is not pending');
  assert(!m.has('2026-10-16'), 'an empty bag is not pending');
  assert(m.get('2026-10-17') === 2 && !m.has('2026-10-19'), 'a record with no person is His; nothing is invented for other days');
  assert(bags(recs, 'her').get('2026-10-18') === 2 && bags(recs, 'her').size === 1, 'Hers sees only her bag');
  assert(bags(null, 'him').size === 0, 'no records -> nothing');
}
// ---- the guide's button rule ----
const dg = fnSource('renderTripsyDressGuideInto');
assert(/const unwashedBagByDay = tripsyUnwashedLaundryBagsByDay\(Store\.listTripsyLaundry\(guide\.tripKey\), tripsyDressGuidePerson\);/.test(dg), 'the guide reads the pending bags for the person shown');
assert(/const laundryBtn = \(isOwner && \(washedToday \|\| isToday \|\| bagCount > 0\)\)/.test(dg), 'THE ASK: the button stays on today, on washed days, AND on any day with an unwashed bag');
assert(/\(bagCount > 0 \? `🧺 Laundry · \$\{bagCount\} in bag` : '🧺 Laundry'\)/.test(dg), 'a day with a pending bag says how many pieces are in it');
assert(/data-tripsy-laundry-washed="\$\{washedToday \? '1' : ''\}"/.test(dg), 'an unwashed bag opens the live laundry screen (not the read-only washed list), so Wash Now is reachable');
