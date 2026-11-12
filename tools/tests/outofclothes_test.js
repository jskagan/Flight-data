// "Let's add an 'Out of Clothes' button to the clothing screens that will show what days I
// will run out of what categories of items" (2026-11-11). Synthetic fixtures only.
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
const { shortDays, summary, toHtml, category } = new Function(`
  const esc = s => String(s);
  const tripsyDayHeaderLabel = d => 'D' + d.slice(8);
  const TRIPSY_ATTIRE_PACKING_GROUP_LABEL = { tops: 'Tops', pants: 'Pants', essentials: 'Underwear', footwear: 'Footwear', accessories: 'Accessories' };
  const tripsyGarmentTypeKey = n => /sock/i.test(n) ? 'socks' : /underwear|boxer/i.test(n) ? 'underwear' : /undershirt/i.test(n) ? 'undershirt' : '';
  const tripsyAttirePackingGroupOf = it => /polo|shirt/i.test(it.name) ? 'tops' : 'accessories';
  ${extractFn('tripsyLaundryWearDebtStep')}
  ${extractFn('tripsyOutOfClothesCategory')}
  ${extractFn('tripsyOutOfClothesShortDays')}
  ${extractFn('tripsyOutOfClothesSummary')}
  ${extractFn('tripsyOutOfClothesHtml')}
  return { shortDays: tripsyOutOfClothesShortDays, summary: tripsyOutOfClothesSummary, toHtml: tripsyOutOfClothesHtml, category: tripsyOutOfClothesCategory };`)();
const days = ['2030-05-01', '2030-05-02', '2030-05-03', '2030-05-04', '2030-05-05', '2030-05-06'];
const none = () => 0;
// 3 pairs, one wear each, worn every day: clean for 3 days, short on the last 3.
assert(JSON.stringify(shortDays(days, days, 1, () => 3, none, none)) === JSON.stringify(days.slice(3)), 'THE ASK: every short day is listed, not only the first');
assert(shortDays(days, days, 10, () => 1, none, none).length === 0, 'a ten-wear pair of trousers worn six times never runs out');
assert(shortDays(days, days, Infinity, () => 1, none, none).length === 0, 'a never-laundered garment never runs out');
assert(JSON.stringify(shortDays(days, days, 1, () => 3, d => d === '2030-05-04' ? 3 : 0, none)) === '[]', 'a recorded wash that comes back restores the clean stock');
assert(JSON.stringify(shortDays(days, ['2030-05-05'], 1, d => d > '2030-05-03' ? 0 : 1, none, none)) === '["2030-05-05"]', 'a garment shipped home and then scheduled is short that day');
assert(JSON.stringify(shortDays(days, days, 1, () => 3, none, d => d === '2030-05-04' ? 1 : 0)) === JSON.stringify(days.slice(4)), 'a Not Dirty credit buys one more wearing');
assert(category('Casual socks', 'essentials') === 'Socks' && category('Boxers / underwear', 'essentials') === 'Underwear' && category('Undershirts', 'essentials') === 'Undershirts', 'socks, underwear and undershirts are their own categories');
assert(category('Blue Polo', 'tops') === 'Tops' && category('Blue Polo', '') === 'Tops', 'other garments use their packing group, inferred from the name when unset');
const rows = [
  { name: 'Underwear', category: 'Underwear', shortDays: ['2030-05-04', '2030-05-05'] },
  { name: 'Blue Polo', category: 'Tops', shortDays: ['2030-05-03'] },
  { name: 'Red Polo', category: 'Tops', shortDays: ['2030-05-03', '2030-05-06'] },
  { name: 'Jeans', category: 'Pants', shortDays: [] },
];
const sum = summary(rows, '2030-05-01');
assert(sum.length === 2 && sum[0].category === 'Tops' && sum[1].category === 'Underwear', 'categories that never run short are left out; the earliest comes first');
assert(sum[0].firstDay === '2030-05-03' && sum[0].shortBy === 3 && sum[0].days.length === 2 && sum[0].days[0].names.length === 2, 'a category counts every short wearing and groups them by day');
assert(summary(rows, '2030-05-04').find(c => c.category === 'Tops').shortBy === 1, 'days before "from" are not reported');
const h = toHtml(sum);
assert(/data-ooc-category="Tops"/.test(h) && /out from D03/.test(h) && /short by 3 wearings/.test(h) && /Blue Polo, Red Polo/.test(h), 'the list names the category, its first day, the shortfall and the garments');
assert(/short by 2 wearings/.test(h) && !/— Underwear</.test(h), 'a one-garment category lists just its days');
assert(/data-ooc-none/.test(toHtml([])) && /enough clean clothes/.test(toHtml([])), 'nothing short says so');
// Wiring.
assert((html.match(/data-tripsy-out-of-clothes>/g) || []).length === 2, 'the Daily Dress Guide and Clothing Summary toolbars each have the button');
assert(/data-tripsy-attire-nav="outofclothes"/.test(html) && /case 'outofclothes': showTripsyOutOfClothes\(/.test(html), 'the Clothes menu has the item and opens the screen');
assert(/data-laundry-out-of-clothes/.test(extractFn('showTripsyLaundryDay')) && /showTripsyOutOfClothes\(tripKey, person\)/.test(extractFn('showTripsyLaundryDay')), 'the Laundry screen has the button');
const rowsFn = extractFn('tripsyOutOfClothesRows');
assert(/tripsyWardrobePhysicalQtyById/.test(rowsFn) && /tripsyShipHomeQtyBefore/.test(rowsFn) && /tripsyLaundryReturnCredits/.test(rowsFn) && /listLaundryNotDirty/.test(rowsFn), 'the forecast counts physical copies, ship-home boxes, returned washes and Not Dirty credits');
assert(/2147483130/.test(extractFn('showTripsyOutOfClothes')), 'the screen sits above the laundry screen');
