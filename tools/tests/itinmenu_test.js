// "When there is no itinerary generated there should be a create menu option, but after
// one has been generated that should change to edit. Both shouldn't exist on the same
// menu." (2026-08-29). They did: Create was emitted only when nothing was generated, but
// Edit was emitted UNCONDITIONALLY -- so an ungenerated trip offered both, and picking
// Edit just opened Preview's first-time section picker, i.e. it created. Two buttons,
// one job.
//
// The one wrinkle worth protecting: a VIEWER never gets Create (it's owner-only), so
// hiding the preview item from them whenever nothing is generated would leave them with
// no on-screen route to the itinerary at all -- and it still renders the day-by-day
// events without any narrative. Hence viewers keep it, labelled Preview rather than Edit.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// The menu's markup block, from the Create/Delete comment to the end of the template.
const start = html.indexOf('// Create/Delete are the two states of one owner-only button:');
assert(start > -1, 'sanity: found the itinerary menu markup');
const block = html.slice(start, start + 3000);

// ---- the gate exists and is the right condition ----
assert(/const showPreviewItem = hasGeneratedNarrative \|\| !isOwner;/.test(block),
  'THE FIX: the preview/edit item is conditional -- shown once generated, or to a viewer either way');
assert(/\$\{showPreviewItem \? menuListButtonHtml\(`data-tripsy-preview-itinerary/.test(block),
  'and that gate actually wraps the emitted button');
assert(/isOwner \? 'Edit' : 'Preview'/.test(block),
  'the label matches what the person can actually do -- a viewer cannot edit');
assert(/\$\{hasGeneratedNarrative \? '' : createOrDelete\}/.test(block),
  'Create is still emitted only when nothing is generated (unchanged)');
assert(/\$\{hasGeneratedNarrative \? createOrDelete : ''\}/.test(block),
  'and Delete still trails the menu once something is (unchanged)');

// ---- Update lives on the Trip (gear) menu, not the Itinerary one ----
// It reconciles trip EVENTS against an uploaded operator PDF and never touches the
// generated narrative, so it did not belong in a menu whose every other item is about
// that write-up. Moved beside "Verify Travel Details", which is the same kind of job.
assert(!/data-tripsy-update-itinerary/.test(block),
  'Update is no longer in the itinerary menu');
{
  const tripMenuIdx = html.indexOf('data-tripsy-trip-menu="');
  const tripMenu = html.slice(tripMenuIdx, tripMenuIdx + 1400);
  assert(/data-tripsy-update-itinerary/.test(tripMenu),
    'THE ASK: it now sits on the Trip (gear) menu instead');
  assert(tripMenu.indexOf('data-tripsy-verify-travel') < tripMenu.indexOf('data-tripsy-update-itinerary'),
    'and directly after Verify Travel Details, the item it most resembles');
  assert(/hasPendingUpdatePage \? 'Resume Comparison' : 'Compare to PDF'/.test(tripMenu),
    'the resume-vs-fresh label still swaps, and both halves say COMPARE -- the feature produces a ' +
    'diff to resolve row by row, where "Update" implied it just overwrites things on its own');
  assert(/\$\{isOwner \? menuListButtonHtml\(`data-tripsy-update-itinerary/.test(tripMenu),
    'still owner-only -- it writes to trip data');
}
// The click handler is a container-wide querySelectorAll, so moving the button between
// menus needs no rewiring; assert that's still how it's found.
assert(/container\.querySelectorAll\("\[data-tripsy-update-itinerary\]"\)/.test(html),
  'the handler still binds by attribute across the whole card, independent of which menu holds it');

// ---- executed: the four cases, mirroring the template's own conditions ----
{
  // Which of the two mutually-exclusive items each state yields.
  const items = (hasGeneratedNarrative, isOwner) => {
    const out = [];
    const createOrDelete = isOwner ? (hasGeneratedNarrative ? 'Delete' : 'Create') : null;
    if (!hasGeneratedNarrative && createOrDelete) out.push(createOrDelete);
    if (hasGeneratedNarrative || !isOwner) out.push(isOwner ? 'Edit' : 'Preview');
    if (hasGeneratedNarrative && createOrDelete) out.push(createOrDelete);
    return out;
  };

  const ownerFresh = items(false, true);
  assert(ownerFresh.includes('Create') && !ownerFresh.includes('Edit'),
    'THE ASK: owner, nothing generated -> Create only, no Edit beside it');
  const ownerGenerated = items(true, true);
  assert(ownerGenerated.includes('Edit') && !ownerGenerated.includes('Create'),
    'THE ASK: owner, generated -> Edit, and Create is gone');
  assert(ownerGenerated.includes('Delete') && ownerGenerated.indexOf('Delete') === ownerGenerated.length - 1,
    'Delete replaces Create and sits last, as before');
  // The invariant, stated directly: the two never co-exist.
  for (const gen of [false, true]) {
    for (const owner of [false, true]) {
      const got = items(gen, owner);
      assert(!(got.includes('Create') && got.includes('Edit')),
        `Create and Edit never appear together (generated=${gen}, owner=${owner})`);
    }
  }
  // Viewers keep a way in, which is why the gate isn't just hasGeneratedNarrative.
  assert(items(false, false).includes('Preview'),
    'viewer, nothing generated -> still has Preview (their only on-screen route; events render without narrative)');
  assert(!items(false, false).some(i => i === 'Create' || i === 'Delete'),
    'and never sees the owner-only Create/Delete');
}
