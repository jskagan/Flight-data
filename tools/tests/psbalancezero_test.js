// "On the p/s screen for 'remaining balance', hide all lines where there is no
// amount specified. Only show lines where there is a dollar amount associated with
// the entry." renderPsBalanceTable used to render every line item of every receipt
// group, including $0/absent-amount lines (blank in all three dollar columns) that
// contribute nothing to the balance math. It now filters each group's items to those
// with a real positive deductionAmount, and drops a group's HEADER row too when no
// items survive -- but only on the ordinary P/S Balance page: the Delete/Re-Parse
// utilities variant (showDeleteControls = true) still shows everything, since a
// zero-amount group has to stay visible to be deletable. The Remaining Balance
// totals stay computed over ALL items (zeros contribute nothing, so nothing moves).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- extract renderPsBalanceTable ----
const start = html.indexOf('async function renderPsBalanceTable(');
assert(start > -1, 'sanity: found renderPsBalanceTable');
let depth = 0, end = start;
for (let j = html.indexOf('{', start); j < html.length; j++) {
  if (html[j] === '{') depth++;
  else if (html[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
}
const fn = html.slice(start, end);

// ---- source patterns: the filter, the scoping, and the untouched totals ----
assert(/const visibleItems = showDeleteControls \? g\.items : g\.items\.filter\(item => Number\(item\.deductionAmount\) > 0\);/.test(fn),
  'THE ASK: line items are filtered to those with a real dollar amount (utilities Delete variant keeps everything)');
assert(/if \(!visibleItems\.length\) return "";/.test(fn),
  'a group left with NO dollar lines drops entirely -- header row included, never an empty header');
assert(/\$\{visibleItems\.map\(item => \{/.test(fn),
  'the item rows render from the filtered list');
assert(!/\$\{g\.items\.map\(item => \{/.test(fn),
  'no render path still walks the unfiltered items');
// The Remaining Balance math still walks ALL items -- filtering there would be a
// no-op today (zeros subtract nothing) but a trap if a negative/credit ever appears.
assert(/for \(const g of groups\) \{\s*\n\s*for \(const item of g\.items\) \{/.test(fn),
  'the Remaining Balance totals still sum over every item, untouched by the display filter');

// ---- executed: the filter + group-drop decision, against synthetic fixtures ----
{
  const renderGroups = (groups, showDeleteControls) => groups.map(g => {
    const visibleItems = showDeleteControls ? g.items : g.items.filter(item => Number(item.deductionAmount) > 0);
    if (!visibleItems.length) return null;
    return { id: g.gmailMessageId, items: visibleItems.map(i => i.description) };
  }).filter(Boolean);

  const groups = [
    { gmailMessageId: 'm1', personKey: 'jon', items: [
      { description: 'Facility fee', deductionAmount: 350 },
      { description: 'Complimentary snack', deductionAmount: 0 },
      { description: 'No-amount line (older sync)', deductionAmount: undefined },
    ] },
    { gmailMessageId: 'm2', personKey: 'rob', items: [
      { description: 'Zero-only A', deductionAmount: 0 },
      { description: 'Zero-only B', deductionAmount: null },
    ] },
    { gmailMessageId: 'm3', personKey: 'jon', items: [
      { description: 'Guest fee', deductionAmount: 125.5 },
    ] },
  ];

  const shown = renderGroups(groups, false);
  assert(shown.length === 2, 'a group whose every line has no amount disappears entirely (header too)');
  assert(shown[0].items.length === 1 && shown[0].items[0] === 'Facility fee',
    'THE ASK: within a mixed group, only the dollar-amount line renders');
  assert(shown[1].items[0] === 'Guest fee', 'an all-dollar group is untouched');
  assert(!shown.some(g => g.id === 'm2'), 'the zero-only group is the one that dropped');

  const utilities = renderGroups(groups, true);
  assert(utilities.length === 3 && utilities[0].items.length === 3,
    'the Delete/Re-Parse utilities variant still shows every group and every line, so zero-amount groups stay deletable');

  // Totals math is over ALL items regardless -- and unchanged by the filter,
  // since a no-amount line subtracts nothing.
  const total = groups.filter(g => g.personKey === 'jon')
    .flatMap(g => g.items).reduce((s, i) => s - (Number(i.deductionAmount) || 0), 1000);
  assert(total === 1000 - 350 - 125.5, 'Remaining Balance is identical with or without the hidden lines');
}
