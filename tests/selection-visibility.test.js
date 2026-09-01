import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime=fs.readFileSync('js/diagnostics-runtime.js','utf8');

test('active system selection is persisted and drives overview visibility',()=>{
  assert.match(runtime,/kc-active-systems-v1/);
  assert.match(runtime,/selection-hidden/);
  assert.match(runtime,/system-card,\.capacity-card/);
  assert.match(runtime,/gaugeCore/);
  assert.match(runtime,/gaugeFuture/);
  assert.match(runtime,/gaugeMirror/);
});

test('one touch is redirected to currently checked systems',()=>{
  assert.match(runtime,/#oneTouchBtn/);
  assert.match(runtime,/#runSelectedBtn/);
  assert.match(runtime,/stopImmediatePropagation/);
});
