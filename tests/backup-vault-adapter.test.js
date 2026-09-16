import assert from"node:assert/strict";
import test from"node:test";
import{BackupVaultAdapter,mapBackupVaultSnapshot}from"../js/adapters/backup-vault.js";

test("maps Backup Vault snapshot into common check record",()=>{const result=mapBackupVaultSnapshot({sourceProgram:"pc-backup-vault",status:"healthy",generatedAt:"2026-09-07T20:00:00Z",capacity:{usage:51,label:"51 %"},lastJob:{status:"SUCCESS"},lastVerify:{status:"healthy"},lastRestoreTest:{status:"healthy"},targets:[{id:"nas_backup",status:"healthy"},{id:"hidrive_1",status:"warning"}]});assert.equal(result.id,"backup_vault");assert.equal(result.status,"warning");assert.equal(result.usage,51);assert.equal(result.metrics.targets.length,2)});

test("critical target escalates overall Backup Vault status",()=>{const result=mapBackupVaultSnapshot({sourceProgram:"pc-backup-vault",status:"healthy",targets:[{id:"hidrive_2",status:"critical"}]});assert.equal(result.status,"critical");assert.match(result.detail,/kritisch/)});

test("running job is mapped as current progress without using stale completion state",()=>{const result=mapBackupVaultSnapshot({sourceProgram:"pc-backup-vault",status:"running",generatedAt:"2026-09-16T06:15:00Z",currentJob:{status:"running",startedAt:"2026-09-16T06:10:00Z",processedBytes:52428800,totalBytes:104857600,bytesPerSecond:5242880,percent:50,targetId:"neon_backup"},lastJob:{status:"SUCCESS",finishedAt:"2026-09-09T06:00:00Z"},targets:[]});assert.equal(result.status,"healthy");assert.equal(result.detail,"Backup läuft");assert.equal(result.metrics.currentJob.percent,50);assert.equal(result.metrics.currentJob.processedBytes,52428800);assert.equal(result.metrics.currentJob.bytesPerSecond,5242880);assert.equal(result.metrics.currentJob.targetId,"neon_backup")});

test("rejects telemetry containing secret-bearing fields",()=>{assert.throws(()=>mapBackupVaultSnapshot({sourceProgram:"pc-backup-vault",status:"healthy",targets:[{id:"hidrive_1",password:"nope"}]}),/unzulässiges Feld/)});

test("adapter remains read-only and delegates loading",async()=>{let calls=0;const adapter=new BackupVaultAdapter({loadSnapshot:async()=>{calls++;return{sourceProgram:"pc-backup-vault",status:"ok",targets:[]}}});const result=await adapter.quickCheck();assert.equal(calls,1);assert.equal(result.status,"healthy")});
