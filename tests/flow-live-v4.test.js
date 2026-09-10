import test from'node:test';
import assert from'node:assert/strict';
import fs from'node:fs';
import{counterDelta,normalizeFlowNode,trafficView,__flowTruthForTests}from'../js/flow-live-v4.js';

test('kumulativer Verkehr wird nur als positive Differenz gewertet',()=>{
  assert.equal(counterDelta(null,749),0);
  assert.equal(counterDelta(749,749),0);
  assert.equal(counterDelta(749,752),3);
  assert.equal(counterDelta(752,4),0);
});

test('nur echter Verkehr bis 60 Sekunden bewegt die Linie',()=>{
  const now=1_000_000;
  assert.deepEqual(trafficView(null,now),{moving:false,recent:false,bad:false,cls:'idle',tag:'KEIN VERKEHR'});
  const live=trafficView({at:now-20_000,events:2,bad:false},now);
  assert.equal(live.moving,true);
  assert.equal(live.recent,false);
  assert.equal(live.cls,'active');
});

test('kürzlicher Verkehr bleibt grau und erhält nur einen statischen Marker',()=>{
  const now=2_000_000;
  const fiveMin=trafficView({at:now-5*60_000,events:1,bad:false},now);
  assert.equal(fiveMin.moving,false);
  assert.equal(fiveMin.recent,true);
  assert.equal(fiveMin.cls,'idle');
  assert.equal(fiveMin.tag,'KÜRZLICH');
  const sixteenMin=trafficView({at:now-16*60_000,events:1,bad:false},now);
  assert.equal(sixteenMin.moving,false);
  assert.equal(sixteenMin.recent,false);
  assert.equal(sixteenMin.cls,'idle');
});

test('feste Routen entsprechen der realen Architektur',()=>{
  assert.equal(normalizeFlowNode('kc-verwaltung'),'kc-verwaltung');
  assert.equal(normalizeFlowNode('KC Verwaltung'),'kc-verwaltung');
  assert.equal(normalizeFlowNode('kc-bilderkasse'),null);
  assert.equal(normalizeFlowNode('kasse-01'),'kasse-01');
  assert.equal(normalizeFlowNode('kasse-02'),'kasse-02');
  assert.equal(__flowTruthForTests.STATIC_ROUTES.length,9);
  assert.ok(__flowTruthForTests.STATIC_ROUTES.some(r=>r.from==='kc-verwaltung'&&r.to==='supabase'));
  assert.ok(__flowTruthForTests.STATIC_ROUTES.some(r=>r.from==='kasse-01'&&r.to==='pc-manager'));
  assert.ok(__flowTruthForTests.STATIC_ROUTES.some(r=>r.from==='kasse-02'&&r.to==='pc-manager'));
  assert.ok(!__flowTruthForTests.STATIC_ROUTES.some(r=>/^kasse-0[12]$/.test(r.from)&&r.to==='supabase'));
});

test('expliziter Kassen-Flow wird als echter Verkehr Kasse zu Manager übernommen',()=>{
  __flowTruthForTests.activity.clear();
  const at=new Date().toISOString();
  __flowTruthForTests.ingest({
    flows:[{program_id:'kc-bilderkasse',instance_id:'kasse-01',source_id:'kasse-01',target_id:'pc-manager',flow_type:'SYNC',event_count:1,byte_count:null,status:'OK',measured_at:at,received_at:at}],
    heartbeats:[]
  });
  const kasse=__flowTruthForTests.entries().find(r=>r.from==='kasse-01'&&r.to==='pc-manager');
  assert.ok(kasse?.state,'Kassenverkehr muss als Route vorhanden sein');
  assert.equal(kasse.state.events,1);
  assert.equal(kasse.view.moving,true);
});

test('Oberfläche trennt Live-Bewegung und 15-Minuten-Historie sichtbar',()=>{
  const s=fs.readFileSync('js/flow-live-v4.js','utf8'),startup=fs.readFileSync('js/startup-modules.js','utf8');
  assert.match(startup,/flow-live-v4\.js/);
  assert.doesNotMatch(startup,/flow-live-v3\.js/);
  assert.match(s,/RECENT_TRAFFIC_MS=15\*60_000/);
  assert.match(s,/kc-truth-recent-dot/);
  assert.match(s,/letzter echter Verkehr/);
  assert.match(s,/animateMotion/);
  assert.match(s,/Heartbeats allein sind KEIN Verkehr/);
  assert.match(s,/Kassen-Liveverkehr/);
});
