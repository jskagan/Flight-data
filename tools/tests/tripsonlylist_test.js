// "Can you display all users with trips-only access in the trips-only access
// utilities page" (2026-09-28). The Trips-Only Access utility page was a pure
// how-to guide -- WHO currently has the access was only visible as scattered
// checkbox states on the Users page. A "Current Trips-Only Viewers" card now
// lists every driveData.tripsOnlyEmails entry, resolving display names from
// the data file's live sharing permissions (the Users page's own source of
// truth) and flagging a STALE entry -- still ticked Trips-only but no longer
// shared on the file. The list fills AFTER the page paints (the permissions
// lookup is a network round trip -- the My Trips weather lesson, same day).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async )?function ${name}\\(`));
  if (!m) return null;
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

// ---- executed: the pure list builder ----
const listHtml = new Function('esc',
  `${extractFn('tripsOnlyViewerListHtml')} return tripsOnlyViewerListHtml;`)(
  s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));

assert(/No one has Trips-only access yet/.test(listHtml([], [{ emailAddress: 'a@b.com' }])),
  'an empty trips-only list shows the empty state, whatever the sharing list holds');
{
  const out = listHtml(['mo@example.com', 'jon@example.com'], [
    { emailAddress: 'MO@example.com', displayName: 'Mo Kagan', role: 'reader' },
    { emailAddress: 'jon@example.com', role: 'reader' },
    { emailAddress: 'other@example.com', displayName: 'Unrelated Viewer', role: 'reader' },
  ]);
  assert(/Mo Kagan/.test(out) && /jon@example\.com · Trips-only viewer/.test(out) && !/Unrelated Viewer/.test(out),
    'THE ASK: every trips-only email renders a row -- display name resolved from the sharing list (case-insensitively), bare email when Drive has no name, non-trips-only viewers excluded');
  assert(!/No longer shared/.test(out) && !/⚠️/.test(out),
    'entries that ARE still shared carry no stale flag');
}
{
  const out = listHtml(['gone@example.com', 'mo@example.com'], [{ emailAddress: 'mo@example.com', displayName: 'Mo', role: 'reader' }]);
  assert(/gone@example\.com/.test(out)
    && (out.match(/No longer shared on the data file/g) || []).length === 1,
    'STALE: an email still ticked Trips-only but missing from the sharing list is flagged -- and only that one');
  assert(/un-tick it on the Users page/.test(out),
    'the stale flag comes with the remedy (un-tick on Users, or re-share the file)');
}
{
  const out = listHtml(['mo@example.com'], []);
  assert(/mo@example\.com/.test(out) && !/⚠️/.test(out),
    'an EMPTY permissions list means the Drive lookup failed -- bare emails show with NO stale flags, rather than every row wrongly flagged');
}

// ---- wiring: the page renders the card, and fills it AFTER painting ----
const page = extractFn('renderUtilitiesTripsOnly');
assert(/Current Trips-Only Viewers/.test(page) && /id="tripsonly-current-list"/.test(page),
  'the Trips-Only Access page carries the Current Trips-Only Viewers card');
assert(page.indexOf('main.innerHTML') < page.indexOf('Store.getTripsOnlyEmails()')
  && /listDriveFilePermissions\(driveFileId\)/.test(page)
  && /listEl\.innerHTML = tripsOnlyViewerListHtml\(tripsOnlyEmails, permissions\)/.test(page),
  'the fill runs after the page paints, reading the same permissions source the Users page uses -- a network call never stands in front of the render');
assert(/catch \(e\) \{ console\.error\('Trips-only list: permissions lookup failed/.test(page),
  'a failed permissions fetch degrades to the bare email list instead of erroring the card');
