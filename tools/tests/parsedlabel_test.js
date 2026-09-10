// "Send all of my travel-related emails to kaganworldtravel@gmail.com, have
// claude review all of those emails to make sure they are parsed on startup.
// Once they are parsed, label them as having been parsed (and archive them)."
// Three pieces: (1) DRIVE_SCOPE_EXTRA upgrades gmail.readonly -> gmail.modify
// so the app can write labels in the OWNER's own mailbox (the alias account is
// deliberately untouched -- nothing signs in as it); (2) syncTripsyRelays runs
// the exact Run Parse Now path once per session at startup, only when something
// actually awaits parsing; (3) labelParsedIntakeEmails labels a FULLY-parsed
// intake email's whole thread "Travel Tracker/Parsed" and archives it
// (removeLabelIds INBOX), stamping labeledAt so it happens exactly once, with
// a 403 (old readonly token) stopping the session with one explanatory toast.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
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

// ---- (1) the scope upgrade ----
assert(/const DRIVE_SCOPE_EXTRA = 'https:\/\/www\.googleapis\.com\/auth\/gmail\.modify';/.test(html),
  'THE ASK: the extra tier requests gmail.modify (a superset of the old readonly), so labeling is possible at all');
assert(!/['"`][^'"`\n]*gmail\.readonly[^'"`\n]*['"`]/.test(html),
  'no code still uses the retired readonly scope string (comments explaining the history are fine)');

