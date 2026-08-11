const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
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
fs.writeFileSync('runout_run.js', `
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
let wardrobe = [], selection = [], generics = [], washes = [], wearByGarment = {}, wearByLine = {};
const Store = {
  listWardrobe: async () => wardrobe,
  getTripWardrobe: async () => selection,
  getTripGenericGarments: async () => generics,
  listTripsyLaundry: () => washes,
};
const tripsyNormalizeTripSelection = sel => sel;
const tripsyWardrobeWearDays = async (t, id) => ({ days: (wearByGarment[id] || []).map(d => ({ dayKey: d })) });
const tripsyWardrobeWearDaysFromLines = (g, p, lines) => ({ days: (wearByLine[lines[0].line] || []).map(d => ({ dayKey: d })) });
// Real wear limits by name, defaulting to 1 (a plain shirt) so every EXISTING
// assertion below -- all written against one-wear garments -- is unaffected.
let limitByName = {};
const tripsyWearsBeforeWash = (name) => (limitByName[name] !== undefined ? limitByName[name] : 1);
${extractFn('tripsyLaundryRunOutByDay')}

const D = n => '2026-08-' + String(n).padStart(2, '0');
const guide = { days: Array.from({ length: 10 }, (_, i) => ({ dayKey: D(i + 1) })) };
wardrobe = [{ id: 'a', name: 'Blue shirt', person: 'him' }];
selection = [{ id: 'a', qty: 2 }];

// ---- before any wash, this says nothing at all ----
washes = [];
wearByGarment = { a: [D(1), D(2), D(3), D(4)] };
let r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.hasWash === false && r.runOut.size === 0,
  'with no wash recorded it reports nothing -- the guide\\'s own advice still stands');

// ---- after a wash, it projects the clean stock forward ----
// 2 shirts. Worn days 1,2 (both dirty), washed on day 3, worn 3,4,5.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 2 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.hasWash === true, 'a recorded wash switches the projection on');
assert(r.runOut.get(D(5)) && r.runOut.get(D(5)).includes('Blue shirt'),
  'the wash covers days 3 and 4, so it runs out on day 5 -> ' + JSON.stringify([...r.runOut]));
assert(r.runOut.size === 1, 'and only the FIRST short day is flagged, not every one after it');

// ---- washing enough means never running out ----
washes = [
  { tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 2 } },
  { tripKey: 'T1', person: 'him', dayKey: D(5), washedAt: 'x', bag: { 'g:a': 2 } },
];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'washing again in time means it never runs short');

// ---- a wash only returns what was actually DIRTY ----
// One shirt washed on day 3 while two are dirty: only one comes back.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 1 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(4)), 'washing one of two runs out a day earlier -> ' + JSON.stringify([...r.runOut]));

// ---- washing more than is dirty cannot conjure extra copies ----
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(2), washedAt: 'x', bag: { 'g:a': 9 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5), D(6)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 1, 'an over-large wash is capped at what was dirty, so it still runs out');

// ---- the other person's clothes and washes are not yours ----
wardrobe = [{ id: 'a', name: 'Blue shirt', person: 'her' }];
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 2 } }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, "her garments are not projected on his page");

// ---- several garments running short on the SAME day are separate entries ----
wardrobe = [
  { id: 'a', name: 'Blue shirt', person: 'him' },
  { id: 'b', name: 'Grey trousers', person: 'him' },
];
selection = [{ id: 'a', qty: 1 }, { id: 'b', qty: 1 }];
wearByGarment = { a: [D(1), D(2)], b: [D(1), D(2)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(1), washedAt: 'x', bag: {} }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(2)) && r.runOut.get(D(2)).length === 2,
  'both garments are recorded against that day, as separate names -> ' + JSON.stringify(r.runOut.get(D(2))));
// Each still appears only ONCE, on its own first short day.
const allNames = [...r.runOut.values()].flat();
assert(new Set(allNames).size === allNames.length, 'and no garment is flagged twice across the trip');

// ---- generic "No Picture" lines are projected too ----
wardrobe = []; selection = [];
generics = [{ person: 'him', category: 'general', name: 'T-shirts', qty: 1 }];
wearByLine = { 'T-shirts': [D(1), D(2), D(3)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(2), washedAt: 'x', bag: { 'x:T-shirts': 1 } }];
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(3)) && r.runOut.get(D(3)).includes('T-shirts'),
  'a generic line runs out too -> ' + JSON.stringify([...r.runOut]));

// ---- THE BUG JUST REPORTED: a garment with a real wear limit above 1 must not be
// projected as "used up" after a single wearing. Before this fix, walk() ignored the
// limit entirely and treated every wearing as making a copy dirty -- so a tie
// (Infinity, restyled rather than laundered) was wrongly flagged as running out.
limitByName = { 'Silk tie': Infinity };
wardrobe = [{ id: 'a', name: 'Silk tie', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
generics = []; // clear the previous test's leftover "T-shirts" line -- it would
                // otherwise still be walked (at the default 1-wear limit) and pollute runOut
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5), D(6), D(7)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(4), washedAt: 'x', bag: {} }]; // some OTHER wash, just to turn projection on
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'a tie worn every day never runs out -- it is restyled, not laundered');

// A ten-wear pair of trousers similarly must not be flagged after wear #2.
limitByName = { 'Grey trousers': 10 };
wardrobe = [{ id: 'a', name: 'Grey trousers', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
wearByGarment = { a: [D(1), D(2)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.size === 0, 'two wearings of a ten-wear garment is nowhere near dirty');

// But it DOES still run out once genuinely worn past its limit, unwashed: a limit-3
// garment worn 4 STRAIGHT days (with a wash recorded elsewhere just to arm the
// projection) comes up short on the 4th wearing -- 3 is fine, a 4th needs a clean copy
// that does not exist yet.
limitByName = { 'Grey trousers': 3 };
wardrobe = [{ id: 'a', name: 'Grey trousers', person: 'him' }];
selection = [{ id: 'a', qty: 1 }];
generics = [];
wearByGarment = { a: [D(1), D(2), D(3), D(4)] };
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(9), washedAt: 'x', bag: {} }]; // arms the projection without touching this key
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(4)), 'a 3-wear-limit garment worn 4 straight days runs out on the 4th -> ' + JSON.stringify([...r.runOut]));

// A wash genuinely pushes that day back out, by exactly the copies it actually
// returned -- not by resetting the whole counter (which would let washing ONE of
// several dirty copies wrongly launder them all).
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(3), washedAt: 'x', bag: { 'g:a': 1 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4), D(5), D(6)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(6)) && !r.runOut.get(D(4)) && !r.runOut.get(D(5)),
  'a wash mid-run pushes the run-out day out (day 4 -> day 6), never resetting further than what it actually cleaned -> ' + JSON.stringify([...r.runOut]));

// An over-large wash on a multi-wear garment still cannot conjure more relief than
// what was genuinely dirty -- same guard as the limit-1 case above, now with limit>1.
washes = [{ tripKey: 'T1', person: 'him', dayKey: D(1), washedAt: 'x', bag: { 'g:a': 99 } }];
wearByGarment = { a: [D(1), D(2), D(3), D(4)] };
r = await tripsyLaundryRunOutByDay('T1', 'him', guide);
assert(r.runOut.get(D(4)), 'an over-large wash before anything is dirty changes nothing -- still runs out on wearing 4');
`);
