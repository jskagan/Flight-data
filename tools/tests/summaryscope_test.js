const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`async function ${name}(`);
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
fs.writeFileSync('summaryscope_run.js', `
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// ---- stubs: the pieces the summary branch leans on ----
let askedRows = null, calls = 0;
const generateTripsySummaryBlurbs = async (trip, rows) => {
  calls++; askedRows = rows;
  return { rows: rows.map(r => ({ row_key: r.key, blurb: 'NEW ' + r.key })) };
};
const tripsySummaryRowKey = it => it.key;
const tripsySummaryRowWantsBlurb = it => it.wants !== false;
const tripsySummaryRowPromptData = it => ({ key: it.key });
const tripsyContentFingerprint = list => 'fp:' + list.map(r => r.key).join(',');
let cache = {};
const Store = {
  getTripsyNarrativeCache: async () => cache,
  saveTripsyNarrativeSections: async secs => { Object.assign(cache, secs); return true; },
};
// the day branch is out of scope here
const tripsyNarrativeDayPromptData = () => ({});
const generateTripsyItineraryNarrative = async () => ({ days: [] });

${extractFn('tripsyGenerateNarrativeSections')}

const dayKeys = ['d1', 'd2', 'd3'];
const mk = () => new Map([
  ['d1', [{ key: 'a' }, { key: 'b' }]],
  ['d2', [{ key: 'c' }]],
  ['d3', [{ key: 'd' }, { key: 'e', wants: false }]],  // e never wants a blurb
]);
const trip = { name: 'T', location: 'L', start: '', end: '' };
const rowsNow = () => (cache['K::summary'].content.rows || []).map(r => r.row_key + '=' + r.blurb).sort();

// ---------- scoped: only the named day's rows are sent ----------
cache = { 'K::summary': { content: { rows: [
  { row_key: 'a', blurb: 'OLD a' }, { row_key: 'b', blurb: 'OLD b' },
  { row_key: 'c', blurb: 'OLD c' }, { row_key: 'd', blurb: 'OLD d' },
] } } };
calls = 0;
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d2'], summaryDayKeys: ['d2'] });
assert(calls === 1, 'one summary call');
assert(JSON.stringify(askedRows) === '[{"key":"c"}]', 'ONLY the changed day\\'s row is sent -> ' + JSON.stringify(askedRows));
assert(JSON.stringify(rowsNow()) === '["a=OLD a","b=OLD b","c=NEW c","d=OLD d"]',
  'the rest are kept from cache, the changed one replaced -> ' + rowsNow());

// ---------- unscoped (a full generate) still rewrites everything ----------
calls = 0;
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: [] });
assert(JSON.stringify(askedRows) === '[{"key":"a"},{"key":"b"},{"key":"c"},{"key":"d"}]',
  'every row is sent when unscoped -> ' + JSON.stringify(askedRows));
assert(JSON.stringify(rowsNow()) === '["a=NEW a","b=NEW b","c=NEW c","d=NEW d"]', 'and all are replaced');

// ---------- a row whose event no longer exists is dropped on merge ----------
cache = { 'K::summary': { content: { rows: [
  { row_key: 'a', blurb: 'OLD a' }, { row_key: 'gone', blurb: 'stale row' },
] } } };
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d2'], summaryDayKeys: ['d2'] });
assert(!rowsNow().some(r => r.startsWith('gone')), 'a row for a deleted event does not linger -> ' + rowsNow());
assert(rowsNow().includes('a=OLD a'), 'while a live untouched row survives');

// ---------- a row that wants no blurb is never asked for ----------
cache = { 'K::summary': { content: { rows: [] } } };
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d3'], summaryDayKeys: ['d3'] });
assert(JSON.stringify(askedRows) === '[{"key":"d"}]', 'the wants-no-blurb row is filtered out -> ' + JSON.stringify(askedRows));

// ---------- scoped to a day with no blurb-worthy rows: no call at all ----------
calls = 0;
const emptyDay = new Map([['d1', []], ['d2', [{ key: 'c' }]], ['d3', []]]);
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), emptyDay,
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d1'], summaryDayKeys: ['d1'] });
assert(calls === 0, 'an empty scope spends no API call');

// ---------- the stored fingerprint covers the FULL row set, not just the slice ----------
cache = { 'K::summary': { content: { rows: [] } } };
await tripsyGenerateNarrativeSections('K', trip, dayKeys, new Map(), mk(),
  { includeIntro: false, includeSummary: true, dayKeysToGenerate: ['d2'], summaryDayKeys: ['d2'] });
assert(cache['K::summary'].fingerprint === 'fp:a,b,c,d',
  'fingerprint describes what is stored -> ' + cache['K::summary'].fingerprint);
`);
