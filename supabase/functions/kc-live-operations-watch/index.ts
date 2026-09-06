import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const H={apikey:SERVICE,Authorization:`Bearer ${SERVICE}`,'Content-Type':'application/json'};
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-kc-automation','Access-Control-Allow-Methods':'GET,OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:CORS});
async function rest(path:string,init:RequestInit={}){const h=new Headers(init.headers||{});h.set('apikey',SERVICE);h.set('authorization',`Bearer ${SERVICE}`);h.set('content-type','application/json');return fetch(`${BASE}/rest/v1/${path}`,{...init,headers:h});}
async function rows(path:string){const r=await rest(path);if(!r.ok)throw new Error(`${path.split('?')[0]}_${r.status}`);return await r.json();}
async function targets(){return rows('kc_live_operations_targets?select=*&enabled=eq.true&order=sort_order');}
async function states(){return rows('kc_live_operations_state?select=*');}
async function heartbeats(){return rows('kicc_program_heartbeats?select=program_id,instance_id,version,build,status,received_at,measured_at,queue_depth,error_count,source_id,trust&order=received_at.desc');}
async function alertSettings(){const r=await rest('kc_system_check_alert_settings?select=*&id=eq.global');if(!r.ok)return null;return (await r.json())[0]||null;}

// Wer fragt? Der oeffentliche Schluessel ist Gateway-Schluessel, keine Berechtigung.
// Zugelassen sind ein freigeschaltetes Konto oder die Automatik-Kennung.
async function callerAllowed(req:Request){
  const automation=(req.headers.get('x-kc-automation')||'').trim();
  if(automation){
    try{
      const r=await rest('rpc/kc_automation_verify',{method:'POST',body:JSON.stringify({p_name:'cron',p_token:automation})});
      if(r.ok&&await r.json()===true)return{ok:true,as:'automation'};
    }catch{}
    return{ok:false,reason:'automatik_kennung_ungueltig'};
  }
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return{ok:false,reason:'kein_zugangstoken'};
  if(token===SERVICE)return{ok:true,as:'service'};
  if(token.startsWith('sb_publishable_'))return{ok:false,reason:'nur_oeffentlicher_schluessel'};
  try{const b=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(b?.role==='anon')return{ok:false,reason:'nur_oeffentlicher_schluessel'}}catch{}
  let user:any=null;
  try{const ur=await fetch(`${BASE}/auth/v1/user`,{headers:{apikey:SERVICE,Authorization:`Bearer ${token}`}});if(ur.ok)user=await ur.json()}catch{}
  if(!user?.id)return{ok:false,reason:'anmeldung_ungueltig'};
  try{
    const rr=await rest('rpc/kc_system_check_operator_role',{method:'POST',body:JSON.stringify({p_user:user.id})});
    if(rr.ok){const role=await rr.json();if(typeof role==='string')return{ok:true,as:role}}
  }catch{}
  return{ok:false,reason:'kein_leitstand_zugang'};
}

// Entprellung: dasselbe Regelwerk wie in der App. Faellt der Aufruf aus,
// meldet die Funktion null und der Aufrufer nutzt die Sofortlogik als Rueckfall.
async function alarmApply(signals:any[]){
  if(!signals.length)return{notify:[],recovered:[],suppressed:[],alarms:[]};
  try{
    const r=await rest('rpc/kc_system_check_alarm_apply',{method:'POST',body:JSON.stringify({p_signals:signals,p_policy:{}})});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null}
}

