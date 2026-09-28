// "Once an uploaded document that is flagged for parsing has been parsed,
// remove that label from the document in the document menu" (2026-09-28).
// A 'done' attachment (fully parsed AND reviewed, or nothing usable found)
// used to keep an amber "🏷️ Flagged for parsing (done)" badge that the
// owner had to click to acknowledge (Store.clearTripsyAttachmentParseFlag).
// The label now removes ITSELF: 'done' renders no badge at all, in BOTH
// menu row builders, and the whole manual clear apparatus is gone. The
// 'staged' state (parsed, awaiting review) keeps its badge -- it's a live
// link to Review Parsed Docs and disappears once review completes -- but
// reworded to "Parsed — awaiting your review" so nothing that has been
// parsed still reads "Flagged for parsing".
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  for (let j = html.indexOf('{', start); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the retired manual-clear apparatus is really gone ----
assert(!/data-tripsy-clear-parse-flag/.test(html),
  'no data-tripsy-clear-parse-flag renders or wires anywhere -- there is nothing left to click');
assert(!/async clearTripsyAttachmentParseFlag\(/.test(html),
  'Store.clearTripsyAttachmentParseFlag is removed (its only trigger was the retired badge click)');
assert(!/Flagged for parsing \((?:done|staged)\)/.test(html),
  'no "(done)"/"(staged)"-suffixed Flagged-for-parsing label survives anywhere (badges or explainer text)');

// ---- executed: both row builders, all four states ----
for (const fnName of ['tripsyAttachmentMenuRowHtml', 'tripsyDocumentMenuRowHtml']) {
  const src = extractFn(fnName);
  if (!src) { assert(false, 'could not extract ' + fnName); continue; }
  const row = new Function('a', 'isCachedLocally', `
    var esc = s => String(s == null ? '' : s);
    var isOwner = true;
    var TRIPSY_OFFLINE_REMOVE_ICON_SVG = '<svg></svg>';
    ${src}
    return ${fnName}(a, isCachedLocally);
  `);
  const base = { id: 'att-1', driveFileId: 'df-1', fileName: 'Schedule.docx', tripKey: 'tripsy-1', mimeType: 'application/pdf' };

  const pendingHtml = row({ ...base, purpose: 'parse', parseStatus: 'pending' }, false);
  assert(/🏷️ Flagged for parsing</.test(pendingHtml),
    fnName + ': a still-pending doc keeps its "Flagged for parsing" label');

  const stagedHtml = row({ ...base, purpose: 'parse', parseStatus: 'staged' }, false);
  assert(/data-tripsy-goto-parse-review/.test(stagedHtml) && /Parsed — awaiting your review/.test(stagedHtml)
    && !/Flagged for parsing/.test(stagedHtml),
    fnName + ': a parsed-awaiting-review doc links to the review page and no longer says "Flagged for parsing"');

  const doneHtml = row({ ...base, purpose: 'parse', parseStatus: 'done' }, false);
  assert(!/🏷️/.test(doneHtml) && !/[Pp]ars/.test(doneHtml) && /Schedule\.docx/.test(doneHtml),
    fnName + ': THE FIX -- a fully-parsed doc renders NO parse label at all, just the plain file row');

  const refHtml = row({ ...base, purpose: 'reference', parseStatus: null }, false);
  assert(!/🏷️/.test(refHtml),
    fnName + ': a plain reference doc still gets no badge (unchanged)');
}
