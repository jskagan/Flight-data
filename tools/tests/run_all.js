#!/usr/bin/env node
// Runs every *_test.js in this directory against ../../index.html and reports
// one line per suite. Some suites are GENERATORS: they extract functions from
// index.html into a sibling *_run.js which holds the actual executable
// assertions -- so after each test file, a matching *_run.js (fresh from this
// run) is executed too and its assertions counted with it. Generated *_run.js
// files are gitignored scratch, regenerated every run.
//
// Exit code 0 = every assertion in every suite passed.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const suites = fs.readdirSync(dir).filter(f => f.endsWith('_test.js')).sort();
let totOk = 0, totFail = 0, failedSuites = [];
for (const f of suites) {
  let out = '';
  const run = (file) => {
    try { out += execFileSync(process.execPath, [path.join(dir, file)], { cwd: dir, encoding: 'utf8' }); }
    catch (e) { out += (e.stdout || '') + (e.stderr || ''); }
  };
  run(f);
  const runFile = f.replace(/_test\.js$/, '_run.js');
  if (fs.existsSync(path.join(dir, runFile))) run(runFile);
  const ok = (out.match(/^ok /gm) || []).length;
  const fail = (out.match(/^FAIL /gm) || []).length;
  totOk += ok; totFail += fail;
  if (fail) failedSuites.push(f);
  console.log(`${fail ? 'FAIL' : ' ok '} ${f.replace('_test.js', '').padEnd(18)} ${ok} ok${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) console.log(out.split('\n').filter(l => l.startsWith('FAIL')).map(l => '     ' + l).join('\n'));
}
console.log(`\n${totOk} assertions, ${totFail} failures across ${suites.length} suites`);
if (totFail) { console.log('failed: ' + failedSuites.join(', ')); process.exit(1); }
