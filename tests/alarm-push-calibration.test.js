import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const policy=JSON.parse(fs.readFileSync('config/alarm-policy.json','utf8'));
const migration=fs.readFileSync('supabase/migrations/202609101320_kc_alarm_push_calibration.sql','utf8');

test('GELB wird erst nach drei Warnmessungen gemeldet',()=>{
  assert.equal(policy.confirmAfter.warning,3);
});

test('ROT bleibt gegen einen einzelnen Messausreisser entprellt',()=>{
  assert.equal(policy.confirmAfter.critical,2);
});

test('Warnungen werden nicht als Folgealarm stuendlich wiederholt',()=>{
  assert.deepEqual(policy.renotifyStatuses,['critical']);
});

test('Produktionsmigration bildet dieselben Schwellen ab',()=>{
  assert.match(migration,/\{confirmAfter,critical\}[^\n]*'2'::jsonb/);
  assert.match(migration,/\{confirmAfter,warning\}[^\n]*'3'::jsonb/);
});