// ---- (2) startup auto-parse ----
const sync = extractFn('syncTripsyRelays');
assert(/if \(!tripsyStartupAutoParseDone\) \{\s*\n\s*tripsyStartupAutoParseDone = true;/.test(sync),
  'THE ASK: parsing runs automatically at startup, at most once per session (relay polls re-enter this function)');
const scanIdx = sync.indexOf('await scanTripsyEmailIntake();');
const autoIdx = sync.indexOf('tripsyStartupAutoParseDone');
assert(scanIdx > -1 && autoIdx > scanIdx, 'the auto-parse runs AFTER the Gmail scan, so a freshly-found forward parses immediately');
assert(/const awaitingParse =[\s\S]*?!e\.parsedAt && e\.body[\s\S]*?parseStatus === 'pending'/.test(sync),
  'gated on something actually awaiting parsing -- with nothing pending, runTripsyParseNow would fire a needless cloud run');
assert(/if \(awaitingParse\) \{\s*\n\s*try \{ await runTripsyParseNow\(null\); \}/.test(sync),
  'it runs the EXACT button path (local parse first, cloud fallback), so downstream behavior is identical');

// ---- (3) the labeling sweep: call sites ----
const labelIdx = sync.indexOf('await labelParsedIntakeEmails();');
const badgeIdx = sync.indexOf('await updateTripsyStatusBadge();');
assert(labelIdx > autoIdx && badgeIdx > labelIdx,
  'syncTripsyRelays labels after the drains/auto-parse (same pass, not the next app open) and before the badge refresh');
const localParse = extractFn('runTripsyLocalParse');
assert(/await labelParsedIntakeEmails\(\);/.test(localParse),
  'a manual Run Parse Now labels right away too, without waiting for the next relay sweep');

// ---- (3) the labeling function itself: source patterns ----
const label = extractFn('labelParsedIntakeEmails');
assert(/const TRIPSY_PARSED_LABEL_NAME = 'Travel Tracker\/Parsed';/.test(html), 'the label has one named constant');
assert(/e\.parsedAt && !e\.labeledAt && !attachmentsStillPending\(e\.id\)/.test(label),
  'FULLY parsed only: a stamped body whose own attachment is still pending is not labeled yet');
assert(/threads\/\$\{msg\.threadId\}\/modify/.test(label) && /removeLabelIds: \['INBOX'\]/.test(label),
  'THE ASK: the whole thread (forward + the original it sits with) is labeled AND archived out of the inbox');
assert(/e\.labeledAt = new Date\(\)\.toISOString\(\);/.test(label),
  'each email is stamped labeledAt so it is labeled exactly once, and a failure retries next sweep');
assert(/tripsyGmailLabelingUnavailable = true;[\s\S]*?sign out and back in/.test(label),
  'a 403 (token still on the old readonly grant) stops the session with ONE explanatory toast, not an error per email');
assert(/Gmail API error 404/.test(label), 'an email deleted from Gmail since the scan is stamped rather than retried forever');
assert(/if \(labeled\) \{\s*\n\s*try \{ await persistDriveData\(\); \}/.test(label), 'one persist for the whole sweep, only when something changed');

// ---- gmailApiPost exists and carries auth + JSON ----
const post = extractFn('gmailApiPost');
assert(/method: 'POST'/.test(post) && /Authorization: `Bearer \$\{driveAccessToken\}`/.test(post) && /'Content-Type': 'application\/json'/.test(post),
  'the write helper mirrors gmailApiFetch (auth header, JSON body, same error shape)');

// ---- executed: the eligibility filter + the sweep loop against a stub ----
(async () => {
  const calls = [];
  const ctx = {
    isOwner: true,
    driveData: {
      tripsyEmailIntake: [
        { id: 'm-done', parsedAt: 't', body: '' },                       // fully parsed -> label
        { id: 'm-pending', body: 'x' },                                  // not parsed -> skip
        { id: 'm-docx', parsedAt: 't' },                                 // body parsed, attachment pending -> skip
        { id: 'm-labeled', parsedAt: 't', labeledAt: 't' },              // already labeled -> skip
        { id: 'm-gone', parsedAt: 't' },                                 // deleted from Gmail -> 404 -> stamp
      ],
      tripsyAttachments: [
        { sourceEmailId: 'm-docx', purpose: 'parse', parseStatus: 'pending' },
        { sourceEmailId: 'm-done', purpose: 'parse', parseStatus: 'staged' },
      ],
    },
    persistCount: 0,
  };
  const gmailApiFetch = async url => {
    calls.push('GET ' + url);
    if (url.endsWith('/labels')) return { labels: [{ id: 'L7', name: 'Travel Tracker/Parsed' }] };
    if (url.includes('/messages/m-gone')) throw new Error('Gmail API error 404: not found');
    const id = url.match(/messages\/([^?]+)/)[1];
    return { threadId: 'thread-' + id };
  };
  const gmailApiPost = async (url, body) => { calls.push('POST ' + url + ' ' + JSON.stringify(body)); return { id: 'L-new' }; };
  const src = extractFn('labelParsedIntakeEmails').replace(/^async function /, 'var labelParsedIntakeEmails = async function ');
  const run = new Function('isOwner', 'tripsyGmailLabelingUnavailable', 'driveData', 'gmailApiFetch', 'gmailApiPost', 'persistDriveData', 'toast', 'TRIPSY_PARSED_LABEL_NAME',
    'var tripsyParsedLabelId = null;\n' + src + '\nreturn labelParsedIntakeEmails();');
  const toasts = [];
  const labeled = await run(true, false, ctx.driveData, gmailApiFetch, gmailApiPost, async () => { ctx.persistCount++; }, t => toasts.push(t), 'Travel Tracker/Parsed');

  assert(labeled === 2, 'labeled the fully-parsed email and stamped the Gmail-deleted one (2 total)');
  const modify = calls.find(c => c.startsWith('POST') && c.includes('/threads/thread-m-done/modify'));
  assert(!!modify && modify.includes('"addLabelIds":["L7"]') && modify.includes('"removeLabelIds":["INBOX"]'),
    'THE ASK: the parsed email\'s thread got the existing Parsed label added and INBOX removed (archived)');
  assert(!calls.some(c => c.includes('m-pending') || c.includes('m-docx') || c.includes('m-labeled')),
    'unparsed, attachment-pending, and already-labeled emails were never touched');
  assert(ctx.driveData.tripsyEmailIntake[0].labeledAt && ctx.driveData.tripsyEmailIntake[4].labeledAt,
    'both handled entries carry labeledAt now');
  assert(!ctx.driveData.tripsyEmailIntake[2].labeledAt, 'the attachment-pending email stays unstamped for a later sweep');
  assert(ctx.persistCount === 1, 'one persist for the sweep');
  assert(!calls.some(c => c.startsWith('POST') && c.endsWith('/labels {"name":"Travel Tracker/Parsed","labelListVisibility":"labelShow","messageListVisibility":"show"}')),
    'the label already existed, so it was found rather than created again');

  // 403 (old readonly token): one toast, session flag set, no per-email spam.
  const toasts2 = [];
  const run403 = new Function('isOwner', 'tripsyGmailLabelingUnavailable', 'driveData', 'gmailApiFetch', 'gmailApiPost', 'persistDriveData', 'toast', 'TRIPSY_PARSED_LABEL_NAME',
    'var tripsyParsedLabelId = null;\n' + src + '\nreturn labelParsedIntakeEmails();');
  const n = await run403(true, false,
    { tripsyEmailIntake: [{ id: 'a', parsedAt: 't' }, { id: 'b', parsedAt: 't' }], tripsyAttachments: [] },
    async () => { throw new Error('Gmail API error 403: insufficient scope'); },
    async () => ({}), async () => {}, t => toasts2.push(t), 'Travel Tracker/Parsed');
  assert(n === 0 && toasts2.length === 1 && /sign out and back in/.test(toasts2[0]),
    'a readonly-scoped token yields exactly one "sign out and back in" toast and labels nothing');
})();
