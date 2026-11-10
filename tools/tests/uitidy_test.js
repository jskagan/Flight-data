// Three interface tidy-ups (2026-11-10): Back vs Close follow one rule on the packing
// screens, easy-to-take-back deletes get an Undo toast instead of a confirm, and a
// timeline row's owner actions sit in one "⋯" menu. Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  let i = html.indexOf('(', m.index), paren = 0;
  for (; i < html.length; i++) { if (html[i] === '(') paren++; else if (html[i] === ')') { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) { fails++; process.exitCode = 1; } };

// ---- Back vs Close ----
const B = new Function(`${extractFn('tripsySetBackOrClose')}\n${extractFn('tripsyBackOrCloseHtml')}\nreturn { tripsySetBackOrClose, tripsyBackOrCloseHtml };`)();
const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
B.tripsySetBackOrClose(btn, true);
assert(btn.className === 'tripsy-back-btn' && btn.innerHTML === '‹ Back' && btn.attrs['aria-label'] === 'Back', 'a button that returns one level is the orange ‹ Back');
B.tripsySetBackOrClose(btn, false);
assert(btn.className === 'tripsy-close-x' && btn.title === 'Close', 'a button that closes the page is the red ✕');
assert(/tripsy-back-btn/.test(B.tripsyBackOrCloseHtml('data-x', true)) && /tripsy-close-x/.test(B.tripsyBackOrCloseHtml('data-x', false)) && /data-x/.test(B.tripsyBackOrCloseHtml('data-x', true)), 'the markup builder keeps the caller\'s attribute either way');
assert((html.match(/tripsySetBackOrClose\(closeBtn, (true|false)\)/g) || []).length === 2, 'Packing List: ✕ on the list, ‹ Back on a garment page');
assert((html.match(/tripsySetBackOrClose\(ov\.querySelector\('#tw-packlist-done'\), (true|false)\)/g) || []).length === 2, 'Packing Status the same');
assert(/tripsyBackOrCloseHtml\('data-tw-cubes-close', true\)/.test(html) && /tripsyBackOrCloseHtml\('data-tw-location-close', !!back\)/.test(html), 'the Cubes and Garment Location drill-downs too');
assert(/class="tripsy-back-btn" data-ship-garment-back/.test(html), 'and the Ship Home garment view, which only ever goes back');

// ---- Undo toast ----
(async () => {
  const made = [];
  const mk = () => { const e = { children: [], style: {}, append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); }, remove() { this.removed = true; } }; made.push(e); return e; };
  const listeners = {};
  const doc = { hidden: false, getElementById: () => mk(), createElement: mk, addEventListener: (n, f) => { listeners[n] = f; } };
  const src = html.slice(html.indexOf('let _tripsyUndoToast = null;'), html.indexOf("document.addEventListener('visibilitychange', () => { if (document.hidden && _tripsyUndoToast)"));
  const hideLine = html.match(/document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden && _tripsyUndoToast\)[^\n]*\n/)[0];
  const toastUndo = new Function('document', `${src}\n${hideLine}\nreturn toastUndo;`)(doc);
  const log = [];
  let h = toastUndo('Deleted “A”.', { onUndo: () => log.push('undo A'), onCommit: () => log.push('commit A'), ms: 40 });
  const undoBtn = made.find(e => e.textContent === 'Undo');
  undoBtn.onclick();
  await new Promise(r => setTimeout(r, 70));
  assert(log.join() === 'undo A', 'Undo calls onUndo and the delete is never made');
  toastUndo('B', { onUndo: () => log.push('undo B'), onCommit: () => log.push('commit B'), ms: 30 });
  await new Promise(r => setTimeout(r, 60));
  assert(log.join() === 'undo A,commit B', 'left alone, the toast times out and the delete is made once');
  toastUndo('C', { onCommit: () => log.push('commit C'), ms: 5000 });
  toastUndo('D', { onCommit: () => log.push('commit D'), ms: 5000 });
  assert(log.includes('commit C') && !log.includes('commit D'), 'starting another delete commits the one still showing');
  doc.hidden = true; listeners.visibilitychange();
  assert(log.includes('commit D'), 'and so does the page going to the background');

  const del = html.slice(html.indexOf('container.querySelectorAll("[data-tripsy-delete-event]")'), html.indexOf('container.querySelectorAll("[data-tripsy-move-event]")'));
  assert(!/confirm\(/.test(del) && /toastUndo\(`Deleted “\$\{summary\}”\.`/.test(del), 'the timeline Delete asks nothing and shows the Undo toast');
  assert(/onCommit: async \(\) => \{\s*const pending = Store\.queueTripsyChange\(change\);/.test(del) && !/onUndo:[^\n]*queueTripsyChange/.test(del), 'the real delete happens only at commit; Undo writes nothing');
  assert(/row\.remove\(\)/.test(extractFn('tripsyHidePendingDeleteRows')) && /tripsyHidePendingDeleteRows\(container\); \/\/ a Delete still inside/.test(html), 'the row stays gone across a re-render during the Undo window');
  const att = html.slice(html.indexOf('container.querySelectorAll("[data-tripsy-delete-attachment]")'), html.indexOf('container.querySelectorAll("[data-tripsy-add-item-toggle]")'));
  assert(!/confirm\(/.test(att) && /toastUndo\('Removed the attachment/.test(att), 'removing an attachment works the same way');
  assert(/confirm\(`Delete the entire "\$\{name\}" trip\?/.test(html), 'deleting a WHOLE trip still asks first');

  // ---- row menu ----
  const menu = html.slice(html.indexOf('<button class="btn" data-tripsy-row-menu-toggle'), html.indexOf('const actionsHtml = (entryBtnHtml'));
  for (const a of ['data-tripsy-edit-event', 'data-tripsy-attach-event', 'data-tripsy-move-event', 'data-tripsy-delete-event']) assert(new RegExp(`tripsy-row-menu-item" ${a} `).test(menu), `${a} is a labelled row of the ⋯ menu, same attribute as before`);
  assert(/data-tripsy-id="\$\{esc\(String\(ev\.tripsyRaw\.id\)\)\}"/.test(menu) && /data-summary=/.test(menu), 'the items keep every data attribute their handlers read');
  assert(html.includes("'[data-tripsy-row-menu]',\n  '[data-tripsy-document-menu]'") && /new Set\(\['\[data-tripsy-attachments-menu\]', '\[data-tripsy-row-menu\]'/.test(html), 'the menu closes with every other trip menu and keeps its markup');
  assert(/btn\.parentElement\.querySelector\('\[data-tripsy-row-menu\]'\)/.test(html) && /menu\.addEventListener\("click", \(\) => \{ setTimeout\(\(\) => \{ menu\.style\.display = "none"; \}, 0\); \}, true\);/.test(html), 'the ⋯ opens its own sibling menu, and a pick closes it');
  if (fails) process.exit(1);
})();
