// "For events that involve hikes, biking, climbing, running, jogging or
// anything similar, set the dress category as 'athletic'." Two layers: the
// events-categorization PROMPT states the rule (nuance lives with the model),
// and tripsyAttireForceAthleticCategories enforces it deterministically over
// event NAMES right after categories land -- in BOTH generation branches,
// BEFORE the per-tier counts that size the packing guidance, so a forced hike
// is athletic in the garment math too. Manual overrides always win, the
// keyword list is deliberately conservative (activity-specific word forms,
// word-bounded -- "Surf & Turf" and "Ski Lodge Dinner" are dinners), and a
// guide saved before the rule existed picks it up on any refresh.
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

// ---- the prompt rule ----
assert(/Any event that is itself a physical activity[\s\S]{0,200}is Athletic, regardless of venue or time of day\./.test(html),
  'THE ASK: the events-categorization prompt states the athletic rule explicitly');

// ---- both branches enforce mechanically, before the guidance counts ----
{
  const idx1 = html.indexOf('// Authoritative per-tier counts');
  const slice1 = html.slice(idx1, idx1 + 700);
  assert(/tripsyAttireForceAthleticCategories\(days\);\s*\n\s*const authCounts = computeTripsyAttireBlocks\(days\)\.counts;/.test(slice1),
    'the events-UNCHANGED refresh branch forces athletic before its counts -- pre-rule guides retrofit on any refresh');
  const idx2 = html.indexOf('// Finalized per-tier time-block counts');
  const slice2 = html.slice(idx2, idx2 + 700);
  assert(/tripsyAttireForceAthleticCategories\(days\);\s*\n\s*const authCounts = computeTripsyAttireBlocks\(days\)\.counts;/.test(slice2),
    'the fresh-categorization branch forces athletic before its counts -- the packing guidance sizes off the forced tiers');
}

// ---- executed: the enforcement pass ----
{
  eval(html.slice(html.indexOf('const TRIPSY_ATTIRE_ATHLETIC_EVENT_RE'), html.indexOf('function computeTripsyAttireBlocks')));
  const mk = (name, category = 'casual', extra = {}) => ({ name, category, alternateCategory: '', ...extra });
  const days = [{ dayKey: 'd1', events: [
    mk('Sunrise Hike to the Falls'),
    mk('Mountain Biking — Red Rocks', 'smart_casual'),
    mk('Rock Climbing intro'),
    mk('Morning Run along the river'),
    mk('Jogging with the group'),
    mk('Yoga session', 'casual'),
    mk('Kayaking the fjord', 'casual', { alternateCategory: 'smart_casual' }),
    mk('Surf & Turf Dinner', 'semi_formal'),
    mk('Ski Lodge Dinner', 'cocktail'),
    mk('Dinner at Brunello', 'semi_formal'),        // "run" must not match inside words
    mk('Marathon des Sables briefing'),
    mk('Overridden hike', 'casual', { categoryOverridden: true }),
    mk('Skiing at Ajax'),
    mk('Tennis with Rob'),
  ] }];
  const forced = tripsyAttireForceAthleticCategories(days);
  const cat = n => days[0].events.find(e => e.name === n).category;

  ['Sunrise Hike to the Falls', 'Mountain Biking — Red Rocks', 'Rock Climbing intro', 'Morning Run along the river',
   'Jogging with the group', 'Yoga session', 'Kayaking the fjord', 'Marathon des Sables briefing', 'Skiing at Ajax', 'Tennis with Rob']
    .forEach(n => assert(cat(n) === 'athletic', `THE ASK: "${n}" is forced Athletic`));
  assert(days[0].events.find(e => e.name === 'Kayaking the fjord').alternateCategory === '',
    'a forced event loses its ambiguity pair -- the rule leaves nothing to pick');
  assert(cat('Surf & Turf Dinner') === 'semi_formal', 'TRAP: "Surf & Turf" is dinner, not surfing');
  assert(cat('Ski Lodge Dinner') === 'cocktail', 'TRAP: "Ski Lodge Dinner" is dinner, not skiing');
  assert(cat('Dinner at Brunello') === 'semi_formal', 'TRAP: "run" never matches inside another word');
  assert(cat('Overridden hike') === 'casual', 'a manual override always wins over the rule');
  assert(forced === 10, `the pass reports how many it forced (${forced})`);

  // Idempotent: a second pass forces nothing further.
  assert(tripsyAttireForceAthleticCategories(days) === 0, 'already-athletic events are skipped on a re-run');
}
