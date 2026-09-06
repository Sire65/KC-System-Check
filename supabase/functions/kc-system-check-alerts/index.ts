import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-kc-automation","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
const BASE=Deno.env.get("SUPABASE_URL")||"";
const SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const H={apikey:SERVICE,Authorization:`Bearer ${SERVICE}`,"Content-Type":"application/json"};
const statusRank=(s:string)=>s==="critical"?2:s==="warning"?1:0;
async function rpc(name:string,body:unknown){return fetch(`${BASE}/rest/v1/rpc/${name}`,{method:"POST",headers:H,body:JSON.stringify(body)})}

// Zugang: Automatik-Kennung oder freigeschaltetes Konto. Der oeffentliche
// Schluessel ist Gateway-Schluessel und ab hier keine Berechtigung mehr.
async function caller(req:Request){
  const automation=(req.headers.get("x-kc-automation")||"").trim();
  if(automation){
    try{const r=await rpc("kc_automation_verify",{p_name:"cron",p_token:automation});if(r.ok&&await r.json()===true)return{ok:true,as:"automation"}}catch{}
    return{ok:false,reason:"automatik_kennung_ungueltig"};
  }
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return{ok:false,reason:"kein_zugangstoken"};
  if(token===SERVICE)return{ok:true,as:"service"};
  if(token.startsWith("sb_publishable_"))return{ok:false,reason:"nur_oeffentlicher_schluessel"};
  try{const b=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));if(b?.role==="anon")return{ok:false,reason:"nur_oeffentlicher_schluessel"}}catch{}
  let user:any=null;
  try{const ur=await fetch(`${BASE}/auth/v1/user`,{headers:{apikey:SERVICE,Authorization:`Bearer ${token}`}});if(ur.ok)user=await ur.json()}catch{}
  if(!user?.id)return{ok:false,reason:"anmeldung_ungueltig"};
  try{const rr=await rpc("kc_system_check_operator_role",{p_user:user.id});if(rr.ok){const role=await rr.json();if(typeof role==="string")return{ok:true,as:role,userId:user.id}}}catch{}
  return{ok:false,reason:"kein_leitstand_zugang",userId:user.id};
}
async function settings(){const r=await fetch(`${BASE}/rest/v1/kc_system_check_alert_settings?select=*&id=eq.global`,{headers:H});if(!r.ok)throw new Error(`settings_${r.status}`);return (await r.json())[0]}
async function saveSettings(p:any){const clean={push_enabled:p.push_enabled===true,email_enabled:p.email_enabled===true,push_min_severity:["warning","critical"].includes(p.push_min_severity)?p.push_min_severity:"warning",email_min_severity:["warning","critical"].includes(p.email_min_severity)?p.email_min_severity:"critical",check_interval_minutes:[15,30,60].includes(Number(p.check_interval_minutes))?Number(p.check_interval_minutes):15,recovery_push_enabled:p.recovery_push_enabled!==false,recovery_email_enabled:p.recovery_email_enabled===true,updated_at:new Date().toISOString()};const r=await fetch(`${BASE}/rest/v1/kc_system_check_alert_settings?id=eq.global`,{method:"PATCH",headers:{...H,Prefer:"return=representation"},body:JSON.stringify(clean)});if(!r.ok)throw new Error(`settings_save_${r.status}`);return (await r.json())[0]}
async function isAdmin(req:Request){const auth=req.headers.get("authorization")||"";if(!/^Bearer\s+/.test(auth))return false;const token=auth.replace(/^Bearer\s+/i,"");if(!token||token===SERVICE)return true;const ur=await fetch(`${BASE}/auth/v1/user`,{headers:{apikey:SERVICE,Authorization:`Bearer ${token}`}});if(!ur.ok)return false;const u=await ur.json();if(!u?.id)return false;const lr=await fetch(`${BASE}/rest/v1/kc_core_user_links?select=core_role,active&user_id=eq.${encodeURIComponent(u.id)}&active=eq.true&limit=1`,{headers:H});if(!lr.ok)return false;const rows=await lr.json();return !!rows[0]&&["admin","superadmin"].includes(String(rows[0].core_role))}
async function providerState(){const r=await fetch(`${BASE}/rest/v1/kc_communication_provider_routes?select=channel,health_status,consecutive_failures,enabled,priority,last_success_at,last_failure_at&enabled=eq.true&channel=in.(push,email)&order=channel,priority`,{headers:H});const rows=r.ok?await r.json():[];const first=(ch:string)=>rows.find((x:any)=>x.channel===ch)||null;return{push:first("push"),email:first("email")}}
async function latestDelivery(channel:string){const q=`${BASE}/rest/v1/kc_communication_requests?select=id,status,provider_id,provider_message_id,error_code,error_detail,created_at,sent_at&source_program=eq.kc-system-check&channel=eq.${channel}&order=created_at.desc&limit=1`;const r=await fetch(q,{headers:H});if(!r.ok)return null;return (await r.json())[0]||null}
async function deliveryState(){const [push,email]=await Promise.all([latestDelivery('push'),latestDelivery('email')]);return{push,email}}
function publicSettings(s:any,p:any,d:any){return{pushEnabled:!!s.push_enabled,emailEnabled:!!s.email_enabled,pushMinSeverity:s.push_min_severity,emailMinSeverity:s.email_min_severity,checkIntervalMinutes:s.check_interval_minutes,recoveryPushEnabled:!!s.recovery_push_enabled,recoveryEmailEnabled:!!s.recovery_email_enabled,lastFullStatus:s.last_full_status,lastEvaluatedAt:s.last_evaluated_at,lastAlertStatus:s.last_alert_status,lastAlertAt:s.last_alert_at,providers:p,delivery:d}}
async function patchRule(eventKey:string,channels:string[],mode:string){const r=await fetch(`${BASE}/rest/v1/kc_communication_event_rules?source_program=eq.kc-system-check&event_key=eq.${eventKey}`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify({channels,channel_mode:mode,updated_at:new Date().toISOString()})});if(!r.ok)throw new Error(`rule_patch_${eventKey}_${r.status}`)}
async function router(eventKey:string,status:string,payload:any,testLabel:string|null=null,bewertung:any=null){
  // Gemeldet wird, was das Regelwerk durchgelassen hat - nicht jede gelbe
  // Kachel. Unterdrueckte Folgealarme stehen als Zahl dabei, damit die
  // Unterdrueckung sichtbar bleibt und nicht stillschweigend passiert.
  const namen=(bewertung?.notify||[]).map((x:any)=>{const treffer=(payload.results||[]).find((r:any)=>r.id===x.id);return `${x.name}: ${treffer?.detail||x.status}`});
  const findings=(namen.length?namen:(payload.results||[]).filter((x:any)=>["warning","critical"].includes(String(x.status))).map((x:any)=>`${x.name}: ${x.detail||x.status}`)).slice(0,6);
  const unterdrueckt=Number(bewertung?.suppressed?.length||0);const isTest=!!testLabel;const variables={programName:"KC System Check",eventName:isTest?testLabel:eventKey==="system_error"?"Systemfehler":eventKey==="system_warning"?"Systemwarnung":"Entwarnung",message:isTest?`${testLabel}: Diese Nachricht bestätigt die produktive Alarmstrecke des KC System Check über KC Communicator.`:eventKey==="system_recovered"?"KC System Check meldet Entwarnung: Alle aktuell definierten Prüfungen sind wieder gesund.":`KC System Check meldet ${status==="critical"?"ROT":"GELB"}. ${findings.join(" · ")||"Bitte Leitstand prüfen."}${unterdrueckt?` · ${unterdrueckt} Folgealarm(e) unterdrückt`:""}`,status,health:payload.health,coverage:payload.coverage,timestamp:new Date().toISOString()};const rr=await fetch(`${BASE}/functions/v1/kc-communication-router`,{method:"POST",headers:H,body:JSON.stringify({sourceProgram:"kc-system-check",eventKey,recipients:[],variables,priority:isTest?"normal":status==="critical"?"critical":status==="warning"?"high":"normal",testOnly:false,correlationId:`system-check-${isTest?"channel-test":status}-${crypto.randomUUID()}`})});const out=await rr.json().catch(()=>({}));return{http:rr.status,...out}}
