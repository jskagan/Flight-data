// "When I am viewing a trip from the my trips menu, can you freeze the header and just
// allow the scroll to apply to the days of the trip" (2026-10-20). Synthetic only.
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const fnSource = name => {
  let i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let k = html.indexOf(') {', i) + 2; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (!depth) return html.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
};
const css = html.slice(0, html.indexOf('</style>'));
const rule = sel => { const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : ''; };

// ---- the card + header ----
{
  const head = rule('.tripsy-trip-head');
  assert(/position:\s*sticky/.test(head) && /top:\s*0/.test(head), 'THE ASK: the trip header is sticky at the top of the window');
  assert(/background:\s*var\(--panel\)/.test(head), 'it is opaque, so the days scroll UNDER it rather than through it');
  const z = parseInt((head.match(/z-index:\s*(\d+)/) || [])[1] || '0', 10);
  assert(z > 2 && z < 100, `its z-index clears the day bars (z 2) and connectors but stays below every fixed menu/modal (got ${z})`);
  assert(/margin:\s*-22px -24px 0/.test(head) && /padding:\s*20px 22px/.test(head), 'its negative margins reach the card\'s OUTER edge (20px 22px padding + 2px border) so nothing peeks above it');
  assert(/border:\s*2px solid var\(--muted\);\s*border-bottom:\s*none;\s*border-radius:\s*10px 10px 0 0/.test(head),
    'THE ASK: the header carries the card\'s 2px top/side border, rounded like the card while in place');
  assert(/border-radius:\s*0/.test(rule('.tripsy-trip-head.tripsy-trip-head--stuck')), 'and SQUARE corners only while PINNED (a rounded corner lets the days show through the sliver outside the arc)');
  // The pinned decision: ratio < 1 under the -1px rootMargin AND the top edge at/above 0 --
  // a header merely entering from the bottom of the window is not pinned.
  const isStuck = new Function(fnSource('tripsyStickyHeadIsStuck') + '; return tripsyStickyHeadIsStuck;')();
  assert(isStuck({ intersectionRatio: 0.98, boundingClientRect: { top: 0 } }) === true, 'pinned at top:0 -> stuck');
  assert(isStuck({ intersectionRatio: 1, boundingClientRect: { top: 240 } }) === false, 'fully visible in place -> not stuck');
  assert(isStuck({ intersectionRatio: 0.5, boundingClientRect: { top: 650 } }) === false, 'half off the BOTTOM of the window -> not stuck');
  const watch = fnSource('tripsyWatchStickyTripHeads');
  assert(/rootMargin: '-1px 0px 0px 0px'/.test(watch) && /threshold: \[1\]/.test(watch) && /classList\.add\('tripsy-trip-head--stuck'\)/.test(watch),
    'the observer uses the -1px trick, and a browser without IntersectionObserver falls back to always-square (the safe side)');
  assert(/tripsyWatchStickyTripHeads\(container\);/.test(fnSource('renderTripsyEventsListImpl')), 'armed on every My Trips render');
  const cardPad = (rule('.card').match(/padding:\s*([^;]+);/) || [])[1];
  const cardBorder = (rule('.card').match(/border:\s*([^;]+);/) || [])[1];
  assert(cardPad === '20px 22px' && cardBorder === '2px solid var(--muted)', `sanity: .card is still padding 20px 22px / border 2px (got ${cardPad} / ${cardBorder}) -- the header margins and border mirror them`);
  assert(/overflow-x:\s*auto/.test(rule('.card')) && /overflow:\s*visible/.test(rule('.card.tripsy-trip-card')),
    'THE TRAP: .card is a scrollport (overflow-x:auto), inside which sticky never moves with the page -- the trip card restores overflow:visible');
  assert(/<div class="card tripsy-trip-card" style="margin-bottom:14px;">\s*<div class="tripsy-trip-head" data-tripsy-header-toggle=/.test(html),
    'the trip card and its header carry the classes; the toggle attribute is untouched');
}
// ---- the nav rail is pinned on wide screens, a plain top bar below 1100px ----
// ("Also freeze the left side navigation page, with all items always displayed when
// viewing on a wide device," same day.)
{
  const rail = rule('.rail');
  assert(/position:\s*sticky;\s*top:\s*0;\s*align-self:\s*flex-start/.test(rail), 'THE ASK: the rail is sticky at the top of the window, pinned to its own height (a stretched flex child could never stick)');
  assert(/min-height:\s*100vh;\s*max-height:\s*100vh;\s*overflow-y:\s*auto/.test(rail) && /box-sizing:\s*border-box/.test(rail),
    'sized to the viewport: the panel fills the window, and a rail taller than a short window scrolls WITHIN itself so no item is lost');
  const narrow = css.slice(css.indexOf('@media (max-width: 1100px)'));
  const narrowRail = (narrow.match(/\.rail\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/position:\s*static/.test(narrowRail) && /max-height:\s*none/.test(narrowRail) && /min-height:\s*0/.test(narrowRail), 'the <=1100px top bar undoes the pin and scrolls away as before');
}
// ---- the open-on-today scroll lands below the pinned header ----
{
  const h = fnSource('tripsyStickyTripHeaderHeight');
  const fakeHead = { getBoundingClientRect: () => ({ height: 72 }) };
  const fakeEl = { closest: sel => sel === '.tripsy-trip-card' ? { querySelector: s => s === '.tripsy-trip-head' ? fakeHead : null } : null };
  const fn = new Function(h + '; return tripsyStickyTripHeaderHeight;')();
  assert(fn(fakeEl) === 72, 'the helper reads the header height of the card holding the element');
  assert(fn({ closest: () => null }) === 0 && fn(null) === 0, 'no card / no element -> 0, never a throw');
  assert(/- 8 - tripsyStickyTripHeaderHeight\(el\);/.test(fnSource('tripsyScrollMyTripsToToday')), 'the today scroll subtracts the header height so the day bar is not hidden under it');
}
