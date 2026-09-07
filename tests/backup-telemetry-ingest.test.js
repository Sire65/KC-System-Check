import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('supabase/functions/kc-backup-telemetry-machine/index.ts','utf8');

test('Backup Vault ingest uses existing paired machine authentication',()=>{
  assert.match(src,/kc_communication_machine_clients/);
  assert.match(src,/x-pbv-device-token/);
  assert.match(src,/token_hash/);
  assert.match(src,/machine\.status!==['"]active['"]/);
});

test('storage target ingest accepts only the three known technical targets',()=>{
  for(const id of ['nas_backup','hidrive_1','hidrive_2']) assert.match(src,new RegExp(id));
  assert.match(src,/allowedTargetIds/);
  assert.match(src,/storage_targets:storageTargets/);
});

test('storage target ingest rejects path and credential-shaped fields',()=>{
  for(const word of ['password','token','dsn','recovery','username','endpoint','remote','local','unc','path'])
    assert.match(src,new RegExp(word,'i'));
  assert.match(src,/forbiddenKey\.test\(k\)/);
});

test('telemetry is stored server-side without returning payload details',()=>{
  assert.match(src,/from\(['"]kicc_backup_telemetry['"]\)\.insert\(row\)/);
  assert.match(src,/return json\(\{ok:true,stored:true,targetCount:storageTargets\.length\}\)/);
  assert.doesNotMatch(src,/return json\(row\)/);
});
