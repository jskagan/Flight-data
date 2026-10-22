// Verify Travel Details reopens from the SAVED trip after a gap is filled ("When does the trip
// details list regenerate," 2026-10-22): the report used to reopen 350 ms after closing the
// add form, from the trip object captured when the form opened -- a save replaces that object
// and finishes in the background, so the gap just filled could still be listed as missing.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) return '';
  let d = 0;
  for (let k = html.indexOf('{', i); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};

const gap = extractFn('openTripsyVerifyGapEdit');
assert(/const currentTrip = \(\) => \(tripsyDecryptedTrips \|\| \[\]\)\.find\(t => t\.key === trip\.key\) \|\| trip;/.test(gap),
  'the report is rebuilt from the trip as it now stands, not the copy captured when the form opened');
assert(/const back = \(\) => \{ overlay\.remove\(\); if \(!saving\) setTimeout\(\(\) => showTripsyVerifyTravelDialog\(currentTrip\(\)\)/.test(gap),
  'a Cancel reopens the report at once; a Save does not reopen it early');
assert(/onWriteStart: \(\) => \{ saving = true; \}/.test(gap) && /onWriteDone: \(\) => showTripsyVerifyTravelDialog\(currentTrip\(\)\)/.test(gap),
  'a Save reopens the report only once its write has landed');

const panel = extractFn('renderTripsyEditPanel');
const i = panel.indexOf("type: 'create_event'");
const createPath = panel.slice(panel.lastIndexOf('positionTripsyTimelineConnectors();', i), panel.indexOf('return;', i));
assert(/if \(createOptions && createOptions\.onWriteStart\) createOptions\.onWriteStart\(\);\s*if \(onClose\) onClose\(\);/.test(createPath),
  'the create path announces the write BEFORE closing, so the caller knows not to reopen early');
assert(/if \(writeDone\) writeDone\(ok\);\s*\}\)\(\);/.test(createPath),
  'and calls back once the write has settled, success or failure');
assert(/if \(!writeDone\) \{\s*renderTripsyEditPanel\(panel/.test(createPath),
  'a caller handling the result is not handed a reopened form inside an overlay it already removed');

// Simulate the dialog's reopen logic end to end with fakes.
let opened = [];
var tripsyDecryptedTrips = [{ key: 'k', events: ['old'] }];
var showTripsyVerifyTravelDialog = t => opened.push(t);
var tripsyBlankRaw = () => ({});
var tripsyTripIdFromKey = k => k;
var crypto = { randomUUID: () => 'u' };
let captured = null;
var renderTripsyEditPanel = (p, raw, key, name, label, opts, onClose) => { captured = { opts, onClose }; };
var document = { body: { appendChild() {} }, createElement: () => ({ style: {}, set innerHTML(v) {}, querySelector: () => ({ style: {} }), addEventListener() {}, remove() {} }) };
const realTimeout = setTimeout;
var setTimeout = (f) => f();
eval(gap);
const original = tripsyDecryptedTrips[0];
openTripsyVerifyGapEdit(original, 'transport', { day: '2030-01-01', from: 'A', to: 'B' });
captured.opts.onWriteStart();
captured.onClose();
assert(opened.length === 0, 'after Save, nothing reopens while the write is still under way');
tripsyDecryptedTrips = [{ key: 'k', events: ['old', 'new'] }];
captured.opts.onWriteDone(true);
assert(opened.length === 1 && opened[0].events.length === 2, 'once the write lands, the report opens on the UPDATED trip');
opened = [];
openTripsyVerifyGapEdit(original, 'lodging', { day: '2030-01-01' });
captured.onClose();
assert(opened.length === 1 && opened[0] === tripsyDecryptedTrips[0], 'Cancel reopens at once, also from the current trip');
