const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`) >= 0 ? html.indexOf(`function ${name}(`) : html.indexOf(`async function ${name}(`);
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
fs.writeFileSync('autofill_run.js', `
// ---- tiny DOM shim: inputs that remember values and record 'input' events ----
let inputEvents = [];
const mkInput = (field, value = '') => ({
  field, value,
  dispatchEvent(e) { inputEvents.push(this.field); return true; },
  addEventListener(type, fn) { this['on_' + type] = fn; },
});
global.Event = class { constructor(type) { this.type = type; } };
let dialogCalls = [];
let dialogAnswer = {};
const esc = s => String(s == null ? '' : s);
// stub the dialog: the real one is DOM-heavy; what matters here is what it is ASKED
const tripsyPlaceConflictDialog = async (placeName, rows) => {
  dialogCalls.push({ placeName, keys: rows.map(r => r.key), rows });
  return typeof dialogAnswer === 'function' ? dialogAnswer(rows) : dialogAnswer;
};
let tripsyDecryptedTrips = [{ key: 'T1', location: 'London' }];
let lookupResult = null;
let lookupQueries = [];
const tripsyLookupPlaceContactDetails = async q => { lookupQueries.push(q); return lookupResult; };

${extractFn('tripsyJoinList')}
${extractFn('tripsyWireNameLookupAutofill')}

const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};

// A panel of fields, wired the way the real edit form is.
const makePanel = (vals = {}) => {
  const inputs = {
    name: mkInput('name', vals.name || ''),
    address: mkInput('address', vals.address || ''),
    website: mkInput('website', vals.website || ''),
    phone: mkInput('phone', vals.phone || ''),
  };
  const status = { style: {}, textContent: '' };
  const panel = {
    querySelector(sel) {
      const m = sel.match(/data-tripsy-edit-field="([a-z]+)"/);
      return m ? (inputs[m[1]] || null) : null;
    },
  };
  // the real code appends a status div via nameInput.parentElement.parentElement
  inputs.name.parentElement = { parentElement: { appendChild: el => { inputs.status = el; } } };
  global.document = { createElement: () => status };
  return { panel, inputs, status };
};
const fire = async (h, newName) => { h.inputs.name.value = newName; await h.inputs.name.on_change(); };

// ---------- 1. empty fields are filled outright, all three of them ----------
lookupResult = { displayName: 'Sabor', address: '35 Heddon St, London', website: 'https://saborrestaurants.co.uk/', phone: '020 3319 8130' };
let h = makePanel({ name: 'Gun Powder' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(h.inputs.address.value === '35 Heddon St, London', 'address filled');
assert(h.inputs.website.value.startsWith('https://sabor'), 'website filled');
assert(h.inputs.phone.value === '020 3319 8130', 'PHONE filled -- the new field');
assert(dialogCalls.length === 0, 'no dialog when nothing disagreed');
assert(/Filled address, website and phone/.test(h.status.textContent), 'all three named in the status line -> ' + h.status.textContent);
assert(inputEvents.includes('address') && inputEvents.includes('phone'), 'each filled field fires input so Save appears');

// ---------- 2. existing DIFFERENT values raise a dialog, one row each ----------
dialogCalls = []; inputEvents = []; dialogAnswer = {};
h = makePanel({ name: 'Gun Powder', address: '20 Greek Street, London', website: 'https://gunpowderlondon.com', phone: '020 7426 0542' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(dialogCalls.length === 1, 'the dialog is raised');
assert(JSON.stringify(dialogCalls[0].keys) === '["address","website","phone"]', 'all three conflicts offered -> ' + dialogCalls[0].keys);
assert(dialogCalls[0].rows[0].current === '20 Greek Street, London', 'it carries the CURRENT value');
assert(dialogCalls[0].rows[0].found === '35 Heddon St, London', 'and the FOUND value');
// Answered "keep all current" -> nothing is touched.
assert(h.inputs.address.value === '20 Greek Street, London', 'declining keeps the current address');
assert(inputEvents.length === 0, 'and nothing is marked dirty');

// ---------- 3. per-field choice is honoured ----------
dialogCalls = []; inputEvents = [];
dialogAnswer = rows => { const o = {}; for (const r of rows) if (r.key !== 'website') o[r.key] = r.found; return o; };
h = makePanel({ name: 'Gun Powder', address: '20 Greek Street, London', website: 'https://gunpowderlondon.com', phone: '020 7426 0542' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(h.inputs.address.value === '35 Heddon St, London', 'the chosen address is applied');
assert(h.inputs.phone.value === '020 3319 8130', 'and the chosen phone');
assert(h.inputs.website.value === 'https://gunpowderlondon.com', 'the declined website is left alone');

// ---------- 4. a mix: empty field filled silently, differing field asked ----------
dialogCalls = []; dialogAnswer = {};
h = makePanel({ name: 'Gun Powder', address: '20 Greek Street, London' }); // website+phone empty
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(JSON.stringify(dialogCalls[0].keys) === '["address"]', 'only the differing field is asked about');
assert(h.inputs.website.value.startsWith('https://sabor') && h.inputs.phone.value === '020 3319 8130',
  'the empty ones are filled without asking');

// ---------- 5. equal-but-formatted-differently is NOT a conflict ----------
dialogCalls = [];
h = makePanel({ name: 'Gun Powder', address: '  35 heddon st, LONDON ', website: 'https://saborrestaurants.co.uk', phone: '020 3319 8130' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(dialogCalls.length === 0, 'case, spacing and a trailing slash do not count as disagreement');
assert(/nothing to change/.test(h.status.textContent), 'and it says so -> ' + h.status.textContent);

// ---------- 6. a blur that does not change the name spends no call ----------
lookupQueries = [];
h = makePanel({ name: 'Sabor' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(lookupQueries.length === 0, 'no lookup when the name is unchanged');
await fire(h, 'Sabor - Mayfair');
assert(lookupQueries.length === 1, 'but a real change does look up');
assert(/Sabor - Mayfair, London/.test(lookupQueries[0]), "and appends the trip's location -> " + lookupQueries[0]);

// ---------- 7. only lodging and restaurants ----------
lookupQueries = [];
h = makePanel({ name: 'x' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'concert' }, 'T1');
await fire(h, 'Royal Albert Hall');
assert(lookupQueries.length === 0, 'a concert does not trigger a lookup');
h = makePanel({ name: 'x' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'hosting' }, 'T1');
await fire(h, "Brown's Hotel");
assert(lookupQueries.length === 1, 'lodging does');

// ---------- 8. a place with no phone published leaves the field alone ----------
lookupResult = { displayName: 'Sabor', address: '35 Heddon St', website: '', phone: '' };
dialogCalls = [];
h = makePanel({ name: 'Gun Powder' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Sabor');
assert(h.inputs.phone.value === '' && h.inputs.website.value === '', 'missing fields are simply not filled');
assert(/Filled address from/.test(h.status.textContent), 'and only the real one is named');

// ---------- 9. no match at all fails soft ----------
lookupResult = null;
h = makePanel({ name: 'Gun Powder', address: '20 Greek Street' });
tripsyWireNameLookupAutofill(h.panel, { resource: 'activity', category: 'restaurant' }, 'T1');
await fire(h, 'Nonexistent Place XYZ');
assert(h.inputs.address.value === '20 Greek Street' && h.status.textContent === '', 'no match changes nothing and says nothing');
`);
