import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
test('release exposes version in header',()=>{const h=fs.readFileSync('index.html','utf8');assert.match(h,/id="appVersion"/);assert.match(h,/id="runtimeMode"/)});
test('mirror UI is mismatch based, not fake zero latency',()=>{const a=fs.readFileSync('js/app.js','utf8');assert.match(a,/mismatch_count/);assert.doesNotMatch(a,/gaugeMirror[^\n]+latency\|\|0/)});
test('daily automation is at most daily and no B2 upload',()=>{const y=fs.readFileSync('.github/workflows/daily-check.yml','utf8');assert.match(y,/cron: '20 5 \* \* \*'/);assert.doesNotMatch(y,/b2.*upload/i)});
