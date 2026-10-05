// "When you select edit a garment, add filters and a search bar to be able to quickly
// find a garment. Also, when the user presses the save button, indicate that the
// changes have been saved" (2026-10-05). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
  let depth = 0;
  for (let j = html.indexOf('{', html.indexOf(')', m.index)); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
const shell = extractFn('getOrCreateWardrobeBulkEditOverlay');
const open = extractFn('tripsyWardrobeOpenBulkEdit');
assert(/id="tw-bulk-search"/.test(shell) && /id="tw-bulk-f-person"/.test(shell) && /id="tw-bulk-f-group"/.test(shell) && /id="tw-bulk-f-tier"/.test(shell),
  'THE ASK: the Edit wardrobe page has a search bar plus Whose / Type / Dress-level filters');
assert(/position:sticky; top:0/.test(shell), 'the filter bar stays pinned while scrolling the list');
assert(/row\.style\.display = ok \? '' : 'none'/.test(open) && !/bodyEl\.innerHTML = [^;]*\n[\s\S]*applyFilters = \(\) => \{[\s\S]*bodyEl\.innerHTML/.test(open),
  'filters HIDE rows rather than re-rendering them, so edits in hidden rows survive');
assert(/`\$\{v\.name\} \$\{v\.color\}`\.toLowerCase\(\)\.includes\(q\)/.test(open), 'search matches the live name and color, case-insensitively');
assert(/Store\.saveWardrobeGarments\(changed\)/.test(open) && !/Store\.saveWardrobeGarment\(updated\)/.test(open),
  'only changed garments are saved, in ONE write instead of one whole-file save per row');
assert(/'✓ Saved'/.test(open) && /tw-bulk-saved/.test(open) && /toast\(`Wardrobe saved/.test(open) && /No changes to save/.test(open),
  'THE ASK: Save visibly confirms — the button flips to a green ✓ Saved, a status line and toast say how many; nothing changed says so');
assert(/Could not save — please try again/.test(open), 'a failed save says so instead of looking saved');
assert(/delete saveBtn\.dataset\.saved/.test(open), 'editing again after a save resets the button to "Save changes"');
const store = html.slice(html.indexOf('async saveWardrobeGarments('), html.indexOf('async deleteWardrobeGarment('));
assert(/persistDriveData\(\{ silentConflict: true \}\)/.test(store) && /e\.conflict && attempt < 2/.test(store),
  'the batch save uses the same conflict-retried single persist as the one-garment save');
const form = extractFn('showWardrobeGarmentForm');
assert(/toast\(`Saved “\$\{name\}”\.`\)/.test(form), 'the single-garment form confirms its save too, since it closes instantly');
assert(/\[\.\.\.\(await Store\.listWardrobe\(\)\)\]\.sort\(\(x, y\) =>\s*String\(x\.name \|\| ''\)\.localeCompare\(String\(y\.name \|\| ''\), undefined, \{ sensitivity: 'base', numeric: true \}\)\)/.test(open),
  'THE ASK: the Edit page lists garments alphabetically (case/accent-insensitive), sorting a copy so stored order is untouched');
