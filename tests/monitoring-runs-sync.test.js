import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('js/monitoring-runs-sync.js','utf8');
const startup=fs.readFileSync('js/startup-modules.js','utf8');

test('LIVE monitoring uses remote history instead of only stale browser state',()=>{
  assert.match(src,/loadRemoteHistory/);
  assert.match(src,/newestHistory/);
  assert.match(src,/state\.lastRun=run/);
  assert.match(src,/POLL_MS=5\*60\*1000/);
});

test('backup run timestamp aliases last_ok_at to the field expected by the run card',()=>{
  assert.match(src,/last_ok_at/);
  assert.match(src,/last_backup_at/);
});

test('program heartbeat row no longer claims that a separate run is missing',()=>{
  assert.match(src,/kein eigener Lauf · Bewertung im System-Check/);
});

test('sync module is loaded by startup modules',()=>{
  assert.match(startup,/monitoring-runs-sync\.js/);
});
