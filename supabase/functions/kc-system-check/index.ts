import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FUTURE_URL="https://iddudrxuihdodnvejxcp.supabase.co",FUTURE_KEY="sb_publishable_DWLycZijZEBvakXVncI5IQ_38LZCQxW",GITHUB_REPO="https://api.github.com/repos/Sire65/KC-System-Check",FREE_DB_BYTES=500*1024*1024,NEON_FREE_BYTES=512*1024*1024,enc=new TextEncoder();
const pct=(n:number,d:number)=>d>0?Math.round(n/d*1000)/10:null,mb=(n:number)=>Math.round(n/1024/1024*10)/10;
async function timed(url:string,init:RequestInit={}){const s=Date.now(),r=await fetch(url,{...init,cache:"no-store"});return{r,ms:Date.now()-s}}
function mirrorHealth(s:any){const m=s?.mirror??{},age=m.finished_at?Math.round((Date.now()-new Date(m.finished_at).getTime())/60000):null,mis=Number(m.mismatch_count??0),non=Number(s?.non_ok_24h??0);if(!m||Object.keys(m).length===0)return{status:"unknown",health:null,age_min:null};let status="healthy",health=100;if(age===null||age>180){status="warning";health=72}if(mis>0||m.status!=="ok"){status="critical";health=35}else if(non>0){status="warning";health=Math.min(health,88)}return{status,health,age_min:age}}
const worst=(a:any[])=>a.some(x=>x.status==="critical")?"critical":a.some(x=>x.status==="warning")?"warning":a.some(x=>x.status==="healthy")?"healthy":"unknown";
const health=(a:any[])=>{const x=a.filter(v=>["healthy","warning","critical"].includes(v.status)&&Number.isFinite(v.health));return x.length?Math.round(x.reduce((s,v)=>s+v.health,0)/x.length):null};
async function history(url:string){const k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,r=await fetch(`${url}/rest/v1/kc_system_check_history?select=checked_at,trigger_type,overall_status,health,duration_ms,request_count,response_bytes,results&order=checked_at.desc&limit=40`,{headers:{apikey:k,Authorization:`Bearer ${k}`}});return r.ok?await r.json():[]}
async function usage(url:string){const rows=await history(url),from=Date.now()-31*86400000,m=rows.filter((x:any)=>Date.parse(x.checked_at)>=from);return{runs_31d:m.length,auto_31d:m.filter((x:any)=>x.trigger_type==="auto").length,manual_31d:m.filter((x:any)=>x.trigger_type!=="auto").length,requests_31d:m.reduce((n:number,x:any)=>n+Number(x.request_count||0),0),response_bytes_31d:m.reduce((n:number,x:any)=>n+Number(x.response_bytes||0),0)}}
async function leitstand(url:string){const k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,x=await timed(`${url}/rest/v1/rpc/kc_system_leitstand_snapshot`,{method:"POST",headers:{apikey:k,Authorization:`Bearer ${k}`,"Content-Type":"application/json"},body:"{}"});if(!x.r.ok)throw new Error(`leitstand_http_${x.r.status}`);const data=await x.r.json();return{version:"0.4.0-live",...data,server_latency_ms:x.ms,thresholds:{heartbeat_warn_seconds:90,heartbeat_critical_seconds:180},refresh_seconds:30}}
function endpointConfig(prefix:string){const url=Deno.env.get(`${prefix}_STATUS_URL`)||"",token=Deno.env.get(`${prefix}_STATUS_TOKEN`)||"";return{url,token}}
async function optionalEndpoint(prefix:string){const c=endpointConfig(prefix);if(!c.url)return null;return await timed(c.url,{headers:c.token?{Authorization:`Bearer ${c.token}`}:{}}).catch(()=>null)}
function endpointResult(id:string,name:string,kind:string,x:any,prepared:string){if(!x)return{id,name,kind,status:"not_configured",health:null,latency:null,usage:null,capacityLabel:"Vorbereitet · Zugang fehlt",detail:prepared,metrics:{direct_check:false}};return{id,name,kind,status:x.r.ok?"healthy":"warning",health:x.r.ok?100:70,latency:x.ms,usage:null,capacityLabel:"Read-only-Status aktiv",detail:x.r.ok?`${name} read-only erreichbar`:`${name} Read-only-Prüfung auffällig`,metrics:{direct_check:true,http_status:x.r.status}}}
// --- Zusaetzliche Pruefungen -------------------------------------------------
async function rpc(own:string,service:string,name:string){
  try{
    const x=await timed(`${own}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:"{}"});
    if(!x.r.ok)return{ok:false,status:x.r.status,ms:x.ms,data:null};
    return{ok:true,status:200,ms:x.ms,data:await x.r.json()};
  }catch{return{ok:false,status:0,ms:null,data:null}}
}
function notDeployed(id:string,name:string,kind:string,status:number){
  return{id,name,kind,status:"not_configured",health:null,latency:null,usage:null,capacityLabel:"Serverprüfung noch nicht eingespielt",detail:`${name} steht erst nach der Migration und einem Deploy zur Verfügung${status?` (HTTP ${status})`:""}`,metrics:{deployed:false}};
}
function securityResult(res:any){
  if(!res.ok)return notDeployed("db_security","Datenbank-Sicherheitslage","security",res.status);
  const d=res.data||{},rls=d.tables_without_rls||[],views=d.views_bypassing_rls||[],pol=d.permissive_policies||[],grants=d.public_grants||[];
  const findings=rls.length+views.length+pol.length+grants.length;
  // Ungedeckter Zugriff ist eine Stoerung. Eine Policy mit using(true) kann
  // beabsichtigt sein und gehoert geprueft - das ist eine Warnung, kein Ausfall.
  const status=rls.length||views.length||grants.length?"critical":pol.length?"warning":"healthy";
  const parts=[];
  if(rls.length)parts.push(`${rls.length} Tabelle(n) ohne RLS: ${rls.slice(0,5).join(", ")}`);
  if(views.length)parts.push(`${views.length} View(s) umgehen RLS: ${views.slice(0,3).join(", ")}`);
  if(grants.length)parts.push(`${grants.length} ungedeckte Rechte für anon/authenticated`);
  if(pol.length)parts.push(`${pol.length} Policy(s) mit uneingeschränktem Lesezugriff · prüfen, ob gewollt`);
  return{id:"db_security",name:"Datenbank-Sicherheitslage",kind:"security",status,health:status==="critical"?35:status==="warning"?72:100,latency:res.ms,usage:null,capacityLabel:findings?`${findings} Befund(e)`:"Keine Befunde",detail:parts.join(" · ")||"RLS aktiv, keine ungedeckten Rechte, keine uneingeschränkten Policies",metrics:{tables_without_rls:rls,views_bypassing_rls:views,permissive_policies:pol,public_grants:grants}};
}
function capacityResult(res:any){
  if(!res.ok)return notDeployed("db_capacity","Datenbank-Kapazität","database",res.status);
  const d=res.data||{},conn=d.connections||{},used=Number(conn.used||0),limit=Number(conn.limit_total||0);
  const pct=limit>0?Math.round(used/limit*1000)/10:null;
  const seq=d.sequences_near_limit||[],vac=d.vacuum_backlog||[],largest=d.largest_tables||[];
  const bloat=d.bloat||[],idx=d.unused_indexes||[];
  const mb=(b:any)=>Math.round(Number(b||0)/1048576*10)/10;
  // Nur echte Kapazitaetsrisiken faerben die Ampel. Leerraum durch staendiges
  // Aendern ist Normalbetrieb und wird wiederverwendet; ungenutzte Indexe sind
  // ein Sparhinweis, keine Stoerung. Sonst stuende die Kachel dauerhaft gelb.
  const schwererLeerraum=bloat.filter((x:any)=>Number(x.free_percent)>=50&&Number(x.heap_bytes)>50*1048576);
  const status=(pct!==null&&pct>=90)||seq.length?"critical":(pct!==null&&pct>=70)||vac.length||schwererLeerraum.length?"warning":"healthy";
  const top=largest[0];
  const parts=[pct!==null?`${used}/${limit} Verbindungen (${pct} %)`:`${used} Verbindungen`];
  if(top)parts.push(`größte Tabelle ${top.table} ${mb(top.bytes)} MB`);
  if(seq.length)parts.push(`${seq.length} Sequenz(en) über 70 % ausgeschöpft`);
  if(vac.length)parts.push(`${vac.length} Tabelle(n) mit echtem Vacuum-Rückstand`);
  if(bloat.length)parts.push(`${bloat[0].table} ${bloat[0].free_percent} % Leerraum${schwererLeerraum.length?" · aufräumen lohnt":" · normal bei ständigem Ändern"}`);
  if(idx.length)parts.push(`${idx.length} kaum genutzte(r) Index (${mb(idx.reduce((n:number,x:any)=>n+Number(x.bytes||0),0))} MB frei machbar): ${idx[0].index} bei ${idx[0].scans} Zugriffen`);
  return{id:"db_capacity",name:"Datenbank-Kapazität",kind:"database",status,health:status==="critical"?35:status==="warning"?72:100,latency:res.ms,usage:pct,capacityLabel:pct!==null?`${used} / ${limit} Verbindungen`:"Verbindungslimit unbekannt",detail:parts.join(" · "),metrics:{connections:conn,largest_tables:largest,sequences_near_limit:seq,vacuum_backlog:vac,bloat,unused_indexes:idx}};
}
async function exposureResult(own:string){
  const base=`${own}/functions/v1/kc-system-check`;
  const probe=async(url:string)=>{try{const r=await fetch(url,{cache:"no-store"});return r.status}catch{return 0}};
  const [openCheck,openLeitstand]=await Promise.all([probe(`${base}?probe=1`),probe(`${base}?leitstand=1`)]);
  const checkGuarded=openCheck===401||openCheck===403,leitstandGuarded=openLeitstand===401||openLeitstand===403;
  const status=checkGuarded&&leitstandGuarded?"healthy":"critical";
  return{id:"endpoint_exposure",name:"Endpunkt-Absicherung","kind":"security",status,health:status==="healthy"?100:35,latency:null,usage:null,capacityLabel:status==="healthy"?"Ohne Anmeldung abgewiesen":"Ohne Anmeldung erreichbar",detail:status==="healthy"?`Unangemeldete Aufrufe werden abgewiesen (Prüfung ${openCheck}, Leitstand ${openLeitstand})`:`Unangemeldeter Zugriff möglich: Prüfung HTTP ${openCheck}, Leitstand HTTP ${openLeitstand}`,metrics:{check_status:openCheck,leitstand_status:openLeitstand}};
}
function keyLifetimeResult(){
  const token=Deno.env.get("SUPABASE_ANON_KEY")||"";
  const parts=token.split(".");
  // Neues Supabase-Format: Schluessel ohne Ablaufdatum. Das ist kein
  // unbekannter Zustand, sondern ein bekannter - Rotation ist Handarbeit.
  if(token.startsWith("sb_publishable_")||token.startsWith("sb_secret_"))
    return{id:"key_lifetime",name:"Schlüssel-Restlaufzeit",kind:"security",status:"healthy",health:100,latency:null,usage:null,capacityLabel:"Kein Ablaufdatum",detail:"Neues Schlüsselformat ohne Ablauf · kein automatisches Auslaufen, Rotation bleibt Handarbeit",metrics:{format:"publishable",days_left:null,expires_at:null}};
  if(parts.length!==3)return{id:"key_lifetime",name:"Schlüssel-Restlaufzeit",kind:"security",status:"unknown",health:null,latency:null,usage:null,capacityLabel:"Nicht auswertbar",detail:"Der öffentliche Schlüssel liegt weder als JWT noch im neuen Format vor",metrics:{}};
  let exp=0,iat=0;
  try{const body=JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));exp=Number(body.exp||0);iat=Number(body.iat||0)}catch{}
  if(!exp)return{id:"key_lifetime",name:"Schlüssel-Restlaufzeit",kind:"security",status:"unknown",health:null,latency:null,usage:null,capacityLabel:"Nicht auswertbar",detail:"Kein Ablaufdatum im Schlüssel gefunden",metrics:{}};
  const days=Math.round((exp*1000-Date.now())/86400000),totalYears=iat?Math.round((exp-iat)/31557600*10)/10:null;
  const tooLong=totalYears!==null&&totalYears>5;
  const status=days<30?"critical":days<90||tooLong?"warning":"healthy";
  const notes=[`noch ${days} Tage gültig`];
  if(totalYears!==null)notes.push(`Gesamtlaufzeit ${totalYears} Jahre${tooLong?" · Rotation einplanen":""}`);
  return{id:"key_lifetime",name:"Schlüssel-Restlaufzeit",kind:"security",status,health:status==="critical"?35:status==="warning"?72:100,latency:null,usage:null,capacityLabel:`${days} Tage`,detail:notes.join(" · "),metrics:{days_left:days,total_years:totalYears,expires_at:new Date(exp*1000).toISOString()}};
}
// Wer fragt? Der anon-Key ist ab hier keine Berechtigung mehr, sondern nur noch
// der Gateway-Schluessel. Zugang entscheidet kc_system_check_operators.
async function callerRole(req:Request,own:string,service:string){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
  if(!token)return{role:null,reason:"kein_zugangstoken"};
  // Der oeffentliche Schluessel wird direkt abgewiesen - egal ob als neues
  // Format konfiguriert oder als aelterer anon-JWT mitgeschickt. Das spart
  // zugleich die Rueckfrage bei /auth/v1/user.
  if(anon&&token===anon)return{role:null,reason:"nur_oeffentlicher_schluessel"};
  if(token.startsWith("sb_publishable_"))return{role:null,reason:"nur_oeffentlicher_schluessel"};
  try{const b=JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));if(b?.role==="anon")return{role:null,reason:"nur_oeffentlicher_schluessel"}}catch{}
  let user:any=null;
  try{const r=await fetch(`${own}/auth/v1/user`,{headers:{apikey:anon||service,Authorization:`Bearer ${token}`}});if(r.ok)user=await r.json()}catch{}
  if(!user?.id)return{role:null,reason:"anmeldung_ungueltig"};
  let role:string|null=null;
  try{
    const r=await fetch(`${own}/rest/v1/rpc/kc_system_check_operator_role`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:JSON.stringify({p_user:user.id})});
    if(r.ok){const value=await r.json();role=typeof value==="string"?value:null}
  }catch{}
  if(!role)return{role:null,reason:"kein_leitstand_zugang",userId:user.id};
  return{role,userId:user.id};
}
// --- Was liegt oeffentlich? -------------------------------------------------
// "Repository ist oeffentlich" ist eine Eigenschaft, kein Mangel - und als
// Dauerwarnung wertlos. Der Mangel waere: etwas Geheimes ist oeffentlich
// lesbar. Genau das wird hier geprueft, an der Datei, die die App
// tatsaechlich mitliefert.
//
// Gesucht wird nach Form, nicht nach Inhalt. Ein Fund nennt nur seine Art -
// der gefundene Wert taucht nirgends in der Antwort auf.
function secretFindings(text:string){
  const out:string[]=[];
  if(/sb_secret_/.test(text))out.push("Supabase-Geheimschlüssel");
  if(/service_role/.test(text))out.push("service_role-Schlüssel");
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))out.push("privater Schlüssel");
  if(/[a-z][a-z0-9+.-]*:\/\/[^\s"'\/]+:[^\s"'@\/]+@/i.test(text))out.push("Verbindungszeichenkette mit Passwort");
  for(const jwt of text.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)||[]){
    try{
      const body=JSON.parse(atob(jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
      const role=String(body?.role||"");
      if(role&&role!=="anon")out.push(`JWT mit der Rolle ${role}`);
    }catch{}
  }
  return [...new Set(out)];
}
// Die Adresse wird aus der API-Antwort abgeleitet, nicht fest eingetragen -
// ein umbenanntes Repository oder ein anderer Hauptzweig laeuft weiter.
async function publicConfig(gd:any){
  const repo=gd?.full_name,branch=gd?.default_branch;
  if(!repo||!branch)return{state:"unbekannt",findings:[] as string[]};
  try{
    const r=await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/config/runtime.public.json`,{cache:"no-store"});
    if(r.status===404)return{state:"keine_datei",findings:[] as string[]};
    if(!r.ok)return{state:"unbekannt",findings:[] as string[]};
    return{state:"gelesen",findings:secretFindings(await r.text())};
  }catch{return{state:"unbekannt",findings:[] as string[]}}
}
function repoResult(gh:any,gd:any,cfg:any){
  const id="github",name="GitHub",kind="service";
  if(!gh?.r?.ok)return{id,name,kind,status:"warning",health:78,latency:gh?.ms??null,usage:null,capacityLabel:"GitHub API nicht erreichbar",detail:"GitHub-Prüfung fehlgeschlagen",metrics:{http_status:gh?.r?.status??null,public_config:"ungeprüft",secret_findings:[]}};
  const label=`Repo ${gd?.size??0} KB · ${gd?.visibility??"?"}`;
  const metrics={http_status:gh.r.status,repo_size_kb:gd?.size??null,default_branch:gd?.default_branch??null,visibility:gd?.visibility??null,archived:gd?.archived??null,last_push_at:gd?.pushed_at??null,public_config:cfg.state,secret_findings:cfg.findings};
  // Ein Fund ist eine Stoerung - und zwar unabhaengig davon, ob das
  // Repository oeffentlich ist. Wer ein Geheimnis einchecken kann, checkt es
  // auch in ein privates Repository ein, wo es genauso wenig hingehoert.
  if(cfg.findings.length)return{id,name,kind,status:"critical",health:35,latency:gh.ms,usage:null,capacityLabel:`${cfg.findings.length} Fund(e)`,detail:`Die mitgelieferte Laufzeitkonfiguration enthält: ${cfg.findings.join(" · ")} · Schlüssel drehen und aus der Datei entfernen`,metrics};
  if(gd?.archived)return{id,name,kind,status:"warning",health:88,latency:gh.ms,usage:null,capacityLabel:label,detail:"Repository ist archiviert · es nimmt keine Änderungen mehr an",metrics};
  if(gd?.visibility!=="public")return{id,name,kind,status:"healthy",health:100,latency:gh.ms,usage:null,capacityLabel:label,detail:"Repository ist nicht öffentlich",metrics};
  // Oeffentlich und nichts gefunden: gruen. Ungeprueft ist aber nicht gruen -
  // war die Datei nicht abrufbar, bleibt der Zustand unbekannt.
  if(cfg.state==="unbekannt")return{id,name,kind,status:"unknown",health:null,latency:gh.ms,usage:null,capacityLabel:"Konfiguration nicht lesbar",detail:"Das Repository ist öffentlich, die mitgelieferte Laufzeitkonfiguration war aber nicht abrufbar · ob etwas Geheimes darin steht, ist damit ungeprüft",metrics};
  if(cfg.state==="keine_datei")return{id,name,kind,status:"healthy",health:100,latency:gh.ms,usage:null,capacityLabel:label,detail:"Repository ist öffentlich · es wird keine Laufzeitkonfiguration mitgeliefert",metrics};
  return{id,name,kind,status:"healthy",health:100,latency:gh.ms,usage:null,capacityLabel:label,detail:"Repository ist öffentlich · bewusste Entscheidung; in der mitgelieferten Laufzeitkonfiguration steht nichts Geheimes",metrics};
}
// --- Neon-Spiegeldatenbank direkt pruefen ---------------------------------
// Neon spricht SQL ueber HTTP: POST auf https://<host>/sql, das Geheimnis
// steht im Kopf Neon-Connection-String, nie in der Adresse. Damit braucht es
// keinen Treiber und keine dauerhafte Verbindung - eine Anfrage, eine Antwort.
//
// Der Zugang liegt in der Datenbank (kc_external_credentials) und nicht in den
// Umgebungsvariablen, weil er sich dort ohne neues Deploy austauschen und vor
// allem abschalten laesst. Er darf niemals in der Antwort auftauchen.
async function credential(own:string,service:string,name:string){
  try{
    const r=await fetch(`${own}/rest/v1/rpc/kc_external_credential`,{method:"POST",cache:"no-store",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:JSON.stringify({p_name:name})});
    if(!r.ok)return null;
    return await r.json();
  }catch{return null}
}
async function neonQuery(cred:any){
  const host=String(cred?.endpoint||"");
  if(!host||!cred?.secret)return{ok:false,reason:"kein_zugang",ms:null,data:null,host:null};
  const s=Date.now();
  try{
    const r=await fetch(`https://${host}/sql`,{method:"POST",cache:"no-store",headers:{"Neon-Connection-String":String(cred.secret),"Content-Type":"application/json"},body:JSON.stringify({query:"select db_monitor.report() as bericht",params:[]})});
    const ms=Date.now()-s;
    if(!r.ok){let msg="";try{msg=(await r.json())?.message||""}catch{}return{ok:false,reason:msg||`http_${r.status}`,ms,data:null,host}}
    const body=await r.json();
    let bericht=body?.rows?.[0]?.bericht??null;
    if(typeof bericht==="string"){try{bericht=JSON.parse(bericht)}catch{bericht=null}}
    if(!bericht)return{ok:false,reason:"leere_antwort",ms,data:null,host};
    return{ok:true,reason:null,ms,data:bericht,host};
  }catch(e){return{ok:false,reason:String((e as Error)?.message||e),ms:Date.now()-s,data:null,host}}
}
function neonResult(res:any,fallback:any){
  // Kein Zugang hinterlegt: die vorbereitete Kachel bleibt, wie sie war.
  if(res.reason==="kein_zugang")return fallback;
  const id="neon",name="Neon · Spiegel-Datenbank",kind="database";
  // Nicht erreichbar ist eine Stoerung, keine Unbekannte. Ein Spiegel, den
  // niemand erreicht, erfuellt seinen Zweck nicht - die Entprellung in der
  // Alarmregel faengt einzelne Aussetzer ab.
  if(!res.ok)return{id,name,kind,status:"critical",health:35,latency:res.ms,usage:null,capacityLabel:"Nicht erreichbar",detail:`Neon antwortet nicht auf die Prüfabfrage: ${res.reason}`,metrics:{direct_check:true,host:res.host,error:res.reason}};
  const d=res.data,cap=d.capacity||{},sec=d.security||{},conn=cap.connections||{};
  const bytes=Number(cap.database_bytes||0),u=pct(bytes,NEON_FREE_BYTES);
  const status=["healthy","warning","critical"].includes(d.status)?d.status:"unknown";
  const top=(cap.largest_tables||[])[0];
  const parts:string[]=[];
  if(Array.isArray(d.critical)&&d.critical.length)parts.push(d.critical.join(" · "));
  if(Array.isArray(d.warnings)&&d.warnings.length)parts.push(d.warnings.join(" · "));
  if(!parts.length)parts.push("Keine Befunde");
  parts.push(`${mb(bytes)} MB belegt`);
  if(conn.limit_total)parts.push(`${conn.used}/${conn.limit_total} Verbindungen`);
  if(top)parts.push(`größte Tabelle ${top.table} ${mb(Number(top.bytes||0))} MB`);
  if(Array.isArray(d.notes)&&d.notes.length)parts.push(d.notes.join(" · "));
  return{id,name,kind,status,health:status==="critical"?35:status==="warning"?72:100,latency:res.ms,usage:u,capacityLabel:`${mb(bytes)} / ${mb(NEON_FREE_BYTES)} MB`,detail:parts.join(" · "),metrics:{direct_check:true,host:res.host,database_bytes:bytes,free_tier_database_bytes:NEON_FREE_BYTES,usage_percent:u,connections:conn,largest_tables:cap.largest_tables||[],vacuum_backlog:cap.vacuum_backlog||[],bloat:cap.bloat||[],unused_indexes:cap.unused_indexes||[],tables_without_rls:sec.tables_without_rls||[],client_roles_present:sec.client_roles_present||[],uncovered_grants:sec.uncovered_grants||[],notes:d.notes||[]}};
}
function telemetryState(v:any){const s=String(v||"").toLowerCase();if(["ok","healthy","success","passed"].includes(s))return{status:"healthy",health:100};if(["error","failed","critical","down"].includes(s))return{status:"critical",health:35};if(["warning","degraded","partial"].includes(s))return{status:"warning",health:72};return{status:"unknown",health:null}}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});if(req.method!=="GET")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:CORS});const started=Date.now(),u=new URL(req.url),own=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;try{if(u.searchParams.get("probe")==="1")return new Response(JSON.stringify({probe:true}),{headers:CORS});if(u.searchParams.get("leitstand")==="1"){const who=await callerRole(req,own,service);if(!who.role)return new Response(JSON.stringify({error:"leitstand_gesperrt",reason:who.reason,hint:"Anmeldung mit einem in kc_system_check_operators freigeschalteten Konto erforderlich."}),{status:403,headers:CORS});const data=await leitstand(own);if(who.role!=="superadmin"){data.sales=[];data.sales_hidden=true}data.viewer={role:who.role};return new Response(JSON.stringify(data),{headers:CORS});}if(u.searchParams.get("history")==="1")return new Response(JSON.stringify({version:"0.4.0-live",history:await history(own),usage:await usage(own)}),{headers:CORS});const H={apikey:service,Authorization:`Bearer ${service}`};let requests=5;const coreP=timed(`${own}/rest/v1/kc_system_check_history?select=checked_at&order=checked_at.desc&limit=1`,{headers:H}).catch(()=>null),snapP=timed(`${own}/rest/v1/rpc/kc_system_check_snapshot`,{method:"POST",headers:{...H,"Content-Type":"application/json"},body:"{}"}).catch(()=>null),futureP=timed(`${FUTURE_URL}/rest/v1/rpc/kc_system_check_public_snapshot`,{method:"POST",headers:{apikey:FUTURE_KEY,Authorization:`Bearer ${FUTURE_KEY}`,"Content-Type":"application/json"},body:"{}"}).catch(()=>null),gitP=timed(GITHUB_REPO,{headers:{Accept:"application/vnd.github+json","User-Agent":"KC-System-Check"}}).catch(()=>null),teleP=timed(`${own}/rest/v1/kc_backup_machine_telemetry?select=measured_at,updated_at,last_backup_at,last_backup_status,last_backup_stored_bytes,storage_target,b2_status,neon_status,status&order=measured_at.desc&limit=1`,{headers:H}).catch(()=>null);const [core,sr,fr,gh,teleReq]=await Promise.all([coreP,snapP,futureP,gitP,teleP]);if(!sr?.r?.ok)throw new Error(`snapshot_http_${sr?.r?.status??"network"}`);const snap=await sr.r.json(),mh=mirrorHealth(snap),coreBytes=Number(snap?.database_bytes??0);let fd:any={},gd:any={},tele:any=null;if(fr?.r?.ok)try{fd=await fr.r.json()}catch{}if(gh?.r?.ok)try{gd=await gh.r.json()}catch{}if(teleReq?.r?.ok)try{tele=(await teleReq.r.json())?.[0]||null}catch{}const [neonDirect,b2Direct,r2Direct,ociDirect,repoConfig]=await Promise.all([optionalEndpoint("NEON"),optionalEndpoint("B2"),optionalEndpoint("R2"),optionalEndpoint("OCI"),publicConfig(gd)]);requests++;for(const x of[neonDirect,b2Direct,r2Direct,ociDirect])if(x)requests++;const futureBytes=Number(fd?.database_bytes??0),cu=pct(coreBytes,FREE_DB_BYTES),fu=pct(futureBytes,FREE_DB_BYTES),coreOk=!!core?.r?.ok,coreMs=core?.ms??null,coreStatus=coreOk?(coreMs!==null&&coreMs>3000?"warning":"healthy"):"critical",coreHealth=coreOk?(coreMs!==null&&coreMs>3000?82:coreMs!==null&&coreMs>1500?90:100):35;
let neon=endpointResult("neon","Neon · Direktcheck","database",neonDirect,"Direktcheck vorbereitet; die Supabase→Neon-Spiegelung wird separat geprüft");if(!neonDirect&&tele?.neon_status){const t=telemetryState(tele.neon_status);neon={...neon,status:t.status,health:t.health,capacityLabel:"PC Backup Vault Telemetrie",detail:`Neon-Telemetrie: ${tele.neon_status}`,metrics:{direct_check:false,telemetry:true,measured_at:tele.measured_at}}}
// Liegt ein Zugang zur Spiegeldatenbank bereit, wird sie selbst befragt statt
// nur ueber Dritte beurteilt. Ohne Zugang bleibt die bisherige Kachel stehen.
const neonCred=await credential(own,service,"neon_mirror");if(neonCred){const nq=await neonQuery(neonCred);requests++;neon=neonResult(nq,neon)}
let b2=endpointResult("b2","Backblaze B2","storage",b2Direct,"Adapter bereit; noch keine B2-Telemetrie oder sichere Read-only-Verbindung");if(!b2Direct&&tele?.b2_status){const t=telemetryState(tele.b2_status),age=tele.measured_at?Math.round((Date.now()-Date.parse(tele.measured_at))/60000):null;b2={...b2,status:t.status,health:t.health,capacityLabel:tele.last_backup_stored_bytes?`${mb(Number(tele.last_backup_stored_bytes))} MB letzter Backup-Satz`:"PC Backup Vault Telemetrie",detail:`B2 ${tele.b2_status} · letzter Backup-Status ${tele.last_backup_status||"unbekannt"}${age!==null?` · Telemetrie vor ${age} min`:""}`,metrics:{direct_check:false,telemetry:true,measured_at:tele.measured_at,last_backup_at:tele.last_backup_at,last_backup_status:tele.last_backup_status,last_backup_stored_bytes:tele.last_backup_stored_bytes,storage_target:tele.storage_target}}}
const r2=endpointResult("r2","Cloudflare R2","storage",r2Direct,"Als Backup-/Failback-Anbieter vorbereitet; Scharfstellung nach Zugangseinrichtung"),oci=endpointResult("oci","Oracle OCI Object Storage","storage",ociDirect,"Als Reserve-Anbieter vorbereitet; Scharfstellung nach Zugangseinrichtung");
const [securityRes,capacityRes,exposure]=await Promise.all([rpc(own,service,"kc_system_check_security_audit"),rpc(own,service,"kc_system_check_db_capacity"),exposureResult(own)]);requests+=4;const dbSecurity=securityResult(securityRes),dbCapacity=capacityResult(capacityRes),keyLifetime=keyLifetimeResult();
const all:any[]=[{id:"kc_core",name:"KC Core · Supabase",kind:"database",status:coreStatus,health:coreHealth,latency:coreMs,usage:cu,capacityLabel:`${mb(coreBytes)} / 500 MB`,detail:coreOk?(coreMs!==null&&coreMs>3000?"Erreichbar, aber langsam":"KC Core erreichbar"):"KC Core nicht erreichbar",metrics:{database_bytes:coreBytes,free_tier_database_bytes:FREE_DB_BYTES,usage_percent:cu,latency_ms:coreMs,snapshot_latency_ms:sr.ms,probe_http_status:core?.r?.status??null}},{id:"future_academy",name:"Future Academy · Supabase",kind:"database",status:fr?.r?.ok?(fr.ms>3000?"warning":"healthy"):"warning",health:fr?.r?.ok?(fr.ms>3000?82:100):75,latency:fr?.ms??null,usage:fr?.r?.ok?fu:null,capacityLabel:fr?.r?.ok?`${mb(futureBytes)} / 500 MB`:"Kapazität nicht verfügbar",detail:fr?.r?.ok?"Future Academy erreichbar":"Future Academy nicht erreichbar",metrics:{database_bytes:futureBytes||null,public_tables:fd?.public_tables??null,http_status:fr?.r?.status??null,usage_percent:fr?.r?.ok?fu:null,latency_ms:fr?.ms??null}},{id:"mirror",name:"Spiegelung · Supabase → Neon",kind:"replication",status:mh.status,health:mh.health,latency:null,usage:null,capacityLabel:`${snap?.runs_24h??0} Läufe / 24 h`,detail:mh.status==="healthy"?`${snap?.mirror?.mismatch_count??0} Abweichungen · letzter Lauf vor ${mh.age_min??"?"} min`:mh.status==="warning"?"Spiegelung mit Warnhinweis":mh.status==="unknown"?"Noch kein Spiegellauf erfasst · Zustand unbekannt":"Aktive Spiegelabweichung oder Fehler",metrics:{...snap?.mirror,age_min:mh.age_min,runs_24h:snap?.runs_24h,non_ok_24h:snap?.non_ok_24h,mismatches_24h:snap?.mismatches_24h,snapshot_latency_ms:sr.ms}},neon,repoResult(gh,gd,repoConfig),b2,r2,oci,dbSecurity,dbCapacity,exposure,keyLifetime];const aliases:any={supabase:["kc_core","future_academy"],sicherheit:["db_security","endpoint_exposure","key_lifetime"]},raw=u.searchParams.get("systems")?.split(",").filter(Boolean)||[],wanted=[...new Set(raw.flatMap(x=>aliases[x]||[x]))],results=wanted.length?all.filter(x=>wanted.includes(x.id)):all,status=worst(results),h=health(results),coverage=Math.round(results.filter(x=>["healthy","warning","critical"].includes(x.status)).length/Math.max(1,results.length)*100),duration=Date.now()-started,payload:any={version:"0.4.0-live",status,health:h,coverage,checkedAt:new Date().toISOString(),duration_ms:duration,capacity:{kc_core_database_bytes:coreBytes,future_academy_database_bytes:futureBytes||null,free_database_bytes:FREE_DB_BYTES},resource_usage:{request_count:requests,estimated:true},provider_registry:{source:"PC Backup Vault",prepared:["b2","r2","oci"],no_test_uploads:true},results};const bytes=enc.encode(JSON.stringify(payload)).byteLength;payload.resource_usage.response_bytes=bytes;let recorded=false;if(u.searchParams.get("record")!=="0"){const who=await callerRole(req,own,service);let allowed=!!who.role;if(!allowed){let lastAt:any=null;try{const rows=await core?.r?.json();lastAt=rows?.[0]?.checked_at??null}catch{}const age=lastAt?Date.now()-Date.parse(lastAt):Number.POSITIVE_INFINITY;allowed=!(Number.isFinite(age)&&age<10*60*1000)}if(allowed){recorded=true;const trigger=["auto","selected"].includes(u.searchParams.get("trigger")||"")?u.searchParams.get("trigger"):"manual";await fetch(`${own}/rest/v1/kc_system_check_history`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify({trigger_type:trigger,overall_status:status,health:h,duration_ms:duration,request_count:requests,response_bytes:bytes,results})}).catch(()=>null)}}payload.recorded=recorded;return new Response(JSON.stringify(payload),{headers:CORS})}catch(e){return new Response(JSON.stringify({version:"0.4.0-live",status:"critical",health:0,checkedAt:new Date().toISOString(),error:String((e as Error)?.message||e)}),{status:500,headers:CORS})}});
