// "When I am resolving conflicts in the my trips page and I delete the existing
// event there is a delay." The conflict box's two row-ENDING buttons -- Delete
// Existing Event, and Import (with conflict) -- were the last such actions still
// awaiting their writes in the FOREGROUND: two full-file Drive PATCHes at ~2.5s
// each (trips data, then proposal bookkeeping), plus a geocode for a new
// activity, with only a disabled button to look at. Everything around them
// (Ignore, the modify dialog's Add/Drop, the non-conflict Import) already went
// optimistic via the shared _tripsyParseImportChain. Both now finish through one
// shared finishRowOptimistically: hide the row + confirm instantly, run the
// writes in the serialized background chain, reconcile once all queued actions
// settle, restore the row + button on failure. "Create a new trip" keeps the
// blocking path -- it opens a name/dates dialog, which must not appear after the
// row already vanished (the same exception the non-conflict Import documents).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- isolate the conflict-box wiring ----
const start = html.indexOf('function finishRowOptimistically(');
assert(start > -1, 'sanity: found the shared optimistic finisher');
const wireEnd = html.indexOf("const modNewBtn = q('[data-parse-conflict-modify-new]');");
const region = html.slice(start, wireEnd);
assert(region.length > 500, 'sanity: captured the finisher + Import/Ignore/Delete handlers');

// ---- the finisher itself ----
const fin = region.slice(0, region.indexOf('\n  }\n') + 4);
assert(/ctx\.row\.style\.display = 'none';\s*\n\s*toast\(confirmMsg\);/.test(fin),
  'THE FIX: the row clears and the confirmation shows IMMEDIATELY, before any Drive write');
assert(/_tripsyParseImportChain = _tripsyParseImportChain\s*\n\s*\.then\(runFinish\)/.test(fin),
  'the writes run in the shared serialized background chain (no overlapping full-file PATCHes)');
assert(/if \(!ok\) \{\s*\n\s*ctx\.row\.style\.display = '';\s*\n\s*if \(restoreBtn\) restoreBtn\.disabled = false;/.test(fin),
  'a failed save restores the row and re-enables the button -- nothing is silently dropped');
assert(/if \(_tripsyParseImportPending === 0\) ctx\.afterImport\(\);\s*\n\s*else updateTripsyDocParseBadge\(\);/.test(fin),
  'the full-page reconcile waits until every queued action has settled');
assert((fin.match(/_tripsyParseImportPending--/g) || []).length === 2,
  'the pending count decrements on both the settle and the catch path');

// ---- Delete Existing Event goes through it ----
const delHandler = region.slice(region.indexOf("const delBtn = q('[data-parse-conflict-delete-existing]');"));
assert(/finishRowOptimistically\('Deleted the existing event and imported the new one\.', delBtn,\s*\n\s*\(\) => tripsyParseImportProposalEvent\(ctx\.proposal, ctx\.event, destValue\(\), ctx\.newModified \? ctx\.newFields : null, deleteChange\)\)/.test(delHandler),
  'THE ASK: Delete Existing Event finishes optimistically, delete + import still in ONE combined write (deleteChange passed through)');
assert(!/const ok = await tripsyParseImportProposalEvent[\s\S]{0,200}deleteChange\);\s*\n\s*if \(ok\) \{ toast\('Deleted the existing event and imported the new one\.'\); await ctx\.afterImport\(\); \} else \{ delBtn\.disabled = false; \}\s*\n\s*\}\);/.test(delHandler.replace(/if \(destValue\(\) === '__new__'\) \{[\s\S]*?\n      \}/, '')),
  'the old foreground await is gone from the ordinary (existing-trip) path');
assert(/if \(!found\) \{ toast\('Could not find that event/.test(delHandler),
  'the cannot-find-event guard still runs BEFORE anything is hidden (nothing optimistic about a missing event)');

// ---- Import (with conflict) goes through it too ----
const impHandler = region.slice(region.indexOf('const importBtn'), region.indexOf('const ignoreBtn'));
assert(/finishRowOptimistically\('Imported\.', importBtn,/.test(impHandler),
  'the conflict box\'s Import button finishes optimistically the same way');
assert(!/doImport/.test(html), 'the old blocking doImport is gone entirely');

// ---- the new-trip dialog exception, on BOTH buttons ----
assert(/if \(destValue\(\) === '__new__'\) \{[\s\S]{0,400}?\} else \{ importBtn\.disabled = false; \}\s*\n\s*return;/.test(impHandler),
  '"Create a new trip" keeps the blocking path on Import -- its name/dates dialog must not appear after the row vanished');
assert(/if \(destValue\(\) === '__new__'\) \{[\s\S]{0,400}?\} else \{ delBtn\.disabled = false; \}\s*\n\s*return;/.test(delHandler),
  'and on Delete Existing Event likewise');

// ---- executed: the finisher's ordering and failure handling, against stubs ----
(async () => {
  const events = [];
  const makeCtx = () => ({
    row: { style: { display: '' } },
    afterImport: async () => { events.push('afterImport'); },
  });
  const src = fin.replace(/^  function finishRowOptimistically/, 'var finishRowOptimistically = function');
  const run = (ctx, runFinish, restoreBtn) => {
    const scope = {
      ctx, toast: (m, k) => events.push('toast:' + m + (k ? '|' + k : '')),
      updateTripsyDocParseBadge: () => events.push('badge'),
    };
    let _tripsyParseImportPending = 0;
    let _tripsyParseImportChain = Promise.resolve();
    const f = new Function('ctx', 'toast', 'updateTripsyDocParseBadge', 'state',
      'var _tripsyParseImportPending = state.pending; var _tripsyParseImportChain = state.chain;\n'
      + src
      + '\nfinishRowOptimistically(arguments[4], arguments[5], arguments[6]);'
      + '\nreturn _tripsyParseImportChain.then(() => ({ pending: _tripsyParseImportPending }));');
    return f(scope.ctx, scope.toast, scope.updateTripsyDocParseBadge, { pending: _tripsyParseImportPending, chain: _tripsyParseImportChain }, 'Deleted the existing event and imported the new one.', restoreBtn, runFinish);
  };

  // Success: row hidden + toast BEFORE the write resolves; afterImport after.
  let ctx = makeCtx();
  const slowWrite = () => { events.push('write-start:' + ctx.row.style.display); return Promise.resolve(true); };
  await run(ctx, slowWrite, { disabled: true });
  assert(events[0] && events[0].startsWith('toast:Deleted'), 'the confirmation toast fires first');
  assert(events.includes('write-start:none'), 'THE FIX: the Drive write starts with the row ALREADY hidden -- no dead-button wait');
  assert(events.includes('afterImport'), 'the reconciling re-render runs after the write settles');
  assert(ctx.row.style.display === 'none', 'a successful save leaves the row cleared');

  // Failure: row restored, button re-enabled, error toast.
  events.length = 0;
  ctx = makeCtx();
  const btn = { disabled: true };
  await run(ctx, () => Promise.resolve(false), btn);
  assert(ctx.row.style.display === '' && btn.disabled === false,
    'a failed save restores the row and re-enables the button');
  assert(events.some(e => e.includes("didn't save") && e.includes('|error')), 'and says so with an error toast');
  assert(!events.includes('afterImport'), 'no reconcile runs for a failed action');
})();
