const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

const shell = html.slice(html.indexOf('function getOrCreateTripsyAttireOverlay()'),
                         html.indexOf('function getOrCreateTripsyAttireOverlay()') + 1800);

// The floating bar above the card is gone; the header is INSIDE the paper.
assert(!/<div class="tripsy-attire-toolbar">/.test(shell), 'no toolbar bar above the card');
const paper = shell.slice(shell.indexOf('<div class="tripsy-attire-paper">'));
assert(/tripsy-attire-paper[^]*tripsy-attire-cardhead/.test(shell), 'the header sits inside the paper');
assert(shell.indexOf('tripsy-attire-cardhead') < shell.indexOf('id="tripsy-attire-content"'),
  'and above the rendered content');
// The paper is no longer the content node itself, or the render would blow the header away.
assert(!/class="tripsy-attire-paper" id="tripsy-attire-content"/.test(html),
  'the content node is a CHILD of the paper, so re-rendering cannot wipe the header');

// Order on that line: title, then Definitions, then the X last.
const head = shell.slice(shell.indexOf('tripsy-attire-cardhead'), shell.indexOf('id="tripsy-attire-content"'));
assert(head.indexOf('data-tripsy-attire-title') < head.indexOf('tripsy-attire-definitions-btn'), 'title first');
assert(head.indexOf('tripsy-attire-definitions-btn') < head.indexOf('tripsy-attire-close-btn'),
  'Definitions sits to the LEFT of the X');

// Both header buttons are wired ONCE on the static shell, not per render.
assert(/#tripsy-attire-definitions-btn'\)\.addEventListener\('click', \(\) => showTripsyAttireDefinitions\(\)\)/.test(html),
  'Definitions is wired on the shell');
assert(!/data-tripsy-attire-definitions-inline/.test(html), 'the old inline Definitions button is gone');

// The heading names the page and the trip, in that order -- and the duplicate
// "Clothing Summary" h3 that used to sit inside the content is gone.
assert(/textContent = `Clothing Summary\$\{trip\.name \? ` — \$\{trip\.name\}` : ''\}`/.test(html),
  'the header reads "Clothing Summary — <trip>"');
assert(!/`Attire — \$\{trip\.name/.test(html), 'the old bare trip-name title is gone');
assert(!/<h3 class="tripsy-attire-heading" style="margin:0;">Clothing Summary<\/h3>/.test(html),
  'the in-content Clothing Summary heading is not repeated');

// The header row must not wrap -- a long trip name has to shrink, not push the X down.
const css = (html.match(/\.tripsy-attire-cardhead \{[\s\S]*?\}/) || [''])[0];
const titleCss = (html.match(/\.tripsy-attire-cardtitle \{[\s\S]*?\}/) || [''])[0];
assert(/display: flex/.test(css) && !/flex-wrap/.test(css), 'the header row never wraps');
assert(/min-width: 0/.test(titleCss) && /text-overflow: ellipsis/.test(titleCss),
  'so the title shrinks and ellipsises instead');
// And the summary no longer double-spaces under the header when it is the first block.
assert(/\.tripsy-attire-summary:first-child \{ margin-top: 0; \}/.test(html),
  'no stacked gap when the summary is first');

// The Daily Dress Guide still uses the toolbar shell, so that CSS must stay.
assert(/<div class="tripsy-attire-toolbar">/.test(html), 'the dress guide keeps its toolbar');
