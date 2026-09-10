import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_PROGRAMS = new Set(['kc-dp2','kc-communication','kicc','kc-pc-manager','kc-bilderkasse','kc-system-check','kc-wm-presentation','kc-verwaltung','kc-money-butler']);
const MAX_SKEW_MS = 120_000;
const MIN_INTERVAL_MS = 5_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:cors});
const clean = (v: unknown, max=160) => typeof v === 'string' ? v.trim().slice(0,max) : '';
const metric = (v: unknown, max=2_147_483_647) => Number.isFinite(v) && Number(v) >= 0 ? Math.min(Number(v),max) : null;

async function rest(path:string, init:RequestInit={}){
  const headers = new Headers(init.headers || {});
  headers.set('apikey', SERVICE_ROLE);
  headers.set('authorization', `Bearer ${SERVICE_ROLE}`);
  headers.set('content-type','application/json');
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {...init, headers});
}

function explicitRegisterNumber(v: unknown){
  const s=clean(v,80).toLowerCase();
  if(s==='1'||s==='01') return 1;
  if(s==='2'||s==='02') return 2;
  return null;
}

function registerFromText(v: unknown){
  const s=clean(v,160).toLowerCase();
  if(!s) return null;
  const m=s.match(/(?:kasse|register|pos|markt)[\s:_-]*0*([12])(?:\D|$)/i);
  return m ? Number(m[1]) : null;
}

function resolveKasseSource(body:any, heartbeat:any, instanceId:string){
  const explicit=[heartbeat?.registerId,heartbeat?.registerNo,heartbeat?.registerNumber,heartbeat?.kasseId,heartbeat?.kasse];
  for(const value of explicit){
    const n=explicitRegisterNumber(value);
    if(n) return `kasse-${String(n).padStart(2,'0')}`;
    const t=registerFromText(value);
    if(t) return `kasse-${String(t).padStart(2,'0')}`;
  }
  const textual=[body?.sourceId,heartbeat?.sourceId,heartbeat?.deviceId,instanceId];
  for(const value of textual){
    const n=registerFromText(value);
    if(n) return `kasse-${String(n).padStart(2,'0')}`;
  }
  return null;
}

Deno.serve(async (req:Request) => {
  if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  try{
    if(req.method==='GET'){
      const r=await rest('kicc_program_heartbeats?select=program_id,instance_id,version,build,status,measured_at,received_at,latency_ms,traffic_rx,traffic_tx,queue_depth,error_count,source_id,trust&order=received_at.desc&limit=100');
      if(!r.ok) return json({ok:false,error:'store_read_failed'},502);
      const rows=await r.json();
      return json({ok:true,heartbeats:rows,serverTime:new Date().toISOString()});
    }
    if(req.method!=='POST') return json({ok:false,error:'method_not_allowed'},405);
    const len=Number(req.headers.get('content-length')||0); if(len>8192) return json({ok:false,error:'payload_too_large'},413);
    const body=await req.json();
    const heartbeat=body?.heartbeat && typeof body.heartbeat==='object' ? body.heartbeat : body;
    const programId=clean(heartbeat.programId,100);
    const instanceId=clean(heartbeat.instanceId||heartbeat.deviceId||'browser',120);
    const nonce=clean(body?.nonce||heartbeat.nonce,120);
    const sentAt=new Date(body?.sentAt||heartbeat.measuredAt||'');
    if(!ALLOWED_PROGRAMS.has(programId)) return json({ok:false,error:'program_not_allowlisted'},403);
    if(!instanceId||!nonce||!Number.isFinite(sentAt.getTime())) return json({ok:false,error:'invalid_envelope'},400);
    const now=Date.now(); if(Math.abs(now-sentAt.getTime())>MAX_SKEW_MS) return json({ok:false,error:'stale_heartbeat'},409);
    const status=clean(heartbeat.status,30).toUpperCase();
    if(!['ONLINE','DEGRADED','OFFLINE','UNKNOWN','MAINTENANCE'].includes(status)) return json({ok:false,error:'invalid_status'},400);

    await rest('kicc_program_heartbeat_nonces?received_at=lt.'+encodeURIComponent(new Date(now-10*60_000).toISOString()),{method:'DELETE'});
    const nonceInsert=await rest('kicc_program_heartbeat_nonces',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({nonce})});
    if(nonceInsert.status===409) return json({ok:false,error:'replay_detected'},409);
    if(!nonceInsert.ok) return json({ok:false,error:'nonce_store_failed'},502);

    const recent=await rest(`kicc_program_heartbeats?select=received_at&program_id=eq.${encodeURIComponent(programId)}&instance_id=eq.${encodeURIComponent(instanceId)}&limit=1`);
    if(recent.ok){ const rows=await recent.json(); const last=rows?.[0]?.received_at?new Date(rows[0].received_at).getTime():0; if(last && now-last<MIN_INTERVAL_MS) return json({ok:false,error:'rate_limited',retryAfterMs:MIN_INTERVAL_MS-(now-last)},429); }

    const trafficTx=metric(heartbeat.trafficTx,Number.MAX_SAFE_INTEGER);
    const row={program_id:programId,instance_id:instanceId,version:clean(heartbeat.version,80)||null,build:clean(heartbeat.build,80)||null,status,measured_at:sentAt.toISOString(),received_at:new Date(now).toISOString(),latency_ms:metric(heartbeat.latencyMs),traffic_rx:metric(heartbeat.trafficRx,Number.MAX_SAFE_INTEGER),traffic_tx:trafficTx,queue_depth:metric(heartbeat.queueDepth),error_count:metric(heartbeat.errorCount),source_id:clean(body?.sourceId||heartbeat?.sourceId||instanceId,120),trust:'OBSERVED_BRIDGE'};
    const upsert=await rest('kicc_program_heartbeats?on_conflict=program_id,instance_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(row)});
    if(!upsert.ok) return json({ok:false,error:'heartbeat_store_failed'},502);

    let trafficFlowRecorded=false;
    let trafficFlowReason='not_kasse_or_no_confirmed_tx';
    if(programId==='kc-bilderkasse' && Number(trafficTx||0)>0){
      const sourceId=resolveKasseSource(body,heartbeat,instanceId);
      if(sourceId){
        const flow={
          program_id:programId,
          instance_id:instanceId,
          source_id:sourceId,
          target_id:'pc-manager',
          flow_type:'SYNC',
          event_count:Math.max(1,Math.round(Number(trafficTx))),
          byte_count:null,
          status:'OK',
          measured_at:sentAt.toISOString(),
          received_at:new Date(now).toISOString(),
          source:'HEARTBEAT_INTERVAL_TX',
          trust:'SERVER_VERIFIED'
        };
        const flowInsert=await rest('kicc_program_flow_events',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(flow)});
        if(!flowInsert.ok) return json({ok:false,error:'kasse_flow_store_failed'},502);
        trafficFlowRecorded=true;
        trafficFlowReason='confirmed_companion_tx';
      }else{
        trafficFlowReason='register_unresolved';
      }
    }

    return json({ok:true,programId,instanceId,receivedAt:row.received_at,trust:'OBSERVED_BRIDGE',trafficFlowRecorded,trafficFlowReason});
  }catch(e){ return json({ok:false,error:'internal_error',detail:String((e as Error)?.message||e)},500); }
});
