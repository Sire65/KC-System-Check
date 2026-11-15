// KC-SC-DP-HANDYFEHLER: Auswertung, Anzeige-Zustaende und Einbindung.
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{summarize,view,STALE_MS,REFRESH_MS}from'../js/dp-handy-fehler.js';
const row=(o)=>({status:'new',severity:'warning',occurrence_count:1,device_id:'d1',error_code:'E1',...o});

test('keine offenen Fehler ist gruen, erledigte zaehlen nicht',()=>{
  const s=summarize([row({status:'resolved',severity:'critical'}),row({status:'ignored'})]);
  assert.equal(s.status,'healthy');assert.equal(s.open,0);
  assert.equal(view({kind:'ok',at:Date.now(),summary:s}).tag,'OK');
});
test('Warnungen sind gelb, Fehler und kritisch rot',()=>{
  assert.equal(summarize([row()]).status,'warning');
  assert.equal(summarize([row(),row({severity:'error'})]).status,'critical');
  const s=summarize([row({severity:'critical',device_id:'a',occurrence_count:3}),row({status:'reviewed',severity:'error',device_id:'b',error_code:'E2'})]);
  assert.deepEqual([s.open,s.critical,s.errors,s.occurrences,s.devices],[2,1,1,4,2]);
  const v=view({kind:'ok',at:Date.now(),summary:s});assert.equal(v.cls,'bad');assert.equal(v.tag,'2 FEHLER');
});
test('haeufigste Fehlercodes zuerst, hoechstens drei',()=>{
  const s=summarize([row({error_code:'A'}),row({error_code:'B',occurrence_count:5}),row({error_code:'C'}),row({error_code:'D',occurrence_count:2})]);
  assert.deepEqual(s.topCodes.map(c=>c.code),['B','D','A']);
});
test('UNBEKANNT ist nie OK (Regel 11): leer, ohne Anmeldung, ohne Rolle, Fehler, veraltet',()=>{
  for(const st of [null,{kind:'idle'},{kind:'login'},{kind:'forbidden'},{kind:'error',detail:'HTTP 500'}]){const v=view(st);assert.notEqual(v.tag,'OK');assert.equal(v.cls,'idle')}
  const old=view({kind:'ok',at:Date.now()-STALE_MS-1000,summary:summarize([])});assert.equal(old.tag,'VERALTET');assert.notEqual(old.cls,'ok');
});
test('Anzeige enthaelt keine Namen, Geraete-IDs oder Fehlertexte',()=>{
  const s=summarize([row({member_name:'Erika Muster',device_id:'geraet-xyz',message:'geheimer Text',stack:'at x'})]);
  const t=JSON.stringify(view({kind:'ok',at:Date.now(),summary:s}));
  for(const x of['Erika','geraet-xyz','geheimer','at x'])assert.ok(!t.includes(x),x);
});
test('sparsam: hoechstens alle 5 Minuten, nur bei sichtbarem Fenster, nur mit Anmeldung',()=>{
  assert.equal(REFRESH_MS,300000);const s=fs.readFileSync('js/dp-handy-fehler.js','utf8');
  assert.match(s,/document\.hidden\)return/);assert.match(s,/kc_dp_error_admin_list_v2/);assert.match(s,/sessionToken\(\)/);
  assert.doesNotMatch(s,/sessionToken\(\)\|\|/,'kein Rueckfall auf oeffentlichen Schluessel');
});
test('Modul ist in die Betriebsuebersicht eingebunden',()=>{
  assert.match(fs.readFileSync('js/operations-overview.js','utf8'),/import"\.\/dp-handy-fehler\.js"/);
});
