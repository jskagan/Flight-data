// Fly-over "Edit destinations": a draft list to rename / reorder / add / remove / rebuild,
// applied only on Save ("make the button 'edit destinations' and then display a list of
// destinations that the user can edit. Also give an option to 'Rebuild Destinations' …
// but again allow the user to fully edit before confirming," 2026-10-22). Synthetic only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
// Skips the parameter list first: a `= {}` default would otherwise close the brace count.
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) return null;
  let j = html.indexOf('(', i), paren = 0;
  for (; ; j++) { if (html[j] === '(') paren++; else if (html[j] === ')' && --paren === 0) break; }
  let d = 0;
  for (let k = html.indexOf('{', j); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
(0, eval)([extractFn('tripsyFlyoverMoveStop'), extractFn('tripsyFlyoverManualStop'), extractFn('tripsyFlyoverKeepManualStops')].join('\n'));

const st = (id, kind, label) => ({ id, kind, label });
const list = [st('o', 'origin', 'LA'), st('a', 'stay', 'Paris'), st('b', 'stay', 'Rome'), st('r', 'return', 'LA')];
assert(tripsyFlyoverMoveStop(list, 2, 1).map(s => s.id).join('') === 'obar', 'move up swaps with the one above');
assert(tripsyFlyoverMoveStop(list, 1, 2).map(s => s.id).join('') === 'obar', 'move down swaps with the one below');
assert(tripsyFlyoverMoveStop(list, 0, -1) !== list && tripsyFlyoverMoveStop(list, 0, -1).map(s => s.id).join('') === 'oabr' && list.length === 4,
  'an out-of-range move is a no-op copy; the input is never mutated');

const m = tripsyFlyoverManualStop({ label: 'Lake Como', query: 'Lake Como', lat: 45.99, lng: 9.26 }, 'a');
assert(m.manual && m.kind === 'stay' && m.labelEdited && m.manualPlace === 'Lake Como' && m.lat === 45.99 && m.mode === 'car' && m.modeGuessed && m.afterId === 'a' && !m.start,
  'an added destination is a hand-placed, hand-named stay with no dates, reached by car until told otherwise');

// A rebuild keeps added destinations where they were.
const prev = [st('o', 'origin', 'LA'), st('a', 'stay', 'Paris'), { ...m }, st('b', 'stay', 'Rome'), st('r', 'return', 'LA')];
const rebuilt = [st('o', 'origin', 'LA'), st('a', 'stay', 'Paris'), st('b', 'stay', 'Rome'), st('r', 'return', 'LA')];
assert(tripsyFlyoverKeepManualStops(rebuilt, prev).map(s => s.id).join(',') === `o,a,${m.id},b,r`, 'a manual stop goes back after the destination it followed');
const rebuilt2 = [st('o', 'origin', 'LA'), st('b', 'stay', 'Rome'), st('r', 'return', 'LA')];
assert(tripsyFlyoverKeepManualStops(rebuilt2, prev).map(s => s.id).join(',') === `o,b,${m.id},r`, 'its predecessor gone, it keeps its old index');
assert(tripsyFlyoverKeepManualStops([...rebuilt, { ...m }], prev).filter(s => s.id === m.id).length === 1, 'never duplicated when the rebuild already has it');
assert(tripsyFlyoverKeepManualStops(rebuilt, [st('x', 'stay', 'Nope')]).length === 4, 'a stop the trip derived (not manual) is not resurrected by this');

// Wiring: the page's button opens the dialog; the record changes only on the dialog's Save.
const page = extractFn('showTripsyFlyover');
assert(/data-flyover-edit-dests/.test(page) && !/data-flyover-rebuild/.test(page), 'the setup page has Edit destinations in place of the old Rebuild button');
assert(/const r = await tripsyFlyoverEditDestinationsDialog\(trip, record, \{[\s\S]{0,400}rebuild: async draft => tripsyFlyoverBuild\(trip, draft, \{\}\)/.test(page)
  && /if \(!r \|\| closed\) return;\s*record = r;[\s\S]{0,300}await save\(\);/.test(page),
  'the dialog rebuilds from the trip without asking for places, and the page saves only what the dialog returns');
const dlg = extractFn('tripsyFlyoverEditDestinationsDialog');
assert(/let draft = \{ \.\.\.record, stops: \(record\.stops \|\| \[\]\)\.map\(s => \(\{ \.\.\.s \}\)\) \};/.test(dlg), 'the dialog edits a copy');
assert(/data-fe-cancel\]'\)\.forEach\(b => b\.onclick = \(\) => done\(null\)\)/.test(dlg) && /done\(draft\)/.test(dlg), 'Cancel returns nothing; Save returns the draft');
for (const ctl of ['data-fe-label', 'data-fe-mode', 'data-fe-up', 'data-fe-down', 'data-fe-remove', 'data-fe-restore', 'data-fe-place', 'data-fe-add', 'data-fe-rebuild'])
  assert(dlg.includes(ctl), `the list offers ${ctl.replace('data-fe-', '')}`);
assert(/tripsyFlyoverKeepManualStops\(rebuilt\.stops, draft\.stops\)/.test(dlg), 'a rebuild inside the dialog keeps added destinations and leaves the result to edit');