async function send(eventKey:string,channels:string[],status:string,payload:any,bewertung:any=null){if(!channels.length)return{skipped:true,reason:"channels_disabled"};await patchRule(eventKey,channels,eventKey==="system_error"?"all":"fallback");return await router(eventKey,status,payload,null,bewertung)}
async function testChannel(channel:"push"|"email"){const eventKey=channel==="push"?"communication_test_push":"communication_test_email";const label=`KC System Check · ${channel==="push"?"Push":"E-Mail"}-Test`;const result=await router(eventKey,"healthy",{health:100,coverage:100,results:[]},label);const ok=(result.http===200||result.http===207)&&result.ok===true;if(!ok)throw new Error(result.error||result.code||result.results?.[0]?.attempts?.find((x:any)=>x.result==='failed')?.reason||`KC Communicator HTTP ${result.http}`);return result}
async function updateState(status:string,alerted:boolean){const body:any={last_full_status:status,last_evaluated_at:new Date().toISOString(),updated_at:new Date().toISOString()};if(alerted){body.last_alert_status=status;body.last_alert_at=new Date().toISOString()}await fetch(`${BASE}/rest/v1/kc_system_check_alert_settings?id=eq.global`,{method:"PATCH",headers:{...H,Prefer:"return=minimal"},body:JSON.stringify(body)})}
// Nur die Signale, die ueberhaupt bewertbar sind - dasselbe Sieb wie
// signalsFromResults() in js/alarm-policy.js.
function signalsFromResults(results:any[]){
  return (results||[])
    .filter((r:any)=>r&&r.id&&!["not_configured","disabled"].includes(String(r.status)))
    .map((r:any)=>({id:r.id,name:r.name||r.id,status:r.status}));
}
// Bewertet die Rohzustaende mit dem hinterlegten Regelwerk: Entprellung,
// Wartungsfenster, Folgealarme, Wiedervorlage, Entwarnung. Faellt der Aufruf
// aus, wird NICHT stillschweigend alarmiert - dann meldet run() den Fehler.
async function evaluate(results:any[]){
  const r=await rpc("kc_system_check_alarm_apply",{p_signals:signalsFromResults(results),p_policy:{}});
  if(!r.ok)throw new Error(`alarm_apply_${r.status}`);
  const v=await r.json();
  return{notify:v?.notify||[],alarms:v?.alarms||[],suppressed:v?.suppressed||[],recovered:v?.recovered||[]};
}
async function run(){
  const s=await settings();
  if(s.last_evaluated_at){
    const age=(Date.now()-Date.parse(s.last_evaluated_at))/60000;
    if(Number.isFinite(age)&&age+0.5<Number(s.check_interval_minutes||15))
      return{ok:true,skipped:true,reason:"interval",nextInMinutes:Math.max(1,Math.ceil(Number(s.check_interval_minutes)-age))};
  }
  const pr=await fetch(`${BASE}/functions/v1/kc-system-check?record=1&trigger=auto`,{headers:{apikey:SERVICE,Authorization:`Bearer ${SERVICE}`}});
  const payload=await pr.json().catch(()=>({status:"critical",health:0,coverage:0,results:[],error:`HTTP_${pr.status}`}));
  const status=["healthy","warning","critical"].includes(String(payload.status))?String(payload.status):"critical";

  // Ab hier entscheidet das Regelwerk, nicht der Sprung des Gesamtzustands.
  // Vorher genuegte ein einzelner Aussetzer fuer eine Meldung.
  const v=await evaluate(payload.results||[]);
  const schwerste=v.notify.some((x:any)=>x.status==="critical")?"critical":v.notify.length?"warning":null;

  let eventKey="",channels:string[]=[];
  if(schwerste==="critical"){
    eventKey="system_error";
    if(s.push_enabled)channels.push("push");
    if(s.email_enabled)channels.push("email");
  }else if(schwerste==="warning"){
    eventKey="system_warning";
    if(s.push_enabled&&statusRank(s.push_min_severity)<=1)channels.push("push");
    if(s.email_enabled&&statusRank(s.email_min_severity)<=1)channels.push("email");
  }else if(v.recovered.length&&!v.alarms.length){
    // Entwarnung erst, wenn nichts mehr offen ist - sonst entwarnt das System
    // waehrend eine andere Stoerung weiterlaeuft.
    eventKey="system_recovered";
    if(s.recovery_push_enabled)channels.push("push");
    if(s.recovery_email_enabled)channels.push("email");
  }

  let dispatch:any=null;
  if(eventKey&&channels.length)dispatch=await send(eventKey,[...new Set(channels)],schwerste||"healthy",payload,v);
  await updateState(status,!!dispatch);
  return{ok:pr.ok,status,eventKey:eventKey||null,channels,dispatch,
    alarms:v.alarms.length,notified:v.notify.length,suppressed:v.suppressed.length,recovered:v.recovered.length,
    health:payload.health,coverage:payload.coverage,checkedAt:payload.checkedAt};
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  try{
    const u=new URL(req.url);
    if(req.method==="GET"){
      const who=await caller(req);
      if(!who.ok)return json({error:"zugang_gesperrt",reason:who.reason,hint:"Anmeldung mit einem freigeschalteten Konto erforderlich."},403);
      // Einen Pruflauf samt Alarmierung darf nur die Automatik ausloesen
      if(u.searchParams.get("run")==="1"){
        if(who.as!=="automation"&&who.as!=="service")return json({error:"nur_automatik",hint:"Ein Prüflauf mit Alarmierung wird ausschließlich vom Zeitplan ausgelöst."},403);
        return json(await run());
      }
      const [s,p,d]=await Promise.all([settings(),providerState(),deliveryState()]);
      return json({ok:true,settings:publicSettings(s,p,d)});
    }
    if(req.method==="POST"){
      if(!(await isAdmin(req)))return json({error:"ADMIN_REQUIRED"},403);
      let body:any={};try{body=await req.json()}catch{return json({error:"INVALID_JSON"},400)}
      if(body.action==="save_settings"){const s=await saveSettings(body.settings||{}),p=await providerState(),d=await deliveryState();return json({ok:true,settings:publicSettings(s,p,d)})}
      if(body.action==="test_email"||body.action==="test_push"){const channel=body.action==="test_push"?"push":"email";const result=await testChannel(channel);await new Promise(r=>setTimeout(r,channel==='push'?1200:200));const [s,p,d]=await Promise.all([settings(),providerState(),deliveryState()]);return json({ok:true,test:result,settings:publicSettings(s,p,d)})}
      return json({error:"UNSUPPORTED_ACTION"},400);
    }
    return json({error:"METHOD_NOT_ALLOWED"},405);
  }catch(e){return json({error:String((e as Error)?.message||e)},500)}
});
