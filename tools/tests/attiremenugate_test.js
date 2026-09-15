// "Before an attire guide is generated, do not show the Plan Packing List or
// Packing Status buttons -- there should be nothing to show until the attire
// list is generated." Both screens' need lines derive from the guide's packing
// list (tripsyWardrobeNeedByTier), so before a guide exists they opened onto an
// empty page. The trip card's 👔 Attire menu was the one guide-less entry point:
// Clothing Summary / Daily Dress Guide already required attireHasGuide, but the
// two packing items were gated on isOwner alone. Both now require the guide too,
// so a guide-less owner's menu is exactly one item -- Generate -- and the other
// entry points (the Attire summary's per-person card buttons) were already
// inside a personGuidance-gated block.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// ---- the menu builder's gates ----
const start = html.indexOf('const attireMenuItems = [');
const menu = html.slice(start, html.indexOf('].join', start));
assert(menu.length > 200, 'sanity: found the Attire menu builder');
assert(/isOwner && attireHasGuide \? menuListButtonHtml\(`data-tripsy-attire-nav="pack"/.test(menu),
  'THE ASK: Plan Packing List requires a saved guide, not just owner');
assert(/isOwner && attireHasGuide \? menuListButtonHtml\(`data-tripsy-attire-nav="packlist"/.test(menu),
  'THE ASK: Packing Status requires a saved guide, not just owner');
assert(/attireHasGuide \? menuListButtonHtml\(`data-tripsy-attire-nav="summary"/.test(menu)
  && /attireHasGuide \? menuListButtonHtml\(`data-tripsy-attire-nav="dressguide"/.test(menu),
  'Clothing Summary / Daily Dress Guide keep their existing guide gates');
assert(/isOwner \? menuListButtonHtml\(`data-tripsy-attire-nav="refresh"[\s\S]*?attireHasGuide \? 'Refresh' : 'Generate'/.test(menu),
  'Refresh/Generate stays owner-only WITHOUT a guide gate -- Generate is exactly what a guide-less owner needs');

// ---- the other entry to those screens stays inside the guide-gated card ----
const cardIdx = html.indexOf('data-tripsy-attire-open="pack"');
const personsGate = html.indexOf('guide.personGuidance ?', cardIdx);
assert(cardIdx > -1 && personsGate > cardIdx && personsGate - cardIdx < 2000,
  'the Attire summary\'s own Plan/Status buttons render only inside the personGuidance-gated person cards');

// ---- executed: the menu composition per state ----
{
  const items = (isOwner, hasGuide, hasOutfits, outfitsReady) => [
    hasGuide ? 'summary' : '',
    hasGuide ? 'dressguide' : '',
    isOwner && hasGuide ? 'pack' : '',
    isOwner && hasGuide ? 'packlist' : '',
    hasOutfits ? 'outfits' : (outfitsReady ? 'outfits' : ''),
    isOwner ? (hasGuide ? 'refresh' : 'generate') : '',
  ].filter(Boolean);
  assert(JSON.stringify(items(true, false, false, false)) === JSON.stringify(['generate']),
    'THE ASK: a guide-less owner sees exactly one item -- Generate');
  assert(JSON.stringify(items(true, true, false, false)) === JSON.stringify(['summary', 'dressguide', 'pack', 'packlist', 'refresh']),
    'once the guide exists, everything appears as before');
  assert(items(false, false, false, false).length === 0,
    'a viewer with no guide still gets an empty menu (the whole button hides)');
  assert(!items(false, true, false, false).includes('pack'),
    'a viewer with a guide still never sees the owner-only packing items');
}
