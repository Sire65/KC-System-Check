import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';

const s=fs.readFileSync('supabase/functions/kicc-program-heartbeat/index.ts','utf8');

test('nur bestätigte Kassen-TX-Intervalle erzeugen einen Datenfluss',()=>{
  assert.match(s,/programId==='kc-bilderkasse'\s*&&\s*Number\(trafficTx\|\|0\)>0/);
  assert.match(s,/target_id:'pc-manager'/);
  assert.match(s,/source:'HEARTBEAT_INTERVAL_TX'/);
  assert.match(s,/trafficFlowReason='confirmed_companion_tx'/);
});

test('Kasse 1 und 2 werden nur aus eindeutigen Kennungen abgeleitet',()=>{
  assert.match(s,/kasse-\$\{String\(n\)\.padStart\(2,'0'\)\}/);
  assert.match(s,/registerId/);
  assert.match(s,/registerNumber/);
  assert.match(s,/deviceId/);
  assert.match(s,/trafficFlowReason='register_unresolved'/);
});

test('kein künstlicher Verkehr bei trafficTx 0 oder unbekannter Kasse',()=>{
  assert.doesNotMatch(s,/traffic_tx[^\n]*\+\s*1/);
  assert.match(s,/Number\(trafficTx\|\|0\)>0/);
  assert.match(s,/if\(sourceId\)/);
});

test('Flow wird erst nach erfolgreicher Speicherung des Heartbeats geschrieben',()=>{
  const heartbeatStore=s.indexOf("if(!upsert.ok) return json({ok:false,error:'heartbeat_store_failed'}");
  const flowStore=s.indexOf("const flowInsert=await rest('kicc_program_flow_events'");
  assert.ok(heartbeatStore>=0&&flowStore>heartbeatStore);
});
