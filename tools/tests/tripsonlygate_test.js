// "If a user has trips only access but not Gmail access, when that user logs in can
// their sign-in page only show travel view instead of giving them the option for the
// full travel tracker functionality" (2026-09-29). The gate renders BEFORE identity is
// known, so completeSignIn records a per-device hint (like SCOPE_TIER_KEY) and the
// gate reads it on the next visit.
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

// ---- the hint rule ----
const hintFor = new Function(extractFn('tripsOnlyDeviceHintFor') + '\nreturn tripsOnlyDeviceHintFor;')();
assert(hintFor(true, false) === true, 'THE ASK: trips-only with NO Gmail access -> Travel-View-only gate');
assert(hintFor(true, true) === false, 'trips-only but granted Gmail access -> normal gate');
assert(hintFor(true, false, true) === false, '"Show My Trips" ticked on the Users page -> the full gate (Use Travel Tracker) stays, even with no Gmail access');
assert(hintFor(true, false, false) === true, 'unticked -> Travel-View-only, same as before the checkbox existed');
assert(hintFor(false, false) === false && hintFor(false, true) === false, 'an ordinary viewer or the owner -> normal gate');

// ---- persistence round trip ----
{
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const api = new Function('localStorage', "const TRIPS_ONLY_DEVICE_KEY = 'k';\n" + extractFn('loadTripsOnlyDeviceHint') + '\n' + extractFn('saveTripsOnlyDeviceHint')
    + '\nreturn { load: loadTripsOnlyDeviceHint, save: saveTripsOnlyDeviceHint };')(localStorage);
  assert(api.load() === false, 'a fresh device has no hint -> both buttons, exactly as before');
  api.save(true); assert(api.load() === true, 'a trips-only sign-in records the hint');
  api.save(false); assert(api.load() === false && !('k' in store), 'a later non-trips-only sign-in clears it (removed, not left as a stale value)');
  const broken = new Function('localStorage', "const TRIPS_ONLY_DEVICE_KEY = 'k';\n" + extractFn('loadTripsOnlyDeviceHint') + '\nreturn loadTripsOnlyDeviceHint;')(
    { getItem() { throw new Error('blocked'); } });
  assert(broken() === false, 'blocked storage fails soft to the normal gate');
}

// ---- the gate shaping ----
{
  const els = {
    'signin-btn': { style: { display: '' }, className: 'btn primary' },
    'signin-travelview-btn': { style: { display: '' }, className: 'btn' },
    'signin-show-all-btn': { style: { display: 'none' } },
  };
  const apply = new Function('document', extractFn('applyTripsOnlySignInGate') + '\nreturn applyTripsOnlySignInGate;')({ getElementById: id => els[id] || null });
  apply(true);
  assert(els['signin-btn'].style.display === 'none', 'THE ASK: the full "Use Travel Tracker" option is hidden');
  assert(els['signin-travelview-btn'].className === 'btn primary', 'Travel View becomes the one primary button');
  assert(els['signin-show-all-btn'].style.display === '', 'a small "Show all options" escape shows for someone else on the device');
  apply(false);
  assert(els['signin-btn'].style.display === '' && els['signin-travelview-btn'].className === 'btn' && els['signin-show-all-btn'].style.display === 'none',
    '"Show all options" (or a normal device) restores the original two-button gate');
}

// ---- wiring ----
assert(/<button id="signin-show-all-btn"[^>]*style="display:none;/.test(html), 'the escape link is in the gate markup, hidden by default');
const init = extractFn('initGoogleAuth');
assert(/applyTripsOnlySignInGate\(loadTripsOnlyDeviceHint\(\)\)/.test(init)
  && /signin-show-all-btn[\s\S]{0,200}applyTripsOnlySignInGate\(false\)/.test(init),
  'initGoogleAuth shapes the gate from the hint before it can show, and wires the escape');
const csi = extractFn('completeSignIn');
assert(/const tripsOnlyDevice = tripsOnlyDeviceHintFor\(isTripsOnlyUser, needsExtraScope, showMyTrips\);\s*saveTripsOnlyDeviceHint\(tripsOnlyDevice\);\s*if \(tripsOnlyDevice\) saveTravelViewPref\(true\);/.test(csi),
  'completeSignIn corrects the hint on every sign-in (Gmail access = the extra scope tier) and lands such a user in Travel View');
assert(csi.indexOf('tripsOnlyDeviceHintFor(') > csi.indexOf('isTripsOnlyUser = !isOwner') && csi.indexOf('tripsOnlyDeviceHintFor(') < csi.indexOf('if (loadTravelViewPref())'),
  'the hint is computed after the trips-only tier resolves and before the Travel View landing check');

// ---- "Show My Trips" (Users page, 2026-09-29) ----
assert(/const showMyTrips = isTripsOnlyUser && \(await Store\.getTripsOnlyShowMyTripsEmails\(\)\)\.includes\(currentUserEmail\.toLowerCase\(\)\);/.test(csi),
  'completeSignIn reads the Show My Trips list for a trips-only viewer');
const users = extractFn('renderUsersListBody');
assert(/data-user-showmytrips-toggle/.test(users) && /Show My Trips\s*<\/label>/.test(users),
  'THE ASK: each Users row has a third checkbox, "Show My Trips"');
assert(users.indexOf('data-user-tripsonly-toggle') < users.indexOf('data-user-showmytrips-toggle data-email'),
  'it sits under the Trips-only checkbox');
assert(/\$\{tripsOnlyChecked \? '' : 'disabled'\}/.test(users) && /const showMyTripsChecked = tripsOnlyChecked && /.test(users),
  'it is disabled (and unchecked) unless Trips-only is on -- it only means something for a trips-only viewer');
assert(/Store\.setTripsOnlyShowMyTripsForEmail\(email, enabled\)/.test(users), 'toggling it saves through the Store');

// executed: the Store pair, and leaving trips-only clears the flag
{
  const src = html.slice(html.indexOf('  async getTripsOnlyEmails() {'), html.indexOf('  async deleteInvoice(invoiceNo) {'));
  const run = new Function('driveData', 'persistDriveData', 'const Store = {' + src + '}; return Store;');
  const data = { tripsOnlyEmails: ['a@x.com'] };
  const S = run(data, async () => {});
  (async () => {
    await S.setTripsOnlyShowMyTripsForEmail('A@x.com', true);
    assert((await S.getTripsOnlyShowMyTripsEmails()).join() === 'a@x.com', 'ticking stores the lowercased email');
    await S.setTripsOnlyShowMyTripsForEmail('a@x.com', true);
    assert(data.tripsOnlyShowMyTripsEmails.length === 1, 'idempotent');
    await S.setTripsOnlyForEmail('a@x.com', false);
    assert(data.tripsOnlyShowMyTripsEmails.length === 0, 'turning Trips-only off drops Show My Trips too, so a re-add starts Travel-View-only');
    const fail = run({}, async () => { throw new Error('boom'); });
    const r = await fail.setTripsOnlyShowMyTripsForEmail('b@x.com', true);
    assert(r.ok === false && r.error === 'boom', 'a failed save reports the error so the checkbox reverts');
  })();
}
