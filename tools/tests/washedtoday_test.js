// "When the user selects wash now, change the button for that day from Do Laundry
// Today to Washed Today, and when a user presses that button show the list of items
// washed that day." The Daily Dress Guide's per-day laundry button now checks whether
// a wash record already exists for that day+person (washedDayKeys); if so it renders
// "Washed Today" and opens a read-only list (showTripsyWashedDay) instead of the
// dirty-items screen (showTripsyLaundryDay).
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

// ---- the guide computes which days already have a confirmed wash ----
const guideRender = extractFn('renderTripsyDressGuideInto');
assert(/const washedDayKeys = new Set\(/.test(guideRender), 'a set of already-washed days is computed');
assert(/Store\.listTripsyLaundry\(guide\.tripKey\)\s*\n\s*\.filter\(r => r\.washedAt && \(r\.person \|\| 'him'\) === tripsyDressGuidePerson\)/.test(guideRender),
  'only records with washedAt set (a confirmed wash, not just a gathered bag) count, for THIS person');

// ---- the button itself switches label and a data attribute ----
assert(/const washedToday = washedDayKeys\.has\(day\.dayKey\);/.test(guideRender), 'each day checks its own washed state');
assert(/data-tripsy-laundry-washed="\$\{washedToday \? '1' : ''\}"/.test(guideRender),
  'the button carries the washed state as a data attribute for the click handler to read');
assert(/\$\{washedToday \? 'Washed Today' : 'Do Laundry Today'\}/.test(guideRender),
  'THE FIX: the button label switches once a wash is confirmed for that day');

// ---- the click handler branches on that attribute ----
assert(/if \(el\.getAttribute\('data-tripsy-laundry-washed'\) === '1'\) \{ showTripsyWashedDay\(guide\.tripKey, dayKey, person\); return; \}/.test(guideRender),
  'a washed day opens the read-only list instead of the dirty-items screen');
assert(/showTripsyLaundryDay\(guide\.tripKey, dayKey, person, \{ onChanged: refreshLaundryInfo \}\);/.test(guideRender),
  'an unwashed day still opens the ordinary Do Laundry Today screen, unchanged');

// ---- showTripsyWashedDay itself: read-only, merges the ::nn split, resolves names ----
const washedDay = extractFn('showTripsyWashedDay');
assert(/r\.dayKey === dayKey && r\.washedAt/.test(washedDay), 'finds the specific day\'s confirmed wash record');
assert(/const base = key\.endsWith\('::nn'\) \? key\.slice\(0, -4\) : key;/.test(washedDay),
  'merges a garment\'s "needed again" and "not needed" bag entries back into one line -- the split only mattered before washing');
assert(/if \(key\.startsWith\('g:'\)\) return \(garmentById\.get\(key\.slice\(2\)\) \|\| \{\}\)\.name \|\| 'Garment';/.test(washedDay),
  'a real wardrobe garment resolves to its name');
assert(/if \(key\.startsWith\('x:'\)\) return key\.slice\(2\) \|\| 'Item';/.test(washedDay),
  'a "No Picture" generic resolves to the name embedded in its key');
assert(/Nothing recorded for this wash\./.test(washedDay), 'an empty/missing record still renders something sane, not a blank modal');
assert(!/data-laundry-wash\b/.test(washedDay) && !/data-laundry-pick\b/.test(washedDay) && !/data-laundry-clean\b/.test(washedDay),
  'read-only: none of the interactive Do Laundry Today controls (bag, wash, not-dirty) are present');

// ---- executed: the key-merging + name-resolution logic, against fixtures ----
{
  const garmentById = new Map([['id1', { name: 'Gray Vuori Polo Shirt' }], ['id2', { name: 'Navy Henley' }]]);
  const nameFor = key => {
    if (key.startsWith('g:')) return (garmentById.get(key.slice(2)) || {}).name || 'Garment';
    if (key.startsWith('x:')) return key.slice(2) || 'Item';
    return key;
  };
  const mergeBag = bag => {
    const counts = new Map();
    for (const [key, n] of Object.entries(bag || {})) {
      const base = key.endsWith('::nn') ? key.slice(0, -4) : key;
      counts.set(base, (counts.get(base) || 0) + (n || 0));
    }
    return [...counts.entries()].map(([key, count]) => ({ name: nameFor(key), count })).filter(it => it.count > 0);
  };

  let items = mergeBag({ 'g:id1': 1 });
  assert(items.length === 1 && items[0].name === 'Gray Vuori Polo Shirt' && items[0].count === 1,
    'a single real garment resolves to its own name and count');

  // One garment split across the "needed again" (base key) and "not needed" (::nn)
  // cards on the SAME wash day -- both belong to the same physical pile once washed.
  items = mergeBag({ 'g:id1': 1, 'g:id1::nn': 2 });
  assert(items.length === 1 && items[0].count === 3, 'the base key and its ::nn twin merge into one line, counts summed -> ' + (items[0] && items[0].count));

  // A generic ("No Picture") item, and multiple different items in one wash.
  items = mergeBag({ 'g:id2': 1, 'x:Casual Socks': 4 });
  const byName = Object.fromEntries(items.map(it => [it.name, it.count]));
  assert(byName['Navy Henley'] === 1, 'a second real garment is listed too');
  assert(byName['Casual Socks'] === 4, 'a generic item shows the name embedded in its key, with its count');

  // No record at all -> nothing to show, not a crash.
  items = mergeBag(null);
  assert(items.length === 0, 'a missing bag produces an empty list, not an error');
}
