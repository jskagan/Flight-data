// "Why are these clothes marked as dirty when I have not even worn them yet? Shouldn't
// clothes only be dirty after the wearing period or the day has ended?" and "Why am I getting
// the message that if I wash these clothes, I should have enough for the entire trip? Is
// that true?" (2026-11-11). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  let depth = 0;
  for (let j = html.indexOf('{', html.indexOf(')', m.index)); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const { done, summary } = new Function(`${extractFn('tripsyLaundryWearIsDone')}\n${extractFn('tripsyLaundrySummaryText')}\nreturn { done: tripsyLaundryWearIsDone, summary: tripsyLaundrySummaryText };`)();
const at = (h, m) => new Date(2030, 4, 10, h, m); // device "now": 2030-05-10
const T = '2030-05-10';
assert(done({ dayKey: '2030-05-09', events: [] }, T, at(8, 0)), 'a wearing on an earlier day has happened');
assert(!done({ dayKey: '2030-05-11', events: [] }, T, at(8, 0)), 'a wearing on a later day has not');
const dinner = { dayKey: T, events: [{ startTime: '7:00 PM', endTime: '9:30 PM' }] };
assert(!done(dinner, T, at(8, 0)) && !done(dinner, T, at(20, 0)), 'THE ASK: today\'s wearing is not dirty before or during its event');
assert(done(dinner, T, at(21, 30)), 'it is once the event has ended');
assert(!done({ dayKey: T, events: [{ startTime: '9:05 PM', endTime: '' }] }, T, at(12, 0)) && done({ dayKey: T, events: [{ startTime: '9:05 PM', endTime: '' }] }, T, at(21, 5)), 'with no end time the start time decides');
assert(!done({ dayKey: T, events: [{ startTime: '', endTime: '' }] }, T, at(23, 59)), 'an untimed wearing today is not dirty until the day is over');
assert(!done({ dayKey: T, events: [{ startTime: '9:00 AM', endTime: '10:00 AM' }, { startTime: '6:00 PM', endTime: '8:00 PM' }] }, T, at(12, 0)), 'the LAST event of the wearing decides');
assert(done({ dayKey: '2030-06-01', events: [] }, '2030-06-01', at(8, 0)), 'viewing a day other than today keeps the old rule (that day\'s wearing counts)');
assert(/should have enough clean clothes/.test(summary([])) && /should have enough/.test(summary(undefined)), 'nothing short: the summary may say one wash is enough');
const s = summary(['Underwear', 'Casual socks']);
assert(/not enough for the rest of the trip/.test(s) && /Underwear, Casual socks/.test(s) && !/should have enough/.test(s), 'THE ASK: when a garment has more wearings left than copies, the summary says so and names it');
assert(/and 2 more/.test(summary(['a', 'b', 'c', 'd', 'e'])), 'a long list is capped');
const items = extractFn('tripsyLaundryItemsForDay');
assert(/tripsyLaundryWearIsDone\(d, dayKey\) && \(!since \|/.test(items) && /tripsyLaundryWearIsDone\(d, dayKey\) && \(!sinceX/.test(items), 'the laundry list counts only wearings that have happened');
assert(/futureWears > qty \* limit\) shortAfterWash\.push/.test(items) && /out\.shortAfterWash = /.test(items), 'and reports garments one wash cannot cover');
assert(/tripsyLaundrySummaryText\(items\.shortAfterWash\)/.test(extractFn('showTripsyLaundryDay')), 'the screen shows the computed summary');
