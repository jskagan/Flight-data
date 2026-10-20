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
  assert(/margin:\s*0 -24px 0/.test(head) && /padding:\s*20px 22px/.test(head), 'its side margins reach the card\'s OUTER edge (22px padding + 2px border); NO negative top margin (Safari pins a sticky box by its margin edge, which left a band above the header)');
  const tripCard = rule('.card.tripsy-trip-card');
  assert(/padding-top:\s*0/.test(tripCard) && /border-top:\s*none/.test(tripCard), 'the trip card hands its top padding and top border to the header instead');
  assert(/border:\s*2px solid var\(--muted\);\s*border-bottom:\s*none;\s*border-radius:\s*10px 10px 0 0/.test(head),
    'THE ASK: the header carries the card\'s 2px top/side border, rounded like the card while in place');
  // Rounded corners survive the pin ("Is it now possible to keep rounded corners on the
  // scroll?"): a page-background strip behind the header's top edge fills the slivers outside
  // the arcs, so the days scrolling beneath never show there -- no observer, no class.
  const before = rule('.tripsy-trip-head::before');
  assert(/position:\s*absolute/.test(before) && /z-index:\s*-1/.test(before) && /background:\s*var\(--bg\)/.test(before), 'THE ASK: the header\'s ::before is a page-background strip BEHIND the header (z -1 in its own stacking context)');
  assert(/left:\s*-2px;\s*right:\s*-2px;\s*top:\s*-2px;\s*height:\s*12px/.test(before), 'it spans the border box and covers the 10px corner radius');
  assert(/isolation:\s*isolate/.test(head), 'the header is an explicit stacking context, so the z:-1 strip is behind the header even where sticky alone would not make one');
  // WHILE PINNED the strip becomes a cap reaching above the header: the iPad app scrolls the
  // page under the translucent status bar while pinned elements stop at its bottom edge, so
  // already-scrolled rows showed in that band ("This is still not working as shown on this image").
  const cap = rule('.tripsy-trip-head.tripsy-trip-head--stuck::before');
  assert(/top:\s*calc\(-62px - env\(safe-area-inset-top, 0px\)\)/.test(cap) && /height:\s*calc\(72px \+ env\(safe-area-inset-top, 0px\)\)/.test(cap),
    'THE ASK: pinned, the cap reaches 60px (+ any safe-area inset) above the header to cover the status-bar band');
  const isStuck = new Function(fnSource('tripsyStickyHeadIsStuck') + '; return tripsyStickyHeadIsStuck;')();
  assert(isStuck({ intersectionRatio: 0.98, boundingClientRect: { top: 0 } }) === true, 'pinned at top:0 -> stuck');
  assert(isStuck({ intersectionRatio: 1, boundingClientRect: { top: 240 } }) === false, 'fully visible in place -> not stuck (the cap would paint over the previous card)');
  assert(isStuck({ intersectionRatio: 0.5, boundingClientRect: { top: 650 } }) === false, 'half off the BOTTOM of the window -> not stuck');
  const watch = fnSource('tripsyWatchStickyTripHeads');
  assert(/rootMargin: '-1px 0px 0px 0px'/.test(watch) && /threshold: \[1\]/.test(watch), 'the observer uses the -1px trick');
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
