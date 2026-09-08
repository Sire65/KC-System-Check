import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type, apikey, x-client-info, x-pbv-device-token',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const SOURCE='pc-backup-vault';
const uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedTargetIds=new Set(['nas_backup','hidrive_1','hidrive_2']);
const allowedStatuses=new Set(['healthy','warning','critical','unknown','not_configured']);
const forbiddenKey=/(password|passwd|secret|token|dsn|recovery|access[_-]?key|private[_-]?key|original[_-]?path|decrypted[_-]?path|file[_-]?name|username|user_name|endpoint|remote[_-]?root|local[_-]?path|unc[_-]?path|path)$/i;
const safeText=(v:unknown,max=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
const db=()=>createClient(SUPABASE_URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
async function sha256(v:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function lookupClient(client:any,deviceId:string,token:string){if(!uuidRe.test(deviceId)||token.length<32)return null;const tokenHash=await sha256(token);const {data}=await client.from('kc_communication_machine_clients').select('id,status,source_program,device_id').eq('source_program',SOURCE).eq('device_id',deviceId).eq('token_hash',tokenHash).maybeSingle();return data||null}
function cleanStatus(v:unknown){const s=safeText(v,40).toLowerCase();return allowedStatuses.has(s)?s:'unknown'}
function sanitizeTarget(v:any){if(!v||typeof v!=='object'||Array.isArray(v))return null;for(const k of Object.keys(v))if(forbiddenKey.test(k))return null;const id=safeText(v.id,40);if(!allowedTargetIds.has(id))return null;const latency=Number(v.latencyMs);return{id,name:safeText(v.name||id,80),kind:safeText(v.kind||'',30),status:cleanStatus(v.status),latencyMs:Number.isFinite(latency)&&latency>=0?Math.min(latency,600000):null,checkedAt:safeText(v.checkedAt,50),detail:safeText(v.detail,180)} }
function sanitizeTargets(input:any){if(!Array.isArray(input))return[];const byId=new Map<string,any>();for(const raw of input.slice(0,12)){const row=sanitizeTarget(raw);if(row)byId.set(row.id,row)}return['nas_backup','hidrive_1','hidrive_2'].map(id=>byId.get(id)).filter(Boolean)}
function iso(v:any){const s=safeText(v,60);if(!s)return null;const n=Date.parse(s);return Number.isFinite(n)?new Date(n).toISOString():null}
function intOrNull(v:any){const n=Number(v);return Number.isFinite(n)&&n>=0?Math.trunc(n):null}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:'POST erforderlich'},405);
  let body:any={};try{body=await req.json()}catch{return json({error:'Ungültiges JSON'},400)}
  const sourceProgram=safeText(body.sourceProgram,120),deviceId=safeText(body.deviceId,80);
  if(sourceProgram!==SOURCE)return json({error:'SOURCE_PROGRAM_NOT_ALLOWED'},403);
  if(!uuidRe.test(deviceId))return json({error:'INVALID_DEVICE_ID'},400);
  const token=safeText(req.headers.get('x-pbv-device-token')||'',300);
  const client=db(),machine=await lookupClient(client,deviceId,token);
  if(!machine)return json({error:'DEVICE_AUTH_FAILED'},401);
  if(machine.status!=='active')return json({error:'DEVICE_NOT_ACTIVE',status:machine.status},423);

  const now=new Date().toISOString();
  const storageTargets=sanitizeTargets(body.storageTargets);
  const row={
    source_program:SOURCE,
    device_id:deviceId,
    app_version:safeText(body.appVersion,40),
    status:safeText(body.status,40).toUpperCase(),
    measured_at:iso(body.measuredAt)||now,
    last_backup_at:iso(body.lastBackupAt),
    last_backup_status:safeText(body.lastBackupStatus,40).toUpperCase(),
    last_backup_bytes:intOrNull(body.lastBackupBytes),
    last_backup_files:intOrNull(body.lastBackupFiles),
    backup_target:safeText(body.backupTarget,40),
    last_verify_at:iso(body.lastVerifyAt),
    last_verify_result:safeText(body.lastVerifyResult,40).toUpperCase(),
    last_restore_test_at:iso(body.lastRestoreTestAt),
    last_restore_test_result:safeText(body.lastRestoreTestResult,40).toUpperCase(),
    integrity_status:safeText(body.integrityStatus,40).toUpperCase(),
    rpo_seconds:intOrNull(body.rpoSeconds),
    rto_seconds:intOrNull(body.rtoSeconds),
    storage_targets:storageTargets,
    updated_at:now
  };

  // kicc_backup_telemetry ist ein aktueller Zustandsdatensatz mit
  // PRIMARY KEY (source_program, device_id). INSERT konnte daher nur beim
  // allerersten Lebenszeichen funktionieren; alle Folgemessungen liefen auf
  // einen Duplicate-Key. UPSERT hält den Datensatz jetzt wirklich aktuell.
  const {error}=await client.from('kicc_backup_telemetry').upsert(row,{onConflict:'source_program,device_id'});
  if(error)return json({error:'BACKUP_TELEMETRY_STORE_FAILED',detail:safeText(error.message,240)},500);

  // Der Live-Betriebswächter liest die an den gekoppelten Maschinen-Client
  // gebundene Tabelle. Beide Sichten werden aus derselben authentifizierten
  // Messung versorgt, damit System-Check und KICC nicht auseinanderlaufen.
  const machineRow={
    machine_client_id:machine.id,
    source_program:SOURCE,
    device_id:deviceId,
    app_version:row.app_version,
    status:row.status,
    last_backup_at:row.last_backup_at,
    last_backup_status:row.last_backup_status,
    last_backup_original_bytes:row.last_backup_bytes,
    last_integrity_at:row.last_verify_at,
    integrity_result:row.integrity_status||row.last_verify_result,
    last_restore_test_at:row.last_restore_test_at,
    restore_result:row.last_restore_test_result,
    storage_target:row.backup_target,
    rpo_seconds:row.rpo_seconds,
    rto_seconds:row.rto_seconds,
    measured_at:row.measured_at,
    storage_targets:row.storage_targets,
    updated_at:now
  };
  const {error:machineError}=await client.from('kc_backup_machine_telemetry').upsert(machineRow,{onConflict:'machine_client_id'});
  if(machineError)return json({error:'BACKUP_LIVE_TELEMETRY_STORE_FAILED',detail:safeText(machineError.message,240)},500);

  await client.from('kc_communication_machine_clients').update({last_seen_at:now,updated_at:now}).eq('id',machine.id);
  return json({ok:true,stored:true,liveStored:true,targetCount:storageTargets.length});
});