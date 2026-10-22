// Verify Travel Details: rows name the CITY, and a flight only covers a move between stays
// when it leaves from the city of the stay you check out of ("Why does the verify trip
// details view not identify a missing transportation link from beppu to fukuoka," 2026-10-22).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) return null;
  let d = 0;
  for (let k = html.indexOf('{', i); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
const constDecl = n => {
  const i = html.indexOf('const ' + n + ' =');
  if (i < 0) return null;
  let k = i, d = 0;
  for (; ; k++) {
    const c = html[k];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
    else if (c === ';' && d === 0) break;
  }
  return html.slice(i, k + 1).replace(/^const /, 'var ');
};
var tripsySlugToLabel = s => s.charAt(0).toUpperCase() + s.slice(1);

const lodge = (id, name, address, ci, co) => ({ id: 'hosting-' + id, summary: name, start: ci, end: co,
  tripsyRaw: { resource: 'hosting', id, name, address } });
const leg = (id, category, dep, arr, depAt, arrAt) => ({ id: 'transportation-' + id, start: depAt, end: arrAt,
  tripsyRaw: { resource: 'transportation', id, category, departureDescription: dep, arrivalDescription: arr, departureAt: depAt, arrivalAt: arrAt } });
const trip = events => ({ key: 't1', name: 'Test', events });
const beppu = lodge(1, 'Hilltop Ryokan', '4 Kumi, Kanzawa, Beppu, Oita 874-0045', '2030-10-29T16:00:00', '2030-10-30T09:00:00');
const seoul = lodge(2, 'Gangnam Grand', '1, Teheran-ro, Gangnam-gu Seoul South Korea, 06000', '2030-10-30T15:00:00', '2030-11-02T11:00:00');
const fukToIcn = leg(3, 'airplane', 'FUK', 'ICN', '2030-10-30T15:50:00', '2030-10-30T17:20:00');

// Resolve the function's dependencies by name, as the app has them.
let src = '', fns = ['tripsyTransportationGaps'], run = null;
for (let k = 0; k < 60 && !run; k++) {
  try {
    (0, eval)(src + fns.map(extractFn).join('\n') + ';globalThis.G = tripsyTransportationGaps;');
    G(trip([beppu, seoul, fukToIcn, leg(9, 'car', 'Somewhere', 'Elsewhere', '2030-10-30T08:00:00', '2030-10-30T09:00:00')]), []);
    G(trip([beppu, seoul, fukToIcn]), []);
    run = G;
  } catch (e) {
    const m = String(e.message).match(/(\w+) is not defined/);
    if (!m) throw e;
    if (extractFn(m[1])) fns.push(m[1]); else src += constDecl(m[1]) + '\n';
  }
}
assert(!!run, 'tripsyTransportationGaps and its helpers extract');

assert(tripsyVerifyLodgingCity('4 Kumi, Kanzawa, Beppu, Oita 874-0045') === 'Beppu', 'a Japanese address names its town, not the prefecture (Beppu, not Oita)');
assert(tripsyVerifyLodgingCity('2-6-50 Daimyo, Chuo-ku, Chuo-ku Fukuoka Japan, 810-0041') === 'Fukuoka', 'a ward before the prefecture-named city keeps the city (Fukuoka)');
assert(tripsyVerifyLodgingCity('1 Rue de Rivoli, 75001 Paris, France') === 'Paris', 'addresses outside Japan are untouched');

// The report: a flight out of Fukuoka does NOT cover leaving a Beppu ryokan.
const r1 = run(trip([beppu, seoul, fukToIcn]), []);
const gap = r1.allMoves.find(m => m.kind === 'stay' && m.day === '2030-10-30');
assert(gap && !gap.covered && gap.from === 'Hilltop Ryokan' && gap.to === 'FUK',
  'the move out of Beppu is MISSING when the day\'s flight leaves from Fukuoka');
assert(gap && gap.fromLabel === 'Hilltop Ryokan (Beppu)' && gap.toLabel === 'Fukuoka airport (FUK)',
  `the row reads "Hilltop Ryokan (Beppu) → Fukuoka airport (FUK)" (got: ${gap && gap.fromLabel} → ${gap && gap.toLabel})`);
assert(r1.allMoves.filter(m => m.day === '2030-10-30' && m.from === 'Hilltop Ryokan').length === 1,
  'the same drive is listed once, not again as an airport transfer');
const arr = r1.allMoves.find(m => m.kind === 'transfer' && m.to === 'Gangnam Grand');
assert(arr && arr.fromLabel === 'Seoul airport (ICN)' && arr.toLabel === 'Gangnam Grand (Seoul)' && !arr.covered,
  'the arrival transfer names the airport city and the hotel\'s city');

// A logged drive to the airport, before the flight, covers it.
const drive = leg(4, 'car', 'Hilltop Ryokan', 'FUK', '2030-10-30T10:00:00', '2030-10-30T12:30:00');
const r2 = run(trip([beppu, seoul, fukToIcn, drive]), []);
const m2 = r2.allMoves.find(m => m.kind === 'stay' && m.day === '2030-10-30');
assert(m2 && m2.covered && m2.toLabel === 'Gangnam Grand (Seoul)', 'with the drive logged, the move between stays is covered');

// A ground leg AFTER the flight (the car from the arrival airport) does not hide the gap.
const carSeoul = leg(5, 'car', 'ICN', 'Gangnam Grand', '2030-10-30T18:00:00', '2030-10-30T19:30:00');
const r3 = run(trip([beppu, seoul, fukToIcn, carSeoul]), []);
const m3 = r3.allMoves.find(m => m.kind === 'stay' && m.day === '2030-10-30');
assert(m3 && !m3.covered && m3.to === 'FUK', 'a car at the far end, after the flight, does not count as the drive to the airport');

// A flight leaving the hotel's own city covers the move as before.
const fukHotel = lodge(6, 'The Grand Fukuoka', '1-1 Tenjin, Chuo-ku, Chuo-ku Fukuoka Japan, 810-0001', '2030-10-27T15:00:00', '2030-10-30T11:00:00');
const r4 = run(trip([fukHotel, seoul, fukToIcn]), []);
const m4 = r4.allMoves.find(m => m.kind === 'stay');
assert(m4 && m4.covered && m4.method === 'Flight' && m4.fromLabel === 'The Grand Fukuoka', 'a flight from the hotel\'s own city still covers the move (and a name already saying the city gets no suffix)');

// The dialog shows the labels.
const dlg = extractFn('showTripsyVerifyTravelDialog');
assert(/\$\{esc\(m\.fromLabel \|\| m\.from\)\}[\s\S]{0,80}\$\{esc\(m\.toLabel \|\| m\.to\)\}/.test(dlg)
  && /data-tvv-from="\$\{esc\(m\.from \|\| ''\)\}"/.test(dlg),
  'rows display the city labels while the Add form is still prefilled with the raw names');
