import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src=fs.readFileSync('supabase/functions/kc-backup-telemetry-machine/index.ts','utf8');

test('Edge and archive telemetry are explicit allowlisted targets',()=>{
  assert.match(src,/['"]kc_archive_db['"]/);
  assert.match(src,/['"]kc_edge['"]/);
});

test('Edge telemetry keeps only safe operational fields',()=>{
  assert.match(src,/id==='kc_edge'/);
  assert.match(src,/\['worker','hyperdrive','kv'\]/);
  assert.match(src,/out\.account=safeText/);
  assert.match(src,/forbiddenKey=/);
  for(const forbidden of ['token','secret','password','private']) assert.match(src,new RegExp(forbidden,'i'));
});

test('Edge component status is normalized through cleanStatus',()=>{
  assert.match(src,/out\[k\]=cleanStatus\(v\[k\]\)/);
  assert.match(src,/allowedStatuses/);
  assert.match(src,/not_configured/);
});

test('Telemetry sanitizer does not copy arbitrary edge objects',()=>{
  assert.doesNotMatch(src,/Object\.assign\(out\s*,\s*v\)/);
  assert.doesNotMatch(src,/\.\.\.v/);
});
