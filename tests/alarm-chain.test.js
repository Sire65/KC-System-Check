import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const code=fs.readFileSync(new URL('../js/alert-settings.js',import.meta.url),'utf8');

test('alarm-chain LED is added beside product title and opens diagnostics',()=>{
  assert.match(code,/alarmChainLed/);
  assert.match(code,/\.topbar h1/);
  assert.match(code,/alarm-chain-led/);
  assert.match(code,/addEventListener\('click',openDiagnostics\)/);
  assert.match(code,/Klicken für Diagnose/);
});

test('green alarm-chain state requires current server run and healthy enabled channels',()=>{
  assert.match(code,/age>Math\.max\(interval\*2\.5,35\)/);
  assert.match(code,/health_status/);
  assert.match(code,/Alarmkette aktiv und bereit/);
  assert.match(code,/down\.length/);
});

test('disabled alarm chain is neutral and desktop settings use two columns',()=>{
  assert.match(code,/Alarmkette ausgeschaltet/);
  assert.match(code,/grid-template-columns:minmax\(0,1\.35fr\) minmax\(320px,\.65fr\)/);
  assert.match(code,/@media\(min-width:900px\)/);
});

test('production settings keep actions visible and expose push and email tests',()=>{
  assert.match(code,/alarm-sticky-actions/);
  assert.match(code,/position:sticky/);
  assert.match(code,/id="testEmailBtn"/);
  assert.match(code,/id="testPushBtn"/);
  assert.match(code,/testChannel\('email'\)/);
  assert.match(code,/testChannel\('push'\)/);
  assert.match(code,/test_email/);
  assert.match(code,/test_push/);
});

test('Details proof link is wired to the same diagnostic modal',()=>{
  assert.match(code,/installDetailsHandler/);
  assert.match(code,/\.kc-evidence/);
  assert.match(code,/openDiagnostics\(\)/);
  assert.match(code,/alarmDiagModal/);
  assert.match(code,/Prüfnachweis/);
});
