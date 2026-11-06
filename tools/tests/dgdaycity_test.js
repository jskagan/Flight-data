// Daily Dress Guide headings name the day's city beside its date and carry weather on every
// day, including omitted New York days (2026-11-05). Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const extractFn = n => {
  const i = html.indexOf('function ' + n + '(');
  if (i < 0) throw new Error('missing ' + n);
  let d = 0;
  for (let k = html.indexOf('{', i); ; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}' && --d === 0) return html.slice(i, k + 1);
  }
};
(0, eval)([
  'var tripsyCanonicalCountryName = c => c;',
  'var tripsyGuessCountryFromAddress = a => /NY/.test(a) ? "United States" : "";',
  'var IN_FLIGHT = new Set(); var tripsyInFlightInfoForDay = k => IN_FLIGHT.has(k) ? {} : null;',
  'var STAYS = new Set(); var tripsyAttireNycStayDays = () => STAYS;',
  extractFn('tripsyAttireFillWeatherTargets'), extractFn('tripsyAttireDayBarCityLabel'),
].join('\n'));
STAYS = new Set(['2030-03-02', '2030-03-03']);
IN_FLIGHT = new Set(['2030-03-05']);
const lon = { city: 'London', country: 'United Kingdom' };
const t = new Map([['2030-03-01', [{ city: 'New York', country: 'United States' }]], ['2030-03-06', [lon]]]);
tripsyAttireFillWeatherTargets(t, ['2030-03-01', '2030-03-02', '2030-03-03', '2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07'], {});
assert(t.get('2030-03-02')[0].city === 'New York' && t.get('2030-03-03')[0].city === 'New York', 'THE ASK: an empty New York stay day gets New York');
assert(t.get('2030-03-04')[0].city === 'New York', 'an empty day takes the previous day\'s city');
assert(!t.has('2030-03-05'), 'a day spent in the air gets none');
assert(t.get('2030-03-07')[0].city === 'London', 'the carry-forward resumes after a day with its own city');
assert(tripsyAttireDayBarCityLabel([{ city: 'London' }, { city: 'Stuttgart' }, { city: 'London' }]) === 'London / Stuttgart', 'a moving day names each city once');
assert(tripsyAttireDayBarCityLabel(null) === '', 'no targets, no label');
const bar = extractFn('tripsyAttireDayBarHtml');
assert(/tripsyAttireDayBarCityLabel\(wxArr\)/.test(bar) && /data-tripsy-dg-city/.test(bar), 'the heading renders the city beside the date');
const load = extractFn('tripsyAttireLoadWeatherBar');
assert(/tripsyAttireNycOmittedRowsByDay\(trip\)/.test(load) && /tripsyAttireFillWeatherTargets\(/.test(load),
  'weather is loaded for the omitted New York days too, with the fallback cities filled');
