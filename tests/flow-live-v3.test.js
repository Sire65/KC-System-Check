import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import{counterDelta,normalizeFlowNode,trafficView,__flowTruthForTests}from'../js/flow-live-v3.js';

test('kumulativer Verkehr wird nur als positive Differenz gewertet',()=>{
  assert.equal(counterDelta(null,749),0);
  assert.equal(counterDelta(749,749),0);
  assert.equal(counterDelta(749,752),3);
  assert.equal(counterDelta(752,4),0); // Zaehlerneustart ist kein 4er-Verkehrsereignis
});

test('nur Verkehr der letzten 60 Sekunden bewegt und faerbt die Linie gruen',()=>{
  const now=1_000_000;
  assert.deepEqual(trafficView(null,now),{moving:false,bad:false,cls:'idle',tag:'KEIN VERKEHR'});
  assert.equal(trafficView({at:now-20_000,events:2,bad:false},now).moving,true);
  assert.equal(trafficView({at:now-61_000,events:2,bad:false},now).cls,'idle');
  assert.equal(trafficView({at:now-20_000,events:2,bad:true},now).cls,'bad');
});

test('bekannte Programme und Ziele landen auf den festen Routen',()=>{
  assert.equal(normalizeFlowNode('kc-dp2'),'dp-app');
  assert.equal(normalizeFlowNode('pc-backup-vault'),'pc-backup');
  assert.equal(normalizeFlowNode('Backblaze B2'),'b2');
  assert.equal(normalizeFlowNode('supabase'),'supabase');
  assert.equal(__flowTruthForTests.STATIC_ROUTES.length,8);
});

test('die Oberflaeche ersetzt falsches Dauergruen durch dunkle Ruhelinien',()=>{
  const s=fs.readFileSync('js/flow-live-v3.js','utf8'),startup=fs.readFileSync('js/startup-modules.js','utf8');
  assert.match(startup,/flow-live-v3\.js/);
  assert.match(s,/background:#30394a/);
  assert.match(s,/Grün \+ wandernder Punkt/);
  assert.match(s,/heartbeat_sync/);
  assert.match(s,/Zählerdifferenz/);
  assert.match(s,/last_backup_at/);
  assert.match(s,/animateMotion/);
});

test('neue SQL-Migration erzeugt keine Heartbeat-Pseudoflows und nutzt echten Backup-Zeitpunkt',()=>{
  const sql=fs.readFileSync('supabase/migrations/202609081820_kc_live_datenfluss_wahrheit.sql','utf8');
  assert.match(sql,/flow_type,''\)\) <> 'heartbeat_sync'/);
  assert.doesNotMatch(sql,/heartbeat_flows\s+as/i);
  assert.match(sql,/last_backup_at as measured_at/);
  assert.match(sql,/'backup_completed'::text/);
});
