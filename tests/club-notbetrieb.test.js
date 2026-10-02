import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{clubNotbetriebBewerten,STAND_WARN_MIN}from'../js/club-notbetrieb.js';

const jetzt=Date.parse('2026-10-02T18:40:00Z');
const konfig={modus:'auto',url:'https://ersatz.example'};
const frisch={ok:true,notbetrieb:true,stand:'2026-10-02T18:30:00Z'};
const b=x=>clubNotbetriebBewerten({jetzt,...x});

test('normal: club server reachable and fresh emergency package is healthy',()=>{const r=b({konfig,worker:frisch,server:true});assert.equal(r.status,'healthy');assert.equal(r.notbetrieb,false)});
test('club server down with ready worker means Notbetrieb aktiv (critical)',()=>{const r=b({konfig,worker:frisch,server:false});assert.equal(r.status,'critical');assert.equal(r.notbetrieb,true);assert.match(r.text,/Notbetrieb/)});
test('club server down and worker not ready is an outage',()=>{const r=b({konfig,worker:null,server:false});assert.equal(r.status,'critical');assert.equal(r.notbetrieb,false);assert.match(r.text,/nicht nutzbar/)});
test('manual switch "an" is shown as Notbetrieb',()=>{const r=b({konfig:{...konfig,modus:'an'},worker:frisch,server:true});assert.equal(r.status,'critical');assert.equal(r.notbetrieb,true)});
test('manual switch "aus" is a warning, never green',()=>{assert.equal(b({konfig:{...konfig,modus:'aus'},worker:frisch,server:true}).status,'warning')});
test('stale package is a warning',()=>{const alt=new Date(jetzt-(STAND_WARN_MIN+1)*60000).toISOString();assert.equal(b({konfig,worker:{...frisch,stand:alt},server:true}).status,'warning')});
test('worker without package is a warning',()=>{assert.equal(b({konfig,worker:{ok:false,notbetrieb:true,stand:null},server:true}).status,'warning')});
test('UNKNOWN is never OK: nothing measured stays unknown',()=>{assert.equal(b({konfig:null,worker:null,server:null}).status,'unknown');assert.equal(b({konfig,worker:frisch,server:null}).status,'unknown')});
test('missing replacement server url is not_configured',()=>{assert.equal(b({konfig:{modus:'auto',url:''},worker:null,server:true}).status,'not_configured')});
test('module is wired, configured and fetches directly (works while Supabase is down)',()=>{
  assert.match(fs.readFileSync('js/operations-overview.js','utf8'),/import"\.\/club-notbetrieb\.js"/);
  const c=JSON.parse(fs.readFileSync('config/runtime.public.json','utf8')).clubNotbetrieb;
  assert.ok(c.konfigUrl&&c.serverUrl);
  const s=fs.readFileSync('js/club-notbetrieb.js','utf8');
  assert.doesNotMatch(s,/apiToken|sessionToken|Authorization/);
  assert.match(s,/credentials:"omit"/);
});
