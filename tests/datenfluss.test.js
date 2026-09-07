import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{knotenId,laeufeErmitteln}from'../js/leitstand.js';

test('Programm-IDs landen auf den richtigen Knoten',()=>{
  assert.equal(knotenId('kc-marktkasse-02'),'kasse-02');assert.equal(knotenId('pos'),'kasse-01');
  assert.equal(knotenId('kc-manager'),'pc-manager');assert.equal(knotenId('kc-dp2'),'dp-app');
  assert.equal(knotenId('pc-backup-vault'),'pc-backup');assert.equal(knotenId('kicc'),'supabase');
  assert.equal(knotenId('B2'),'b2');assert.equal(knotenId(''),null);
});

test('ausgebliebener Lauf wird gelb, doppelt ausgeblieben rot - auch wenn die Kachel gruen war',()=>{
  const jetzt=Date.now();
  const run={at:new Date(jetzt-30*60000).toISOString(),results:[
    {id:'mirror',status:'healthy',detail:'0 Abweichungen',metrics:{age_min:50}},
    {id:'backup',status:'healthy',detail:'gesichert',metrics:{last_backup_at:new Date(jetzt-60*3600000).toISOString()}},
    {id:'b2',status:'not_configured',detail:'Adapter bereit',metrics:{}},
    {id:'programs',status:'not_configured',detail:'keine Pflicht'}]};
  const l=Object.fromEntries(laeufeErmitteln(run,jetzt).map(x=>[x.id,x]));
  assert.equal(l['system-check'].cls,'warn');             // 30 min > Soll 20
  assert.equal(l.mirror.cls,'warn');                      // 50 min > Soll 45
  assert.equal(l.backup.cls,'bad');                       // 60 h > 2*26 h
  assert.equal(l.b2.cls,'idle');                          // nichts bekannt -> offen, nicht gruen
  assert.match(l.backup.hinweis,/ausgeblieben/);
});

test('rote Kachel wird durch Sollzeit nie besser',()=>{
  const jetzt=Date.now();
  const run={at:new Date(jetzt).toISOString(),results:[{id:'mirror',status:'critical',detail:'3 Abweichungen',metrics:{age_min:1}}]};
  assert.equal(laeufeErmitteln(run,jetzt).find(x=>x.id==='mirror').cls,'bad');
});

test('LIVE-Leitstand haengt die Datenfluss-Karte ein und der Broadcast-Client meidet die Datenbank',()=>{
  const l=fs.readFileSync('js/leitstand.js','utf8'),d=l;
  assert.match(l,/renderDatenfluss\(data,laufzeit\)/);
  assert.match(d,/realtime\/v1\/websocket/);assert.match(d,/phx_join/);
  assert.doesNotMatch(d,/rest\/v1\//);                    // keine REST-Abfrage aus diesem Modul
  assert.match(d,/supabase-js|Fremdbibliothek/);          // Entscheidung ist dokumentiert
});

test('Version ist ueberall gleich angehoben',()=>{
  const v=JSON.parse(fs.readFileSync('version.json','utf8')).version;
  for(const f of['sw.js','js/updater.js','js/kicc-heartbeat.js'])assert.match(fs.readFileSync(f,'utf8'),new RegExp(v.replace(/\./g,'\\.')),f);
});
