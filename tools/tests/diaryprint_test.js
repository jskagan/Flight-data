const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
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
fs.writeFileSync('diaryprint_run.js', `
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
${html.match(/const TRIPSY_DIARY_TOKEN_RE = [^\n]*/)[0]}
${extractFn('tripsyDiaryParagraphs')}
${extractFn('tripsyDiaryScheduleLines')}
${extractFn('tripsyDayNumberFromTripStart')}
const tripsyWeatherDateLabel = k => 'DATE(' + k + ')';
const formatTripDateRange = () => 'Aug 2 – Aug 19, 2026';
const tripsySummaryRowTime = it => it.time || '';
let photoFetches = 0;
const tripsyPlacePhotoDisplayUrl = async id => { photoFetches++; return 'blob:' + id; };
let tripsyDecryptedTrips = [{ key: 'T1', name: 'LA Phil 2026 UK Trip', start: '2026-08-02', end: '2026-08-19', location: 'United Kingdom' }];
let diaryDoc = [];
const ensureTripDiariesLoaded = async () => diaryDoc;
const buildTripsyPrintDayData = async () => ({
  dayKeys: ['2026-08-03', '2026-08-04', '2026-08-05'],
  summaryByDay: new Map([
    ['2026-08-03', [{ time: '4:25 PM', ev: { summary: 'Flight', tripsyRaw: { name: 'Flight to London', address: 'LAX → LHR' } } }]],
    ['2026-08-04', []],
    ['2026-08-05', []],
  ]),
});
${extractFn('buildTripsyDiaryPrintHtml')}

// ---- nothing written yet -> nothing to print ----
diaryDoc = [];
assert(await buildTripsyDiaryPrintHtml('T1') === null, 'no diary at all prints nothing');
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', text: '   ', photos: [] }] }];
assert(await buildTripsyDiaryPrintHtml('T1') === null, 'a diary of only blank days prints nothing');
assert(await buildTripsyDiaryPrintHtml('NOPE') === null, 'an unknown trip prints nothing');

// ---- a real diary ----
diaryDoc = [{ tripKey: 'T1', days: [
  { dayKey: '2026-08-03', heading: 'Westbound', text: 'We flew out in the afternoon. [photo 1]\\n\\nDinner was somewhere over Greenland.',
    showSchedule: true, photos: [{ no: 1, driveFileId: 'f1', caption: 'Somewhere over the Atlantic', side: 'left' }] },
  { dayKey: '2026-08-04', heading: '', text: 'A quiet day.', showSchedule: false, photos: [] },
  // 08-05 deliberately absent from the diary entirely.
] }];
photoFetches = 0;
const out = await buildTripsyDiaryPrintHtml('T1');
assert(/<h1 class="dp-cover-title">LA Phil 2026 UK Trip<\\/h1>/.test(out), 'the cover names the trip');
assert(/Aug 2 – Aug 19, 2026/.test(out), 'and carries its dates');
assert((out.match(/class="dp-day"/g) || []).length === 2,
  'only days that were WRITTEN become chapters -> ' + (out.match(/class="dp-day"/g) || []).length);
assert(/Day 1 · DATE\\(2026-08-03\\)/.test(out), 'day numbering counts from the first day');
assert(/Day 2 · DATE\\(2026-08-04\\)/.test(out), 'and continues');
assert(/<h2 class="dp-dayhead">Westbound<\\/h2>/.test(out), 'a day heading prints');
assert(!/<h2 class="dp-dayhead"><\\/h2>/.test(out), 'and an empty one is omitted rather than printing blank');
// The schedule block honours the per-day flag.
assert(/dp-schedule/.test(out) && /Flight to London/.test(out), 'a kept schedule block prints');
assert((out.match(/dp-schedule/g) || []).length === 1, 'and a removed one does not');
// Paragraphs and the photo woven into one.
assert((out.match(/class="dp-para"/g) || []).length === 3, 'each paragraph prints -> ' + (out.match(/class="dp-para"/g) || []).length);
assert(/<figure class="dp-fig dp-fig--left">/.test(out), 'the photo prints on the side it was set to');
assert(/<img src="blob:f1"/.test(out), 'as a real <img>, which is what the print path waits on');
assert(/<figcaption>Somewhere over the Atlantic<\\/figcaption>/.test(out), 'with its caption');
assert(!/\\[photo 1\\]/.test(out), 'and the token itself never appears in the output');
assert(photoFetches === 1, 'each photo file is resolved once -> ' + photoFetches);

// ---- a token whose photo was removed must not print a broken figure ----
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', text: 'Orphan [photo 9] token.', photos: [] }] }];
const orphan = await buildTripsyDiaryPrintHtml('T1');
assert(!/\\[photo 9\\]/.test(orphan) && !/<figure/.test(orphan), 'a dangling token prints as nothing at all');
assert(/Orphan  token\\./.test(orphan) || /Orphan/.test(orphan), 'and the surrounding words survive');

// ---- a photo whose file will not load is skipped, not printed empty ----
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', text: 'A [photo 1] day.', photos: [{ no: 1, driveFileId: '', caption: 'x' }] }] }];
const noFile = await buildTripsyDiaryPrintHtml('T1');
assert(!/<figure/.test(noFile), 'a photo with no Drive file prints nothing');

// ---- escaping: prose is user text and must not become markup ----
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', heading: '<b>x</b>', text: 'We saw <script>alert(1)</script> signs.', photos: [] }] }];
const escd = await buildTripsyDiaryPrintHtml('T1');
assert(!/<script>/.test(escd) && /&lt;script&gt;/.test(escd), 'prose is escaped');
assert(/&lt;b&gt;x&lt;\\/b&gt;/.test(escd), 'as is a heading');
`);
