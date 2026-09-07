import test from"node:test";
import assert from"node:assert/strict";
import{storageTargetsFromLive,storageTargetVisual}from"../js/usage.js";

test("storage target panel always exposes NAS and two HiDrive slots",()=>{
  const rows=storageTargetsFromLive({backup:{kicc:{storage_targets:[
    {id:"hidrive_1",name:"Privat",status:"healthy",latency_ms:44,detail:"HiDrive erreichbar"},
    {id:"nas_backup",name:"NAS",status:"critical",latencyMs:5,detail:"NAS-Ziel nicht erreichbar"}
  ]}}});
  assert.deepEqual(rows.map(x=>x.id),["nas_backup","hidrive_1","hidrive_2"]);
  assert.equal(rows[0].status,"critical");
  assert.equal(rows[1].status,"healthy");
  assert.equal(rows[2].status,"not_configured");
});

test("unknown status never becomes green",()=>{
  const rows=storageTargetsFromLive({backup:{kicc:{storageTargets:[{id:"hidrive_1",status:"something-new"}]}}});
  assert.equal(rows[1].status,"unknown");
  assert.equal(storageTargetVisual(rows[1].status).cls,"idle");
  assert.equal(storageTargetVisual("not_configured").cls,"idle");
  assert.equal(storageTargetVisual("healthy").cls,"ok");
});

test("target model does not require paths or credentials",()=>{
  const rows=storageTargetsFromLive({backup:{kicc:{storage_targets:[
    {id:"hidrive_2",name:"Technik",status:"warning",checkedAt:"2026-09-07T20:00:00Z",detail:"Anmeldung langsam"}
  ]}}});
  const text=JSON.stringify(rows);
  assert.equal(text.includes("password"),false);
  assert.equal(text.includes("username"),false);
  assert.equal(text.includes("root_path"),false);
  assert.equal(rows[2].name,"Technik");
});
