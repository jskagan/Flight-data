const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const start = html.indexOf(`function ${name}(`);
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
eval(extractFn('tripsyExternalUrl'));
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

assert(tripsyExternalUrl('https://elpirata.co.uk/') === 'https://elpirata.co.uk/', 'a full https URL passes through');
assert(tripsyExternalUrl('http://example.com/x') === 'http://example.com/x', 'plain http is allowed too');
// The common real case: Places and hand-typed values often omit the scheme, and a bare
// host in an href is a RELATIVE path -- it would navigate the app itself to a 404.
assert(tripsyExternalUrl('elpirata.co.uk') === 'https://elpirata.co.uk/', 'a bare host gains https -> ' + tripsyExternalUrl('elpirata.co.uk'));
assert(tripsyExternalUrl('www.sabor.co.uk/menu') === 'https://www.sabor.co.uk/menu', 'as does a www path');
assert(tripsyExternalUrl('  https://x.com  ') === 'https://x.com/', 'surrounding whitespace is trimmed');
// Refused: an href is an execution surface, and this text can come from a parsed email.
for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>x</script>', 'file:///etc/passwd', 'vbscript:msgbox']) {
  assert(tripsyExternalUrl(bad) === '', 'refused: ' + bad);
}
assert(tripsyExternalUrl('') === '' && tripsyExternalUrl(null) === '' && tripsyExternalUrl(undefined) === '',
  'empty/missing values yield no link');
assert(tripsyExternalUrl('not a url at all') === '', 'unparseable text is not linked -> ' + JSON.stringify(tripsyExternalUrl('not a url at all')));

// ---- wiring in the view panel ----
const panel = html.slice(html.indexOf('function renderTripsyViewPanel('), html.indexOf('function renderTripsyViewPanel(') + 3000);
assert(/f\.key === 'website' \|\| f\.key === 'agentWebsite'/.test(panel), 'both website fields are linkified');
assert(/target="_blank" rel="noopener noreferrer"/.test(panel), 'opens in a new tab, with noopener');
assert(/\$\{esc\(href\)\}/.test(panel) && /\$\{esc\(val\)\}/.test(panel), 'both the href and the visible text stay escaped');
assert(/: esc\(val\)/.test(panel), 'a non-URL value still renders as plain escaped text');
// The row click handler must not swallow the tap before the link fires.
assert(/e\.target\.closest\('button, a,/.test(html), "the timeline row handler already ignores taps on an <a>");
