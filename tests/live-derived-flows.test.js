import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/202609081145_kc_live_leitstand_derived_flows.sql','utf8');

test('snapshot keeps explicit flow telemetry and adds existing operational sources',()=>{
  assert.match(sql,/kicc_program_flow_events/);
  assert.match(sql,/heartbeat_flows/);
  assert.match(sql,/kc_db_mirror_runs/);
  assert.match(sql,/kc_backup_machine_telemetry/);
});

test('derived flow endpoints match the visual leitstand nodes',()=>{
  assert.match(sql,/'supabase'::text as target_id/);
  assert.match(sql,/'neon-mirror'::text as target_id/);
  assert.match(sql,/then 'b2'/);
  assert.match(sql,/then 'neon-vault'/);
});

test('derived flows remain read-only snapshot data',()=>{
  assert.doesNotMatch(sql,/insert\s+into\s+public\.kicc_program_flow_events/i);
  assert.doesNotMatch(sql,/update\s+public\.kicc_program_flow_events/i);
  assert.match(sql,/jsonb_agg\(to_jsonb\(flows\)/);
});
