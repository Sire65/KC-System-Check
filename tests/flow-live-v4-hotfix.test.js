import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mirrorAuthority,shouldAcceptFlowWrite} from '../js/flow-live-v4-hotfix.js';

test('serverseitiger Mirror-Lauf ist die Autoritaet fuer den Spiegelstatus',()=>{
  const at='2026-09-13T18:55:05.926Z';
  const ok=mirrorAuthority({flows:[{program_id:'kc-mirror',source_id:'supabase',target_id:'neon-mirror',flow_type:'replication',event_count:9,status:'ok',measured_at:at}]});
  assert.equal(ok?.bad,false);
  assert.equal(ok?.events,9);
  assert.equal(ok?.status,'ok');
  const bad=mirrorAuthority({flows:[{source_id:'supabase',target_id:'neon-mirror',flow_type:'replication',event_count:1,status:'error',measured_at:at}]});
  assert.equal(bad?.bad,true);
});

test('generischer Realtime-Broadcast darf den Spiegel nicht mehr rot ueberschreiben',()=>{
  assert.equal(shouldAcceptFlowWrite('supabase>neon-mirror',{source:'Realtime',bad:true}),false);
  assert.equal(shouldAcceptFlowWrite('supabase>neon-mirror',{source:'replication',bad:true}),true);
  assert.equal(shouldAcceptFlowWrite('pc-manager>supabase',{source:'Realtime',bad:true}),true);
});

test('Hotfix wird nach der Wahrheitsschicht geladen',()=>{
  const startup=fs.readFileSync('js/startup-modules.js','utf8');
  const v4=startup.indexOf('flow-live-v4.js');
  const fix=startup.indexOf('flow-live-v4-hotfix.js');
  assert.ok(v4>=0&&fix>v4);
});