const parse=(v:any)=>{const n=Date.parse(v||'');return Number.isFinite(n)?n:0};
const ageSec=(v:any)=>{const n=parse(v);return n?Math.max(0,(Date.now()-n)/1000):Infinity};
const badWord=(v:any)=>/(fail|error|down|critical|broken|invalid)/i.test(String(v||''));
const warnWord=(v:any)=>/(warn|degrad|retry|partial|unknown)/i.test(String(v||''));
function evaluate(t:any,all:any[],stored:any){const sorted=all.filter(x=>x.program_id===t.program_id).sort((a,b)=>parse(b.received_at)-parse(a.received_at));const current=sorted.slice(0,Number(t.expected_instances||1));const detected=Math.min(sorted.length,Number(t.expected_instances||1));let armed=!!t.armed;const canAuto=!!t.auto_arm_on_first_heartbeat&&detected>=Number(t.expected_instances||1);if(!armed&&canAuto)armed=true;if(!armed)return{state:'prepared',armed:false,onlineInstances:detected,detectedInstances:detected,lastHeartbeatAt:current[0]?.received_at||stored?.last_heartbeat_at||null,detail:'Noch nicht vollständig verbunden',instances:current};let worst='healthy',online=0,last:string|null=null;const now=Date.now();for(const hb of current){const ts=parse(hb.received_at||hb.measured_at);if(!last||ts>parse(last))last=hb.received_at||hb.measured_at;const age=ts?Math.max(0,(now-ts)/1000):Infinity;const explicit=String(hb.status||'UNKNOWN').toUpperCase();let st='healthy';if(explicit==='OFFLINE'||age>=Number(t.critical_after_seconds))st='critical';else if(explicit==='DEGRADED'||explicit==='UNKNOWN'||age>=Number(t.warning_after_seconds)||(Number(hb.error_count||0)>0))st='warning';if(age<Number(t.warning_after_seconds)&&explicit==='ONLINE')online++;if(st==='critical')worst='critical';else if(st==='warning'&&worst!=='critical')worst='warning';}if(current.length<Number(t.expected_instances||1))worst='critical';const missing=Math.max(0,Number(t.expected_instances||1)-online);const detail=worst==='healthy'?`${online}/${t.expected_instances} Instanzen online`:worst==='warning'?`${online}/${t.expected_instances} online · Prüfung eingeschränkt`:`${missing||t.expected_instances} Instanz(en) ohne aktuelles Lebenszeichen`;return{state:worst,armed:true,onlineInstances:online,detectedInstances:detected,lastHeartbeatAt:last||stored?.last_heartbeat_at||null,detail,instances:current};}
async function patchTargetArmed(key:string){await rest(`kc_live_operations_targets?target_key=eq.${encodeURIComponent(key)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({armed:true,updated_at:new Date().toISOString()})});}
async function patchState(key:string,ev:any,prev:string,alerted=false){const body={state:ev.state,previous_state:prev||null,online_instances:ev.onlineInstances||0,detected_instances:ev.detectedInstances||0,last_heartbeat_at:ev.lastHeartbeatAt||null,last_transition_at:prev!==ev.state?new Date().toISOString():undefined,last_alert_at:alerted?new Date().toISOString():undefined,last_detail:ev.detail,updated_at:new Date().toISOString()};const clean=Object.fromEntries(Object.entries(body).filter(([,v])=>v!==undefined));await rest(`kc_live_operations_state?target_key=eq.${encodeURIComponent(key)}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(clean)});}
function channelsFor(kind:string,s:any){const out:string[]=[];if(!s)return out;if(kind==='warning'){if(s.push_enabled&&s.push_min_severity==='warning')out.push('push');if(s.email_enabled&&s.email_min_severity==='warning')out.push('email');}else if(kind==='critical'){if(s.push_enabled)out.push('push');if(s.email_enabled)out.push('email');}else if(kind==='recovered'){if(s.recovery_push_enabled)out.push('push');if(s.recovery_email_enabled)out.push('email');}return out;}
async function dispatch(eventKey:string,channels:string[],target:any,ev:any,prev:string){if(!channels.length)return null;await rest(`kc_communication_event_rules?source_program=eq.kc-system-check&event_key=eq.${eventKey}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({channels,channel_mode:'all',updated_at:new Date().toISOString()})});const eventName=eventKey==='live_operation_error'?'Live-Betrieb AUSFALL':eventKey==='live_operation_warning'?'Live-Betrieb Warnung':'Live-Betrieb Entwarnung';const variables={programName:'KC System Check',eventName,message:`${target.display_name}: ${ev.detail}. Vorher: ${prev||'unbekannt'}.`,title:`${eventName}: ${target.display_name}`,subject:`${eventName}: ${target.display_name}`,body:`${target.display_name}: ${ev.detail}`,text:`${target.display_name}: ${ev.detail}`,status:ev.state,timestamp:new Date().toISOString()};const r=await fetch(`${BASE}/functions/v1/kc-communication-router`,{method:'POST',headers:H,body:JSON.stringify({sourceProgram:'kc-system-check',eventKey,variables,priority:eventKey==='live_operation_error'?'critical':eventKey==='live_operation_warning'?'high':'normal',testOnly:false,correlationId:`live-${target.target_key}-${ev.state}-${crypto.randomUUID()}`})});return{http:r.status,...await r.json().catch(()=>({}))};}
async function supportData(){const safe=async(path:string)=>{try{return await rows(path)}catch{return[]}};const [routes,devices,requests,backup,pos]=await Promise.all([safe('kc_communication_provider_routes?select=channel,provider_id,enabled,health_status,last_health_at,last_success_at,last_failure_at,consecutive_failures&enabled=eq.true&order=channel,priority'),safe('kc_communication_push_devices?select=id,active,last_seen_at,device_label&active=eq.true'),safe('kc_communication_requests?select=channel,status,created_at,sent_at,error_code&order=created_at.desc&limit=20'),safe('kc_backup_machine_telemetry?select=source_program,app_version,status,last_backup_at,last_backup_status,last_integrity_at,integrity_result,last_restore_test_at,restore_result,storage_target,b2_status,measured_at&order=measured_at.desc.nullslast&limit=5'),safe('kc_pos_live_events?select=register_id,instance_id,event_type,sync_state,queue_depth,occurred_at,received_at&order=received_at.desc&limit=50')]);return{routes,devices,requests,backup,pos};}
function supportEval(key:string,programTargets:any[],hbs:any[],sd:any,settings:any){if(key==='support_infrastructure'){const armed=programTargets.filter(x=>x.armed);if(!armed.length)return{state:'prepared',detail:'Markt-Verbindung vorbereitet · noch keine scharf überwachten Marktprogramme',lastHeartbeatAt:null};const worst=armed.some(x=>x.state==='critical')?'critical':armed.some(x=>x.state==='warning')?'warning':'healthy';const latest=armed.map(x=>x.lastHeartbeatAt).filter(Boolean).sort((a,b)=>parse(b)-parse(a))[0]||null;return{state:worst,detail:`${armed.filter(x=>x.state==='healthy').length}/${armed.length} überwachte Bereiche erreichbar · Router/WLAN aus Programm-Heartbeats abgeleitet`,lastHeartbeatAt:latest};}if(key==='support_pos_operation'){const t=programTargets.find(x=>x.targetKey==='market_registers');if(!t||!t.armed)return{state:'prepared',detail:'Kassenbetrieb vorbereitet · Kassen noch nicht vollständig verbunden',lastHeartbeatAt:null};const recent=sd.pos||[];const maxQ=Math.max(0,...recent.map((x:any)=>Number(x.queue_depth||0)));const bad=recent.some((x:any)=>badWord(x.sync_state));const warn=recent.some((x:any)=>warnWord(x.sync_state));let st=t.state;if(bad||maxQ>=100)st='critical';else if((warn||maxQ>=20)&&st!=='critical')st='warning';const last=recent[0]?.received_at||t.lastHeartbeatAt;return{state:st,detail:`Kassen ${t.onlineInstances||0}/${t.expectedInstances||2} erreichbar · Sync-Queue max. ${maxQ}${recent[0]?.received_at?' · letzte Betriebsaktivität '+Math.round(ageSec(recent[0].received_at)/60)+' Min.':''}`,lastHeartbeatAt:last};}if(key==='support_communicator'){const enabledChannels=['push','email'].filter(ch=>settings?.[`${ch}_enabled`]!==false);if(!enabledChannels.length)return{state:'prepared',detail:'Push und E-Mail sind in den Alarmregeln deaktiviert',lastHeartbeatAt:null};let bad=0,warn=0;for(const ch of enabledChannels){const rr=(sd.routes||[]).filter((x:any)=>x.channel===ch);const healthy=rr.some((x:any)=>String(x.health_status).toLowerCase()==='healthy');if(!rr.length||!healthy)bad++;else if(rr.some((x:any)=>Number(x.consecutive_failures||0)>0))warn++;if(ch==='push'&&(sd.devices||[]).length===0)bad++;}const lastReq=(sd.requests||[]).find((x:any)=>enabledChannels.includes(x.channel));const st=bad>=enabledChannels.length?'critical':bad>0||warn>0?'warning':'healthy';return{state:st,detail:`Push-Geräte ${(sd.devices||[]).length} · ${enabledChannels.map(ch=>{const r=(sd.routes||[]).find((x:any)=>x.channel===ch&&String(x.health_status).toLowerCase()==='healthy');return `${ch==='push'?'Push':'E-Mail'} ${r?'bereit':'gestört'}`}).join(' · ')}${lastReq?` · letzter Auftrag ${lastReq.status}`:''}`,lastHeartbeatAt:lastReq?.sent_at||lastReq?.created_at||null};}if(key==='support_backup'){const b=(sd.backup||[])[0];if(!b)return{state:'prepared',detail:'Backup-Telemetrie noch nicht verbunden',lastHeartbeatAt:null};const age=ageSec(b.last_backup_at);let st='healthy';if(badWord(b.status)||badWord(b.last_backup_status)||badWord(b.integrity_result)||badWord(b.restore_result)||age>604800)st='critical';else if(age>172800||!b.last_restore_test_at||warnWord(b.integrity_result)||warnWord(b.restore_result))st='warning';const ageH=Number.isFinite(age)?Math.round(age/3600):null;return{state:st,detail:`Letztes Backup ${ageH===null?'unbekannt':ageH+' Std.'} · ${b.last_backup_status||b.status||'Status offen'} · Restore-Test ${b.last_restore_test_at?(b.restore_result||'vorhanden'):'noch nicht belegt'}${b.storage_target?' · Ziel '+b.storage_target:''}`,lastHeartbeatAt:b.measured_at||b.last_backup_at||null};}if(key==='support_versions'){const tracked=new Set(['kc-system-check','kc-pc-manager','kc-bilderkasse','kc-wm-presentation']);const fresh=hbs.filter((x:any)=>tracked.has(String(x.program_id))&&ageSec(x.received_at)<600);const groups=new Map<string,any[]>();for(const hb of fresh){if(!groups.has(hb.program_id))groups.set(hb.program_id,[]);const a=groups.get(hb.program_id)!;if(!a.some(x=>x.instance_id===hb.instance_id))a.push(hb);}const parts:string[]=[];let mismatch=false,seen=0,last:string|null=null;for(const [pid,a] of groups){const vers=[...new Set(a.map(x=>x.version).filter(Boolean))];if(vers.length){seen++;parts.push(`${pid}: ${vers.join('/')}`);if(vers.length>1)mismatch=true;}for(const x of a)if(!last||parse(x.received_at)>parse(last))last=x.received_at;}if(!seen)return{state:'prepared',detail:'Versionsdaten der überwachten Programme noch nicht vorhanden',lastHeartbeatAt:null};return{state:mismatch?'warning':'healthy',detail:`${mismatch?'Versionsabweichung bei aktuell aktiven Instanzen':'Aktive Instanzen versionsgleich'} · ${parts.slice(0,4).join(' · ')}`,lastHeartbeatAt:last};}return{state:'prepared',detail:'Vorbereitet',lastHeartbeatAt:null};}

async function snapshot(runAlerts=false){
  const [ts,ss,hbs,as,sd]=await Promise.all([targets(),states(),heartbeats(),alertSettings(),supportData()]);
  const sm=new Map(ss.map((x:any)=>[x.target_key,x]));
  const heartbeatTargets=ts.filter((t:any)=>!String(t.program_id).startsWith('support:'));
  const supportTargets=ts.filter((t:any)=>String(t.program_id).startsWith('support:'));

  // Durchgang 1: bewerten, ohne zu alarmieren
  const pending:any[]=[];
  const output:any[]=[];
  for(const t of heartbeatTargets){
    const old:any=sm.get(t.target_key)||{};
    const ev=evaluate(t,hbs,old);
    if(ev.armed&&!t.armed)await patchTargetArmed(t.target_key);
    pending.push({t,ev,prev:String(old.state||'prepared'),support:false});
    output.push({targetKey:t.target_key,programId:t.program_id,displayName:t.display_name,expectedInstances:t.expected_instances,warningAfterSeconds:t.warning_after_seconds,criticalAfterSeconds:t.critical_after_seconds,armed:ev.armed,state:ev.state,onlineInstances:ev.onlineInstances,detectedInstances:ev.detectedInstances,lastHeartbeatAt:ev.lastHeartbeatAt,detail:ev.detail,instances:ev.instances,transition:null,dispatch:null});
  }
  for(const t of supportTargets){
    const old:any=sm.get(t.target_key)||{};
    const ev:any=supportEval(t.target_key,output,hbs,sd,as);
    pending.push({t,ev,prev:String(old.state||'prepared'),support:true});
  }

  // Entprellung: ein Aufruf fuer alle scharf gestellten Signale
  const signals=pending
    .filter(p=>p.ev.state!=='prepared'&&(p.support||p.ev.armed))
    .map(p=>({id:p.t.target_key,name:p.t.display_name,status:p.ev.state}));
  const decision=runAlerts?await alarmApply(signals):{notify:[],recovered:[],suppressed:[]};
  const debounced=decision!==null;
  const notify=new Map((decision?.notify||[]).map((x:any)=>[x.id,x]));
  const recovered=new Set((decision?.recovered||[]).map((x:any)=>x.id));

  // Durchgang 2: nur melden, was das Regelwerk freigibt
  const support:any[]=[];
  for(let i=0;i<pending.length;i++){
    const{t,ev,prev,support:isSupport}=pending[i];
    let eventKey='',kind='';
    const eligible=runAlerts&&(isSupport?prev!=='prepared'&&ev.state!=='prepared':ev.armed);
    if(eligible){
      if(debounced){
        const hit:any=notify.get(t.target_key);
        if(hit){
          if(hit.status==='critical'){eventKey='live_operation_error';kind='critical'}
          else{eventKey='live_operation_warning';kind='warning'}
        }else if(recovered.has(t.target_key)){eventKey='live_operation_recovered';kind='recovered'}
      }else if(ev.state!==prev){
        // Rueckfall, falls das Regelwerk nicht erreichbar war
        if(ev.state==='critical'){eventKey='live_operation_error';kind='critical'}
        else if(ev.state==='warning'){eventKey='live_operation_warning';kind='warning'}
        else if(ev.state==='healthy'&&['warning','critical'].includes(prev)){eventKey='live_operation_recovered';kind='recovered'}
      }
    }
    let dispatchResult=null;
    if(eventKey)dispatchResult=await dispatch(eventKey,channelsFor(kind,as),t,ev,prev);
    if(isSupport){
      await patchState(t.target_key,{...ev,onlineInstances:ev.state==='healthy'?1:0,detectedInstances:ev.state==='prepared'?0:1},prev,!!dispatchResult);
      support.push({targetKey:t.target_key,programId:t.program_id,displayName:t.display_name,armed:true,state:ev.state,detail:ev.detail,lastHeartbeatAt:ev.lastHeartbeatAt,transition:ev.state!==prev?{from:prev,to:ev.state}:null,dispatch:dispatchResult});
    }else{
      await patchState(t.target_key,ev,prev,!!dispatchResult);
      const row=output.find(x=>x.targetKey===t.target_key);
      if(row){row.dispatch=dispatchResult;row.transition=ev.state!==prev?{from:prev,to:ev.state}:null}
    }
  }

  const rank=(s:string)=>s==='critical'?3:s==='warning'?2:s==='healthy'?1:0;
  const armed=output.filter(x=>x.armed);
  const overall=armed.length?armed.reduce((a,b)=>rank(b.state)>rank(a)?b.state:a,'healthy'):'prepared';
  const supportOverall=support.filter(x=>x.state!=='prepared').length?support.reduce((a,b)=>rank(b.state)>rank(a)?b.state:a,'healthy'):'prepared';
  return{ok:true,overall,targets:output,supportOverall,support,
         alarmPolicy:{applied:debounced,suppressed:decision?.suppressed||[],notified:(decision?.notify||[]).length,recovered:(decision?.recovered||[]).length},
         serverTime:new Date().toISOString()};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
  if(req.method!=='GET')return json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
  try{
    const who=await callerAllowed(req);
    if(!who.ok)return json({ok:false,error:'zugang_gesperrt',reason:who.reason,hint:'Anmeldung mit einem freigeschalteten Konto erforderlich.'},403);
    const u=new URL(req.url);
    // Alarmieren darf nur die Automatik, nicht ein geoeffneter Browser-Tab
    const runAlerts=u.searchParams.get('run')==='1'&&(who.as==='automation'||who.as==='service');
    return json(await snapshot(runAlerts));
  }catch(e){return json({ok:false,error:String((e as Error)?.message||e)},500);}
});
