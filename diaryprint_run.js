
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const TRIPSY_DIARY_TOKEN_RE = /\[photo (\d+)\]/g;
function tripsyDiaryParagraphs(text) {
  // Blank line = paragraph break, which is what the plain-textarea mode already implies.
  // A day with no text yet still offers ONE empty paragraph, or there would be nowhere
  // to put a photo or to start typing in book mode.
  const parts = String(text || '').split(/\n\s*\n/).map(p => p.trim());
  const kept = parts.filter(p => p !== '');
  return kept.length ? kept : [''];
}
function tripsyDiaryScheduleLines(items) {
  const lines = [];
  for (const item of items || []) {
    if (item.isLayover) continue;
    const time = tripsySummaryRowTime(item) || '';
    if (item.psReservation) {
      const res = item.psReservation;
      lines.push({ time, label: `P/S Reservation${res.experience ? ' • ' + res.experience : ''}`, place: '' });
      continue;
    }
    const ev = item.ev;
    if (!ev) continue;
    const raw = ev.tripsyRaw || {};
    lines.push({ time, label: raw.name || ev.summary || '', place: raw.address || '' });
  }
  return lines;
}
function tripsyDayNumberFromTripStart(dayKey, tripStartDayKey) {
  if (!dayKey || !tripStartDayKey) return null;
  const toDayIndex = k => {
    const [y, m, d] = k.split('-').map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  };
  return toDayIndex(dayKey) - toDayIndex(tripStartDayKey) + 1;
}
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
async function buildTripsyDiaryPrintHtml(tripKey) {
  const trip = (tripsyDecryptedTrips || []).find(t => t.key === tripKey);
  if (!trip) return null;
  const diaries = await ensureTripDiariesLoaded();
  const diary = (diaries || []).find(d => d.tripKey === tripKey);
  if (!diary || !(diary.days || []).some(d => (d.text || '').trim())) return null;
  const { dayKeys, summaryByDay } = await buildTripsyPrintDayData(trip);
  const firstDayKey = dayKeys[0];
  const dayOf = key => (diary.days || []).find(d => d.dayKey === key) || null;
  // Resolve every referenced photo up front: one Drive read per file, shared by any day
  // that uses it, rather than a fetch inside the per-paragraph loop.
  const urls = new Map();
  for (const d of (diary.days || [])) {
    for (const ph of (d.photos || [])) {
      if (!ph.driveFileId || urls.has(ph.driveFileId)) continue;
      try { urls.set(ph.driveFileId, await tripsyPlacePhotoDisplayUrl(ph.driveFileId)); }
      catch (e) { /* a photo that won't load simply doesn't print */ }
    }
  }
  const sections = dayKeys.map((dayKey, i) => {
    const d = dayOf(dayKey);
    if (!d || !(d.text || '').trim()) return ''; // a day never written up is not a chapter
    const dayNumber = tripsyDayNumberFromTripStart(dayKey, firstDayKey) || (i + 1);
    const lines = (d.showSchedule !== false) ? tripsyDiaryScheduleLines(summaryByDay.get(dayKey) || []) : [];
    const scheduleHtml = lines.length ? `
      <div class="dp-schedule">
        ${lines.map(l => `<div class="dp-schedrow"><span>${esc(l.time)}</span><span>${esc(l.label)}${l.place ? ` · ${esc(l.place)}` : ''}</span></div>`).join('')}
      </div>` : '';
    const figFor = no => {
      const ph = (d.photos || []).find(x => Number(x.no) === Number(no));
      if (!ph) return '';
      const src = urls.get(ph.driveFileId);
      if (!src) return '';
      return `<figure class="dp-fig dp-fig--${esc(ph.side || 'right')}">
        <img src="${esc(src)}" alt="">
        ${ph.caption ? `<figcaption>${esc(ph.caption)}</figcaption>` : ''}
      </figure>`;
    };
    const paras = tripsyDiaryParagraphs(d.text || '')
      .map(para => `<p class="dp-para">${esc(para).replace(TRIPSY_DIARY_TOKEN_RE, (m, n) => figFor(n))}</p>`)
      .join('');
    return `
      <section class="dp-day">
        <div class="dp-daynum">Day ${dayNumber} · ${esc(tripsyWeatherDateLabel(dayKey))}</div>
        ${d.heading ? `<h2 class="dp-dayhead">${esc(d.heading)}</h2>` : ''}
        ${scheduleHtml}
        ${paras}
      </section>`;
  }).join('');
  if (!sections) return null;
  return `
    <div class="dp-book">
      <section class="dp-cover">
        <div class="dp-cover-kicker">Trip Diary</div>
        <h1 class="dp-cover-title">${esc(trip.name || 'A Trip')}</h1>
        <div class="dp-cover-sub">${esc(formatTripDateRange(trip.start, trip.end) || '')}${trip.location ? ` · ${esc(trip.location)}` : ''}</div>
      </section>
      ${sections}
    </div>`;
}

