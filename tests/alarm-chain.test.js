import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code=fs.readFileSync(new URL('../js/alert-settings.js',import.meta.url),'utf8');

test('alarm-chain LED is added beside product title',()=>{
  assert.match(code,/alarmChainLed/);
  assert.match(code,/\.topbar h1/);
  assert.match(code,/alarm-chain-led/);
});

test('green alarm-chain state requires current server run and healthy enabled channels',()=>{
  assert.match(code,/age>Math\.max\(interval\*2\.5,35\)/);
  assert.match(code,/health_status/);
  assert.match(code,/Alarmkette aktiv und bereit/);
  assert.match(code,/down\.length/);
});

test('disabled alarm chain is neutral and desktop settings use two columns',()=>{
  assert.match(code,/Alarmkette ausgeschaltet/);
  assert.match(code,/grid-template-columns:minmax\(0,1\.35fr\) minmax\(300px,\.65fr\)/);
  assert.match(code,/@media\(min-width:900px\)/);
});
