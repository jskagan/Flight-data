// "Move the trip insurance menu to the utilities section" (2026-10-18). Source-pattern
// assertions over the nav rail markup and setActiveNav.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const subStart = html.indexOf('<div id="utilities-submenu" class="collapsed">');
const subEnd = html.indexOf('</div>', subStart);
const submenu = html.slice(subStart, subEnd);
assert(/<button class="rail-item rail-subitem" data-view="tripinsurance">Trip Insurance<\/button>/.test(submenu), 'THE ASK: Trip Insurance is an item of the Utilities submenu');
assert((html.match(/data-view="tripinsurance"/g) || []).length === 1, 'and it appears nowhere else on the rail (the top-level item is gone)');
assert(!/rail-item" data-view="tripinsurance"><span class="nav-icon">/.test(html), 'the old top-level button with its 🛡️ icon is removed');
assert(submenu.indexOf('data-view="utilitiesfavorites"') < submenu.indexOf('data-view="tripinsurance"') && submenu.indexOf('data-view="tripinsurance"') < submenu.indexOf('rail-submenu-heading'),
  'it sits after Favorites, before the P/S heading');
const san = html.slice(html.indexOf('function setActiveNav('), html.indexOf('async function navigate('));
assert(/const isUtilitiesView = [^\n]*view === "tripinsurance"/.test(san), 'the Utilities submenu stays open while the Trip Insurance page is showing');
assert(/view === "tripinsurance"\) await renderTripInsurance\(\)/.test(html), 'the view id is unchanged, so offline entry and the Travel View exit still route to it');
