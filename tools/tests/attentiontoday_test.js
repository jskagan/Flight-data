// "One 'needs attention' place per trip" and a Today strip on My Trips (2026-11-10).
// Synthetic fixtures only.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`function ${name}\\(`));
  let i = html.indexOf('(', m.index), paren = 0;
  for (; i < html.length; i++) { if (html[i] === '(') paren++; else if (html[i] === ')') { paren--; if (!paren) { i++; break; } } }
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(m.index, j + 1); }
  }
}
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// ---- attention items ----
const A = new Function('esc', `${extractFn('tripsyTripAttentionItems')}\n${extractFn('tripsyTripAttentionHtml')}\nreturn { tripsyTripAttentionItems, tripsyTripAttentionHtml };`)(esc);
assert(A.tripsyTripAttentionItems({}).length === 0 && A.tripsyTripAttentionHtml('T', [], true) === '', 'no flags: no items and no line');
const all = A.tripsyTripAttentionItems({ itinerary: true, guide: true, outfits: true, parseCount: 2, parseConflict: true });
assert(all.map(i => i.kind).join(',') === 'parse,itinerary,guide,outfits', 'every raised flag becomes one item, review items first');
assert(/2 parsed items awaiting review — a possible conflict/.test(all[0].text), 'a conflict is named as one');
assert(/1 parsed item from a document or email/.test(A.tripsyTripAttentionItems({ parseCount: 1 })[0].text), 'a plain review item reads as your turn');
const closed = A.tripsyTripAttentionHtml('T', all.slice(0, 1), false), open = A.tripsyTripAttentionHtml('T', all, true);
assert(/1 thing needs attention/.test(closed) && !/data-tripsy-attention-fix/.test(closed), 'closed: one line with the count, no rows');
assert(/4 things need attention/.test(open) && (open.match(/data-tripsy-attention-fix=/g) || []).length === 4, 'open: one row with a fix button per item');
const sync = extractFn('tripsyTripAttentionSync');
assert(/if \(!container \|\| !isOwner\) return;/.test(sync), 'owner only');
assert(/data-tripsy-itin-warning/.test(sync) && /data-tripsy-attire-stale-warning/.test(sync) && /data-tripsy-outfits-warning/.test(sync) && /data-tripsy-review-proposals/.test(sync),
  'it mirrors the four existing flags rather than judging anything itself');
assert(/!tripsyItineraryGeneratingKeys\.has\(tripKey\)/.test(sync) && /!tripsyAttireGeneratingKeys\.has\(tripKey\)/.test(sync), 'a run in progress is not listed as a problem');
const wire = extractFn('tripsyWireAttentionAndToday');
assert(/container\._tripsyAttentionWired/.test(wire), 'one delegated listener, wired once');
assert(/kind === 'guide'\) \{ tripsyAttireStalePrompt\(key\)/.test(wire) && /target\.click\(\)/.test(wire), 'each fix runs the flag\'s own existing handler');
assert(/tripsyTripAttentionSync\(container, tripKey\);/.test(extractFn('tripsyAttireMenuWarningSync')), 'the clothes flags repaint the line');
assert(/data-count="\$\{pendingParseCount\}" data-conflict="1"/.test(html), 'the review badge carries its count and conflict state');

// ---- Today strip ----
const build = (opts = {}) => new Function('esc', 'driveData', 'isOwner', 'tripsyDressGuidePerson', 'Store', 'tripsyAttireMenuLaundry',
  `const TRIPSY_ATTIRE_CATEGORY_LABEL = { casual: 'Casual', formal: 'Formal' };
   const tripsyAttireNoOutfitIds = () => new Set(${JSON.stringify(opts.noOutfit || [])});
   const tripsyAttireEventBaseId = id => String(id).replace(/-(begin|end|checkin|checkout)$/, '');
   const tripsyAttireGuideIsDressOnly = g => !!g.dressOnly;
   const tripsyDayHeaderLabel = k => 'Day ' + k;
   ${extractFn('tripsyTodayOutfitBlocks')}\n${extractFn('tripsyTodayStripHtml')}\nreturn tripsyTodayStripHtml;`)(
  esc, opts.data, opts.owner !== false, opts.person || 'him', { listTripsyLaundry: () => [] }, () => ({ outstanding: opts.outstanding || [] }));
const trip = { key: 'T' };
const blocks = [{ dayKey: '2030-05-03', category: 'casual', garmentIds: ['g'], eventIds: ['activity-1'] }, { dayKey: '2030-05-03', category: 'formal', garmentIds: ['g'], eventIds: ['activity-2'] }];
const data = { tripsyAttireGuides: [{ tripKey: 'T' }], tripsyTripOutfits: [{ tripKey: 'T', person: 'him', blocks }] };
let h = build({ data, outstanding: [{ washDayKey: '2030-05-01', total: 3 }] })(trip, '2030-05-03', true);
assert((h.match(/data-tripsy-today-outfit/g) || []).length === 2 && /Outfit · Casual/.test(h) && /Outfit · Formal/.test(h), 'two outfits today: one button each, named by dress code');
assert(/data-tripsy-attire-nav="laundry" data-key="T" data-day="2030-05-03"/.test(h) && /Laundry back · 3 out/.test(h), 'Laundry, and Laundry back while a wash is out, through the Clothes menu\'s own handler');
assert(/data-tripsy-attire-nav="dressguide"/.test(h) && /data-tripsy-today-travelview/.test(h), 'the Dress guide and Travel View links');
h = build({ data: { ...data, tripsyTripOutfits: [{ tripKey: 'T', person: 'him', blocks: blocks.slice(0, 1) }] } })(trip, '2030-05-03', true);
assert(/Today’s outfit/.test(h), 'one outfit today reads "Today\'s outfit"');
h = build({ data: { ...data, tripsyTripOutfits: [{ tripKey: 'T', person: 'her', blocks: blocks.slice(0, 1) }] } })(trip, '2030-05-03', true);
assert(/data-person="her"/.test(h), 'with no outfit for the person shown, the other person\'s is offered');
h = build({ data, owner: false })(trip, '2030-05-03', true);
assert(!/laundry/.test(h) && /data-tripsy-today-outfit/.test(h), 'a viewer gets the outfit and guide links but no Laundry');
h = build({ data: { tripsyAttireGuides: [], tripsyTripOutfits: [] } })(trip, '2030-05-03', false);
assert(/NO EVENTS/.test(h) && /Travel View/.test(h) && !/dressguide/.test(h), 'a free day with no guide still gets a strip, saying so');
assert(build({ data })(trip, null, true) === '', 'no today: no strip');
assert(/tlTodayHasEvents && g\.dayKey === tlTodayKey \? tripsyTodayStripHtml\(trip, tlTodayKey, true\)/.test(html), 'it sits under today\'s day bar, inside the block the today jump lands on');
assert(/dayGroups\[0\]\.dayKey <= tlTodayKey && tlTodayKey <= dayGroups\[dayGroups\.length - 1\]\.dayKey/.test(html), 'only while today is inside the trip\'s own days');
