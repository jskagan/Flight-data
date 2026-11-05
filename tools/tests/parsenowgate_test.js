// The status panel offers Run Parse Now only when something actually awaits parsing:
// "I just ran a parse. Why does this say run parse now?" (2026-11-05 -- the forward had
// been parsed; only a conflict for the owner to resolve kept the badge yellow).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fn = n => { const i = html.indexOf('function ' + n + '('); let d = 0; for (let k = html.indexOf('{', i); ; k++) { if (html[k] === '{') d++; else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1); } };
const status = fn('computeTripsyStatus');
assert(/const parseNeeded = !!\(docsToParse\.length \|\| emailsToParse \|\| narrativeRequests\);/.test(status),
  'parseNeeded is true only for docs, emails or narrative requests awaiting a run');
assert(/return \{ state: 'yellow', reasons: yellow, parseNeeded \}/.test(status), 'the yellow state carries it');
const panel = fn('renderTripsyStatusPanel');
assert(/\(state === 'red' \|\| \(state === 'yellow' && parseNeeded\)\) \?/.test(panel),
  'THE ASK: Run Parse Now shows only when a parse is outstanding (or on a failed write)');
assert(/parseNeeded \? '⚠️ Claude needs to run something' : '⚠️ Needs your attention'/.test(panel),
  'a conflict-only panel is headed "Needs your attention", not "Claude needs to run something"');
