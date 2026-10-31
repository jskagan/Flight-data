// "Why am I getting this" (2026-10-31): hotel Wi-Fi with full bars and nothing getting
// through, so Google's sign-in script never arrived within the 5s poll and the gate gave
// up for good -- a failed <script> never loads again. The gate now keeps watching:
// re-requests the script on a timer, on 'online' and on returning to the page, and
// carries on with sign-in by itself when it arrives (only a toast if the saved schedule
// was already opened offline).
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
function extractFn(name) {
  const m = html.match(new RegExp(`(async function ${name}\\(|function ${name}\\()`));
  const start = m.index;
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
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const constLine = n => (html.match(new RegExp(`const ${n} = [^;]+;`)) || [''])[0];

function makeCtx(opts = {}) {
  const timers = []; let now = 0;
  const listeners = { win: {}, doc: {} };
  const appended = [];
  const calls = { init: 0, toast: [], status: [], boxRemoved: 0 };
  const box = { remove: () => { calls.boxRemoved++; } };
  const ctx = {
    window: { google: null, addEventListener: (t, f) => { listeners.win[t] = f; }, removeEventListener: (t) => { delete listeners.win[t]; } },
    document: {
      visibilityState: 'visible',
      head: { appendChild: s => appended.push(s) },
      createElement: () => ({}),
      addEventListener: (t, f) => { listeners.doc[t] = f; },
      removeEventListener: (t) => { delete listeners.doc[t]; },
      getElementById: id => (id === 'signin-offline-box' ? box : null),
    },
    Date: { now: () => now },
    setTimeout: (f, ms) => { timers.push({ at: now + ms, f }); },
    console,
    _tripsySignedInDone: false,
    _tripsyOfflineEntered: !!opts.offline,
    toast: m => calls.toast.push(m),
    showSignInStatus: (m, e) => calls.status.push([m, e]),
    initGoogleAuth: () => { calls.init++; },
  };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift(); now = t.at; t.f();
    }
    now = end;
  };
  const src = [constLine('TRIPSY_GIS_SCRIPT_URL'), constLine('TRIPSY_GIS_RETRY_MS'), constLine('TRIPSY_GIS_WATCH_MS'),
    extractFn('tripsyGoogleIdentityReady'), extractFn('tripsyWatchForLateGoogleIdentity'), extractFn('tripsyGoogleIdentityArrivedLate'),
    'return { tripsyWatchForLateGoogleIdentity };'].join('\n');
  const fns = new Function('ctx', `with (ctx) { ${src} }`)(ctx);
  return { ctx, fns, advance, appended, calls, listeners };
}

{
  const t = makeCtx();
  t.fns.tripsyWatchForLateGoogleIdentity();
  assert(t.appended.length === 1 && t.appended[0].src === 'https://accounts.google.com/gsi/client', 'the script is re-requested at once');
  t.advance(14000);
  assert(t.appended.length === 1, 'no second request inside the retry window');
  t.advance(2000);
  assert(t.appended.length === 2, 'requested again after 15s');
  t.listeners.win.online();
  assert(t.appended.length === 3, "'online' re-requests at once");
  t.listeners.doc.visibilitychange();
  assert(t.appended.length === 4, 'coming back to the page re-requests at once');
  t.fns.tripsyWatchForLateGoogleIdentity();
  assert(t.appended.length === 4, 'a second watch call does not start a second watcher');
  t.ctx.window.google = { accounts: { oauth2: {} } };
  t.advance(1000);
  assert(t.calls.init === 1, 'THE ASK: sign-in carries on by itself when the script arrives');
  assert(t.calls.boxRemoved === 1 && t.calls.status.some(([m]) => m === ''), 'the offline box and the error line are cleared');
  assert(!t.listeners.win.online && !t.listeners.doc.visibilitychange, 'listeners removed once done');
  t.advance(60000);
  assert(t.calls.init === 1 && t.appended.length === 4, 'nothing more happens after it is done');
}
{
  const t = makeCtx({ offline: true });
  t.fns.tripsyWatchForLateGoogleIdentity();
  t.ctx.window.google = { accounts: { oauth2: {} } };
  t.advance(1000);
  assert(t.calls.init === 0 && t.calls.toast.length === 1 && /back online/.test(t.calls.toast[0]),
    'with the saved schedule open offline, it only says so -- no view swapped under the reader');
}
{
  const t = makeCtx();
  t.fns.tripsyWatchForLateGoogleIdentity();
  t.advance(61 * 60 * 1000);
  const n = t.appended.length;
  t.advance(10 * 60 * 1000);
  assert(t.appended.length === n, 'the watch gives up after an hour');
}
{
  const waitStart = html.indexOf('function waitForGoogleIdentity');
  const waitBlock = html.slice(waitStart, html.indexOf('})();', waitStart) + 5);
  assert((waitBlock.match(/tripsyWatchForLateGoogleIdentity\(\)/g) || []).length === 2,
    'both give-up branches (gate and splash preview) start the watcher');
  assert(/box\.id = 'signin-offline-box';/.test(html), 'the offline box carries the id the recovery removes');
}
