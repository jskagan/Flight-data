const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  let start = html.indexOf(`async function ${name}(`);
  if (start < 0) start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('not found: ' + name);
  let i = html.indexOf('{', start), depth = 0;
  for (let j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (!depth) return html.slice(start, j + 1); }
  }
}
const ORDER = "const TRIPSY_ATTIRE_CATEGORY_ORDER = ['athletic','casual','smart_casual','semi_formal','cocktail','formal','black_tie'];";
const src = ['tripsyAttireDisplayCategory','tripsyDressGuideUsedCategories','tripsyDressGuideFilterLabel'].map(extractFn).join('\n');
fs.writeFileSync('filter_run.js', `
${ORDER}
let tripsyDressGuideFilter = new Set();
${src}
const A=(id,cat)=>({id,displayCategory:cat,category:cat});
const guide = { days: [
  { dayKey:'2026-08-13', events:[A('a','casual'),A('b','casual'),A('c','cocktail')] },
  { dayKey:'2026-08-14', events:[A('d','casual'),A('e','cocktail'),A('f','formal')] },
  { dayKey:'2026-08-15', events:[A('g','smart_casual')] },
]};
const assert=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m); if(!c) process.exitCode=1;};
// Only tiers actually used are offered, in canonical dressiness order
const used = tripsyDressGuideUsedCategories(guide);
assert(JSON.stringify(used)===JSON.stringify(['casual','smart_casual','cocktail','formal']), 'offers only used tiers, in order -> '+used.join(','));
assert(!used.includes('black_tie') && !used.includes('athletic'), 'unused tiers not offered');
// Label
assert(tripsyDressGuideFilterLabel()==='Filter','label with no filter');
tripsyDressGuideFilter.add('cocktail');
assert(tripsyDressGuideFilterLabel()==='Filter (1)','label with 1');
tripsyDressGuideFilter.add('formal');
assert(tripsyDressGuideFilterLabel()==='Filter (2)','label with 2 (multi-select)');
// Simulate the render's day/row filtering
const filterOn = () => tripsyDressGuideFilter.size>0;
const shownDays = () => guide.days.filter(d => !filterOn() || d.events.some(ev=>tripsyDressGuideFilter.has(tripsyAttireDisplayCategory(ev))));
const shownRows = () => guide.days.flatMap(d => d.events.filter(ev=>!filterOn()||tripsyDressGuideFilter.has(tripsyAttireDisplayCategory(ev))));
assert(shownDays().map(d=>d.dayKey).join(',')==='2026-08-13,2026-08-14','cocktail+formal -> only days with matches (15th dropped)');
assert(shownRows().map(r=>r.id).join(',')==='c,e,f','only matching events shown');
tripsyDressGuideFilter.clear();
assert(shownDays().length===3 && shownRows().length===7,'cleared -> everything back (3 days, 7 events)');
tripsyDressGuideFilter.add('black_tie');
assert(shownDays().length===0,'filter with no matches -> no days (empty-state message shows)');
console.log('DONE');
`);