// ---- nothing written yet -> nothing to print ----
diaryDoc = [];
assert(await buildTripsyDiaryPrintHtml('T1') === null, 'no diary at all prints nothing');
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', text: '   ', photos: [] }] }];
assert(await buildTripsyDiaryPrintHtml('T1') === null, 'a diary of only blank days prints nothing');
assert(await buildTripsyDiaryPrintHtml('NOPE') === null, 'an unknown trip prints nothing');

// ---- a real diary ----
diaryDoc = [{ tripKey: 'T1', days: [
  { dayKey: '2026-08-03', heading: 'Westbound', text: 'We flew out in the afternoon. [photo 1]\n\nDinner was somewhere over Greenland.',
    showSchedule: true, photos: [{ no: 1, driveFileId: 'f1', caption: 'Somewhere over the Atlantic', side: 'left' }] },
  { dayKey: '2026-08-04', heading: '', text: 'A quiet day.', showSchedule: false, photos: [] },
  // 08-05 deliberately absent from the diary entirely.
] }];
photoFetches = 0;
const out = await buildTripsyDiaryPrintHtml('T1');
assert(/<h1 class="dp-cover-title">LA Phil 2026 UK Trip<\/h1>/.test(out), 'the cover names the trip');
assert(/Aug 2 – Aug 19, 2026/.test(out), 'and carries its dates');
assert((out.match(/class="dp-day"/g) || []).length === 2,
  'only days that were WRITTEN become chapters -> ' + (out.match(/class="dp-day"/g) || []).length);
assert(/Day 1 · DATE\(2026-08-03\)/.test(out), 'day numbering counts from the first day');
assert(/Day 2 · DATE\(2026-08-04\)/.test(out), 'and continues');
assert(/<h2 class="dp-dayhead">Westbound<\/h2>/.test(out), 'a day heading prints');
assert(!/<h2 class="dp-dayhead"><\/h2>/.test(out), 'and an empty one is omitted rather than printing blank');
// The schedule block honours the per-day flag.
assert(/dp-schedule/.test(out) && /Flight to London/.test(out), 'a kept schedule block prints');
assert((out.match(/dp-schedule/g) || []).length === 1, 'and a removed one does not');
// Paragraphs and the photo woven into one.
assert((out.match(/class="dp-para"/g) || []).length === 3, 'each paragraph prints -> ' + (out.match(/class="dp-para"/g) || []).length);
assert(/<figure class="dp-fig dp-fig--left">/.test(out), 'the photo prints on the side it was set to');
assert(/<img src="blob:f1"/.test(out), 'as a real <img>, which is what the print path waits on');
assert(/<figcaption>Somewhere over the Atlantic<\/figcaption>/.test(out), 'with its caption');
assert(!/\[photo 1\]/.test(out), 'and the token itself never appears in the output');
assert(photoFetches === 1, 'each photo file is resolved once -> ' + photoFetches);

// ---- a token whose photo was removed must not print a broken figure ----
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', text: 'Orphan [photo 9] token.', photos: [] }] }];
const orphan = await buildTripsyDiaryPrintHtml('T1');
assert(!/\[photo 9\]/.test(orphan) && !/<figure/.test(orphan), 'a dangling token prints as nothing at all');
assert(/Orphan  token\./.test(orphan) || /Orphan/.test(orphan), 'and the surrounding words survive');

// ---- a photo whose file will not load is skipped, not printed empty ----
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', text: 'A [photo 1] day.', photos: [{ no: 1, driveFileId: '', caption: 'x' }] }] }];
const noFile = await buildTripsyDiaryPrintHtml('T1');
assert(!/<figure/.test(noFile), 'a photo with no Drive file prints nothing');

// ---- escaping: prose is user text and must not become markup ----
diaryDoc = [{ tripKey: 'T1', days: [{ dayKey: '2026-08-03', heading: '<b>x</b>', text: 'We saw <script>alert(1)</script> signs.', photos: [] }] }];
const escd = await buildTripsyDiaryPrintHtml('T1');
assert(!/<script>/.test(escd) && /&lt;script&gt;/.test(escd), 'prose is escaped');
assert(/&lt;b&gt;x&lt;\/b&gt;/.test(escd), 'as is a heading');
