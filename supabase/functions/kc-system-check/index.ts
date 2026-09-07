import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FREE_DB_BYTES=500*1024*1024,NEON_FREE_BYTES=512*1024*1024,enc=new TextEncoder();
const pct=(n:number,d:number)=>d>0?Math.round(n/d*1000)/10:null,mb=(n:number)=>Math.round(n/1024/1024*10)/10;
async function timed(url:string,init:RequestInit={}){const s=Date.now(),r=await fetch(url,{...init,cache:"no-store"});return{r,ms:Date.now()-s}}
// Die Farbe folgt dem JETZIGEN Zustand, nicht der Vorgeschichte.
//
// Vorher zaehlte jeder nicht fehlerfreie Lauf der letzten 24 Stunden: ein
// einziger Ausrutscher hielt die Kachel einen Tag lang gelb, auch wenn der
// naechste Lauf laengst wieder sauber war. Eine Kachel, die aus Gewohnheit
// gelb steht, verdeckt den Tag darauf einen echten Befund.
//
// Massgeblich ist jetzt, ob GERADE eine Tabelle haengt (veraltete_tabellen aus
// der Momentaufnahme). Behobene Befunde bleiben als Zahl im Text stehen.
function mirrorHealth(s:any){const m=s?.mirror??{},age=m.finished_at?Math.round((Date.now()-new Date(m.finished_at).getTime())/60000):null,mis=Number(m.mismatch_count??0),offen=Array.isArray(s?.last_issue?.veraltete_tabellen)?s.last_issue.veraltete_tabellen.length:0;if(!m||Object.keys(m).length===0)return{status:"unknown",health:null,age_min:null,open_tables:0};let status="healthy",health=100;if(age===null||age>180){status="warning";health=72}if(mis>0||m.status!=="ok"){status="critical";health=35}else if(offen>0){status="warning";health=Math.min(health,88)}return{status,health,age_min:age,open_tables:offen}}
const worst=(a:any[])=>a.some(x=>x.status==="critical")?"critical":a.some(x=>x.status==="warning")?"warning":a.some(x=>x.status==="healthy")?"healthy":"unknown";
const health=(a:any[])=>{const x=a.filter(v=>["healthy","warning","critical"].includes(v.status)&&Number.isFinite(v.health));return x.length?Math.round(x.reduce((s,v)=>s+v.health,0)/x.length):null};
async function history(url:string){const k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,r=await fetch(`${url}/rest/v1/kc_system_check_history?select=checked_at,trigger_type,overall_status,health,duration_ms,request_count,response_bytes,results&order=checked_at.desc&limit=40`,{headers:{apikey:k,Authorization:`Bearer ${k}`}});return r.ok?await r.json():[]}
// Der Verbrauch wird in der Datenbank gezaehlt, nicht aus der Verlaufsliste
// abgeleitet. Die holt seit jeher nur die letzten 40 Laeufe - jede
// Verbrauchsangabe war damit bei 40 gedeckelt, waehrend es in 31 Tagen 464
// waren. Eine Verbrauchsanzeige darf sich nicht nach unten irren.
async function usage(url:string){
  const k=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try{
    const r=await fetch(`${url}/rest/v1/rpc/kc_system_check_usage`,{method:"POST",cache:"no-store",headers:{apikey:k,Authorization:`Bearer ${k}`,"Content-Type":"application/json"},body:"{}"});
    if(r.ok){const d=await r.json();if(d&&typeof d==="object")return d}
  }catch{}
  // Faellt die Zaehlung aus, wird nichts erfunden - lieber keine Zahl als eine zu kleine.
  return{runs_31d:null,auto_31d:null,manual_31d:null,requests_31d:null,response_bytes_31d:null,non_green_31d:null,counted_in_database:false};
}
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
  // Kein Repository hinterlegt: nichts behaupten, auf nichts Fremdes zeigen.
  if(!gh)return{id,name,kind,status:"not_configured",health:null,latency:null,usage:null,capacityLabel:"Kein Repository hinterlegt",detail:"Ohne Eintrag github_repo in kc_external_credentials wird kein Repository geprüft",metrics:{}};
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
// Ein zweites Supabase-Projekt ist optional. Ist keins hinterlegt, wird auch
// keins geprueft - und schon gar nicht das eines Fremden.
function secondProjectResult(cfg:any,fr:any,fd:any){
  const id="future_academy",name=cfg?.label||"Zweites Supabase-Projekt",kind="database";
  if(!cfg?.endpoint)return{id,name,kind,status:"not_configured",health:null,latency:null,usage:null,capacityLabel:"Kein zweites Projekt hinterlegt",detail:"Ohne Eintrag future_academy in kc_external_credentials wird kein zweites Projekt geprüft",metrics:{}};
  const ok=!!fr?.r?.ok,bytes=Number(fd?.database_bytes??0),u=pct(bytes,FREE_DB_BYTES);
  return{id,name,kind,status:ok?(fr.ms>3000?"warning":"healthy"):"warning",health:ok?(fr.ms>3000?82:100):75,latency:fr?.ms??null,usage:ok?u:null,
    capacityLabel:ok?`${mb(bytes)} / ${mb(FREE_DB_BYTES)} MB`:"Kapazität nicht verfügbar",
    detail:ok?`${name} erreichbar`:`${name} nicht erreichbar`,
    metrics:{database_bytes:bytes||null,public_tables:fd?.public_tables??null,http_status:fr?.r?.status??null,usage_percent:ok?u:null,latency_ms:fr?.ms??null}};
}
// Ein Warnhinweis, der nicht sagt, worueber er warnt, kostet genau die Zeit,
// die eine Ueberwachung sparen soll. Der Grund steht in kc_db_mirror_runs und
// kommt seit Migration 202609060020 in der Momentaufnahme mit.
function mirrorDetail(mh:any,snap:any,snapFehlt:boolean){
  if(mh.status==="not_configured")return "Keine Spiegelung eingerichtet · die Momentaufnahme-Funktion fehlt in dieser Umgebung";
  if(mh.status==="unknown")return snapFehlt?"Momentaufnahme nicht abrufbar · Zustand der Spiegelung unbekannt":"Noch kein Spiegellauf erfasst · Zustand unbekannt";
  const issue=snap?.last_issue,teile:string[]=[];
  if(mh.status==="healthy"){
    teile.push(`${snap?.mirror?.mismatch_count??0} Abweichungen · letzter Lauf vor ${mh.age_min??"?"} min`);
    // Behoben ist nicht ungeschehen: die Zahl bleibt sichtbar, faerbt aber nicht.
    const alt=Number(snap?.non_ok_24h??0);
    if(alt>0)teile.push(`${alt} behobene(r) Befund(e) in 24 h`);
  }
  else if(issue?.tabelle||issue?.message){
    // Tabelle und Meldung des betroffenen Laufs, nicht bloss "Warnhinweis".
    // Laeufe ueber den Gesamtzustand tragen keine Tabelle; dann steht die
    // Meldung allein da, statt einer erfundenen "unbenannten Tabelle".
    const text=issue.message||issue.status;
    teile.push(issue.tabelle?`${issue.tabelle}: ${text}`:text);
    // "47 von 48 frisch" ist eine Zahl, keine Antwort. Seit Migration
    // 202609060021 liefert die Momentaufnahme die fehlenden Namen mit.
    const offen=Array.isArray(issue.veraltete_tabellen)?issue.veraltete_tabellen:[];
    if(!issue.tabelle&&offen.length)teile.push(`betroffen: ${offen.map((t:any)=>t.tabelle).filter(Boolean).join(", ")}`);
    const alt=issue.started_at?Math.round((Date.now()-Date.parse(issue.started_at))/60000):null;
    if(alt!==null)teile.push(`vor ${alt} min`);
    teile.push(`letzter Lauf danach vor ${mh.age_min??"?"} min`);
  }else if(mh.age_min===null||mh.age_min>180)teile.push(`Seit ${mh.age_min??"unbekannt vielen"} min kein Spiegellauf`);
  else teile.push(mh.status==="critical"?"Aktive Spiegelabweichung oder Fehler":"Spiegelung mit Warnhinweis");
  return teile.join(" · ");
}
// --- Lebenszeichen der Programme --------------------------------------------
// Was ein Lebenszeichen belegt: "war um 08:23 in Benutzung". Was es NICHT
// belegt: dass ein Dienst laeuft. Die vorhandenen kommen aus dem Browser, also
// nur wenn jemand die Anwendung offen hat. Ein Ausbleiben ist deshalb erst
// dann ein Befund, wenn jemand ausdruecklich entschieden hat, dass sich dieses
// Programm in einem Zeitfenster melden MUSS (heartbeat_expected).
//
// Solange kein einziges Programm so scharfgestellt ist, meldet die Kachel
// "nicht eingerichtet" - und faellt damit aus der Abdeckung heraus, statt eine
// Zahl zu beschoenigen, hinter der zwoelf ungeprueft Anwendungen stehen.
// Ein selbst gemeldeter Zaehler gilt fuer den Zeitpunkt seiner Meldung, nicht
// fuer jetzt. Ohne das Alter liest sich "meldet 3 Fehler" als Gegenwart - auch
// wenn die Browser-Sitzung, die das gezaehlt hat, seit Stunden vorbei ist.
function seit(m:any){const n=Number(m);if(!Number.isFinite(n))return "Alter unbekannt";
  if(n<90)return `zuletzt vor ${n} min`;
  if(n<2880)return `zuletzt vor ${Math.round(n/60)} h`;
  return `zuletzt vor ${Math.round(n/1440)} Tagen`;}
function programResult(res:any){
  const id="programs",name="Programme · Lebenszeichen",kind="service";
  if(!res.ok)return notDeployed(id,name,kind,res.status);
  const d=res.data||{};
  const gesamt=Number(d.anwendungen_gesamt||0),angebunden=Number(d.angebunden||0),ueberwacht=Number(d.ueberwacht||0);
  const ueberfaellig=d.ueberfaellig||[],stoerung=d.meldet_stoerung||[],ohne=d.ohne_anbindung||[];
  const label=`${angebunden}/${gesamt} angebunden`;
  const metrics={total:gesamt,connected:angebunden,watched:ueberwacht,reported_24h:Number(d.gemeldet_24h||0),
    without_heartbeat:ohne,overdue:ueberfaellig,reporting_trouble:stoerung,recent:d.zuletzt||[],unregistered:d.nicht_registriert||[]};
  const teile:string[]=[];
  // Ein selbst gemeldeter Fehler zaehlt IMMER - auch wenn niemand dieses
  // Programm scharfgestellt hat. Die Scharfstellung regelt nur, ob SCHWEIGEN
  // ein Befund ist; ein Programm, das von sich aus Fehler meldet, hat
  // gesprochen.
  if(stoerung.length)teile.push(`${stoerung.length} meldet Fehler: ${stoerung.slice(0,3).map((x:any)=>`${x.name} (${x.fehler}, ${seit(x.alter_minuten)})`).join(", ")}`);
  if(ueberwacht===0){
    if(!stoerung.length)teile.push(`${angebunden} von ${gesamt} Anwendungen senden Lebenszeichen, keine davon ist als Pflicht scharfgestellt`);
    if(ohne.length)teile.push(`${ohne.length} ohne Anbindung: ${ohne.slice(0,4).join(", ")}${ohne.length>4?" …":""}`);
    // Ohne Scharfstellung ist Schweigen kein Befund - die Kachel faellt aus der
    // Abdeckung heraus, statt eine Zahl zu beschoenigen. Ein gemeldeter Fehler
    // hebt sie aber sehr wohl auf Gelb.
    if(!stoerung.length)return{id,name,kind,status:"not_configured",health:null,latency:res.ms,usage:null,capacityLabel:label,detail:teile.join(" · "),metrics};
    return{id,name,kind,status:"warning",health:72,latency:res.ms,usage:null,capacityLabel:label,detail:teile.join(" · "),metrics};
  }
  if(ueberfaellig.length)teile.push(`${ueberfaellig.length} überfällig: ${ueberfaellig.slice(0,3).map((x:any)=>`${x.name} (${x.alter_minuten??"nie"} min)`).join(", ")}`);
  if(!teile.length)teile.push(`${ueberwacht} überwachte Anwendung(en) melden sich pünktlich`);
  if(ohne.length)teile.push(`${ohne.length} noch ohne Anbindung`);
  // Ein gemeldeter Fehler ist eine Warnung, kein Ausfall: der Zaehler ist
  // selbst gemeldet und heisst in jedem Programm etwas anderes.
  const status=stoerung.length||ueberfaellig.length?"warning":"healthy";
  return{id,name,kind,status,health:status==="critical"?35:status==="warning"?72:100,latency:res.ms,usage:null,capacityLabel:label,detail:teile.join(" · "),metrics};
}
// --- Neon-Spiegeldatenbank direkt pruefen ---------------------------------
// Neon spricht SQL ueber HTTP: POST auf https://<host>/sql, das Geheimnis
// steht im Kopf Neon-Connection-String, nie in der Adresse. Damit braucht es
// keinen Treiber und keine dauerhafte Verbindung - eine Anfrage, eine Antwort.
//
// Der Zugang liegt in der Datenbank (kc_external_credentials) und nicht in den
// Umgebungsvariablen, weil er sich dort ohne neues Deploy austauschen und vor
// allem abschalten laesst. Er darf niemals in der Antwort auftauchen.
// Alle Zugaenge in einem Aufruf. Sie liegen in der Datenbank und nicht im
// Quelltext - wer das Programm uebernimmt, traegt seine eigenen ein, statt den
// Quelltext zu aendern. Fehlt ein Eintrag, meldet die zugehoerige Kachel
// "nicht eingerichtet" statt auf eine fremde Adresse zu zeigen.
async function credentials(own:string,service:string){
  try{
    const r=await fetch(`${own}/rest/v1/rpc/kc_external_credentials`,{method:"POST",cache:"no-store",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},body:"{}"});
    if(!r.ok)return{};
    return await r.json()||{};
  }catch{return{}}
}
async function neonSql(cred:any,query:string,feld:string){
  const host=String(cred?.endpoint||"");
  if(!host||!cred?.secret)return{ok:false,reason:"kein_zugang",ms:null,data:null,host:null};
  const s=Date.now();
  try{
    const r=await fetch(`https://${host}/sql`,{method:"POST",cache:"no-store",headers:{"Neon-Connection-String":String(cred.secret),"Content-Type":"application/json"},body:JSON.stringify({query,params:[]})});
    const ms=Date.now()-s;
    if(!r.ok){let msg="";try{msg=(await r.json())?.message||""}catch{}return{ok:false,reason:msg||`http_${r.status}`,ms,data:null,host}}
    const body=await r.json();
    let wert=body?.rows?.[0]?.[feld]??null;
    if(typeof wert==="string"){try{wert=JSON.parse(wert)}catch{wert=null}}
    if(!wert)return{ok:false,reason:"leere_antwort",ms,data:null,host};
    return{ok:true,reason:null,ms,data:wert,host};
  }catch(e){return{ok:false,reason:String((e as Error)?.message||e),ms:Date.now()-s,data:null,host}}
}
const neonQuery=(cred:any)=>neonSql(cred,"select db_monitor.report() as bericht","bericht");
// --- Sicherung ---------------------------------------------------------------
// Die taegliche Sicherung liegt in derselben Neon-Datenbank wie die Spiegelung,
// aber sie ist etwas anderes: die Spiegelung haelt den aktuellen Stand, die
// Sicherung haelt den Stand von gestern und laesst sich zurueckspielen.
//
// Getrennt gefragt statt an db_monitor angehaengt: db_monitor ist das tragbare
// Paket und darf nichts von KC wissen. Faellt diese Abfrage aus, betrifft das
// nur diese Kachel.
const BACKUP_SQL=`
with letzter as (
  select * from public.kc_backup_sets where status='ok' order by completed_at desc nulls last limit 1
), neuester as (
  select * from public.kc_backup_sets order by started_at desc limit 1
), pruefung as (
  select * from public.kc_backup_verifications order by verified_at desc limit 1
)
select jsonb_build_object(
  'letzter_ok_am', (select completed_at from letzter),
  'letzter_ok_alter_stunden', (select round(extract(epoch from now()-completed_at)/3600, 1) from letzter),
  'tabellen', (select table_count from letzter),
  'tabellen_ok', (select ok_count from letzter),
  'zeilen', (select total_rows from letzter),
  'bytes', (select total_bytes from letzter),
  'neuester_status', (select status from neuester),
  'pruefung_status', (select status from pruefung),
  'pruefung_alter_stunden', (select round(extract(epoch from now()-verified_at)/3600, 1) from pruefung),
  'pruefung_tabellen', (select checked_tables from pruefung),
  'pruefung_fehler', (select failed_tables from pruefung),
  -- Haengend heisst: koennte noch laufen und tut es nicht. Ein 'running' von
  -- vor neun Tagen ist kein laufendes Problem, sondern ein Ueberbleibsel -
  -- das faerbt die Ampel nicht, sonst steht sie fuer immer gelb.
  'haengende_saetze', (select count(*) from public.kc_backup_sets
     where status='running' and started_at < now() - interval '2 hours'
       and started_at > now() - interval '48 hours'),
  'altlasten', (select count(*) from public.kc_backup_sets
     where status in ('running','error') and started_at < now() - interval '48 hours'),
  'saetze_8_tage', (select count(*) from public.kc_backup_sets where status='ok' and started_at > now() - interval '8 days')
) as sicherung`;
const backupQuery=(cred:any)=>neonSql(cred,BACKUP_SQL,"sicherung");
// Eine Sicherung ist erst dann eine Sicherung, wenn sie frisch ist UND geprueft.
// Beides getrennt bewertet: ein frischer, aber ungepruefter Satz ist kein
// Ausfall, aber auch keine Zusage.
function backupResult(res:any){
  const id="backup",name="Sicherung · täglich nach Neon",kind="backup";
  if(res.reason==="kein_zugang")return{id,name,kind,status:"not_configured",health:null,latency:null,usage:null,capacityLabel:"Kein Zugang hinterlegt",detail:"Ohne Zugang zur Spiegeldatenbank ist der Zustand der Sicherung nicht abrufbar",metrics:{}};
  if(!res.ok)return{id,name,kind,status:"unknown",health:null,latency:res.ms,usage:null,capacityLabel:"Nicht prüfbar",detail:`Der Zustand der Sicherung war nicht abrufbar: ${res.reason}`,metrics:{error:res.reason}};
  const d=res.data||{};
  const alter=d.letzter_ok_alter_stunden===null||d.letzter_ok_alter_stunden===undefined?null:Number(d.letzter_ok_alter_stunden);
  const pAlter=d.pruefung_alter_stunden===null||d.pruefung_alter_stunden===undefined?null:Number(d.pruefung_alter_stunden);
  const fehler=Number(d.pruefung_fehler??0),haengend=Number(d.haengende_saetze??0);
  const kritisch:string[]=[],warnungen:string[]=[];
  if(alter===null)kritisch.push("Es gibt keine erfolgreiche Sicherung");
  else if(alter>48)kritisch.push(`Die letzte erfolgreiche Sicherung ist ${alter} h alt`);
  else if(alter>26)warnungen.push(`Die letzte Sicherung ist ${alter} h alt · täglich erwartet`);
  if(d.pruefung_status&&d.pruefung_status!=="ok")kritisch.push(`Die Prüfung meldet ${d.pruefung_status}`);
  if(fehler>0)kritisch.push(`${fehler} Tabelle(n) haben die Prüfung nicht bestanden`);
  if(!d.pruefung_status)warnungen.push("Die Sicherung wurde noch nie geprüft");
  else if(pAlter!==null&&pAlter>48)warnungen.push(`Die letzte Prüfung ist ${pAlter} h alt`);
  if(haengend>0)warnungen.push(`${haengend} Sicherungslauf/-läufe hängen seit über zwei Stunden`);
  if(d.neuester_status==="error"&&!kritisch.length)warnungen.push("Der jüngste Versuch ist fehlgeschlagen, ein älterer Satz ist aber gültig");
  // Alte, nie abgeschlossene Saetze sind Datenmuell, kein Vorfall - sie stehen
  // im Text, faerben aber nichts.
  const altlasten=Number(d.altlasten??0);
  const status=kritisch.length?"critical":warnungen.length?"warning":"healthy";
  const teile=[...kritisch,...warnungen];
  if(!teile.length)teile.push(`vor ${alter} h gesichert und geprüft · ${d.tabellen_ok}/${d.tabellen} Tabellen, ${d.zeilen} Zeilen`);
  else if(alter!==null)teile.push(`${d.tabellen_ok}/${d.tabellen} Tabellen im letzten gültigen Satz`);
  if(d.saetze_8_tage!==null&&d.saetze_8_tage!==undefined)teile.push(`${d.saetze_8_tage} Sätze in acht Tagen`);
  if(altlasten>0)teile.push(`${altlasten} alte(r) Satz/Sätze ohne Abschluss · Datenrest, kein Vorfall`);
  return{id,name,kind,status,health:status==="critical"?35:status==="warning"?72:100,latency:res.ms,usage:null,
    capacityLabel:alter===null?"Keine Sicherung":`vor ${alter} h · ${mb(Number(d.bytes||0))} MB`,
    detail:teile.join(" · "),
    metrics:{last_ok_at:d.letzter_ok_am,age_hours:alter,tables:d.tabellen,tables_ok:d.tabellen_ok,rows:d.zeilen,bytes:d.bytes,
      verification_status:d.pruefung_status,verification_age_hours:pAlter,verification_tables:d.pruefung_tabellen,
      verification_failed:fehler,stuck_runs:haengend,stale_sets:altlasten,sets_8d:d.saetze_8_tage,newest_status:d.neuester_status}};
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

const RANG:any={healthy:0,unknown:0,not_configured:0,warning:1,critical:2};
function schlechter(a:string,b:string){return (RANG[b]??0)>(RANG[a]??0)?b:a}
function stunden(iso:any){if(!iso)return null;const t=Date.parse(String(iso));return Number.isFinite(t)?Math.max(0,(Date.now()-t)/3600000):null}
function tageText(h:number){return h<48?`${Math.round(h)} h`:`${Math.round(h/24)} Tagen`}
// Schwellen: Backup aelter als 2 Tage gelb, 7 Tage rot; Telemetrie aelter als 36 h gelb;
// gekoppelte Maschine ohne jede Telemetrie gelb, ohne Lebenszeichen seit 7 Tagen rot.
const BACKUP_GELB_H=48,BACKUP_ROT_H=7*24,TELE_GELB_H=36,MASCH_ROT_H=7*24;
function backupAgeRules(b2:any,tele:any,masch:any){
  const befunde:string[]=[];let status=b2.status,health=b2.health;
  const bAge=stunden(tele?.last_backup_at),tAge=stunden(tele?.measured_at),mAge=stunden(masch?.last_seen_at);
  if(tele){
    if(bAge!==null&&bAge>BACKUP_ROT_H){status=schlechter(status,"critical");health=Math.min(health??100,35);befunde.push(`letztes Backup vor ${tageText(bAge)}`)}
    else if(bAge!==null&&bAge>BACKUP_GELB_H){status=schlechter(status,"warning");health=Math.min(health??100,72);befunde.push(`letztes Backup vor ${tageText(bAge)}`)}
    if(tAge!==null&&tAge>TELE_GELB_H){status=schlechter(status,"warning");health=Math.min(health??100,72);befunde.push(`Telemetrie vor ${tageText(tAge)} · Backup-App laeuft vermutlich nicht`)}
  }else if(masch){
    // gekoppelt, aber noch nie Telemetrie: das ist kein "nicht eingerichtet" mehr
    if(mAge!==null&&mAge>MASCH_ROT_H){status="critical";health=35}else{status="warning";health=72}
    befunde.push(`${masch.device_name||"PC Backup Vault"} ist gekoppelt${masch.approved_at?` (seit ${String(masch.approved_at).slice(0,10)})`:""}, hat aber noch nie Telemetrie geliefert`);
    if(mAge!==null)befunde.push(`zuletzt gesehen vor ${tageText(mAge)}`);
    befunde.push("Backup-Alter unbekannt · Backup-App starten oder aktualisieren");
  }
  if(!befunde.length)return b2;
  return{...b2,status,health,capacityLabel:tele?b2.capacityLabel:"Gekoppelt · keine Telemetrie",detail:(tele?`${b2.detail} · `:"")+befunde.join(" · "),metrics:{...b2.metrics,backup_age_hours:bAge===null?null:Math.round(bAge),telemetry_age_hours:tAge===null?null:Math.round(tAge),machine_last_seen_at:masch?.last_seen_at??null,machine_paired:!!masch}};
}
Deno.serve(async(req:Request)=>{if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});if(req.method!=="GET")return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers:CORS});const started=Date.now(),u=new URL(req.url),own=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;try{if(u.searchParams.get("probe")==="1")return new Response(JSON.stringify({probe:true}),{headers:CORS});if(u.searchParams.get("leitstand")==="1"){const who=await callerRole(req,own,service);if(!who.role)return new Response(JSON.stringify({error:"leitstand_gesperrt",reason:who.reason,hint:"Anmeldung mit einem in kc_system_check_operators freigeschalteten Konto erforderlich."}),{status:403,headers:CORS});const data=await leitstand(own);if(who.role!=="superadmin"){data.sales=[];data.sales_hidden=true}data.viewer={role:who.role};return new Response(JSON.stringify(data),{headers:CORS});}if(u.searchParams.get("history")==="1")return new Response(JSON.stringify({version:"0.4.0-live",history:await history(own),usage:await usage(own)}),{headers:CORS});const H={apikey:service,Authorization:`Bearer ${service}`};let requests=5;const zugaenge:any=await credentials(own,service);requests++;const gitCfg=zugaenge.github_repo,futureCfg=zugaenge.future_academy;const coreP=timed(`${own}/rest/v1/kc_system_check_history?select=checked_at&order=checked_at.desc&limit=1`,{headers:H}).catch(()=>null),snapP=timed(`${own}/rest/v1/rpc/kc_system_check_snapshot`,{method:"POST",headers:{...H,"Content-Type":"application/json"},body:"{}"}).catch(()=>null),futureP=futureCfg?.endpoint?timed(`${futureCfg.endpoint}/rest/v1/rpc/kc_system_check_public_snapshot`,{method:"POST",headers:{apikey:futureCfg.secret,Authorization:`Bearer ${futureCfg.secret}`,"Content-Type":"application/json"},body:"{}"}).catch(()=>null):Promise.resolve(null),gitP=gitCfg?.endpoint?timed(gitCfg.endpoint,{headers:{Accept:"application/vnd.github+json","User-Agent":"KC-System-Check",...(gitCfg.secret?{Authorization:`Bearer ${gitCfg.secret}`}:{})}}).catch(()=>null):Promise.resolve(null),teleP=timed(`${own}/rest/v1/kc_backup_machine_telemetry?select=measured_at,updated_at,last_backup_at,last_backup_status,last_backup_stored_bytes,storage_target,b2_status,neon_status,status&order=measured_at.desc&limit=1`,{headers:H}).catch(()=>null),kiccP=timed(`${own}/rest/v1/kicc_backup_telemetry?select=measured_at,updated_at,last_backup_at,last_backup_status,last_backup_bytes,backup_target,integrity_status,last_verify_result,last_restore_test_result,status,app_version&order=measured_at.desc&limit=1`,{headers:H}).catch(()=>null),maschP=timed(`${own}/rest/v1/kc_communication_machine_clients?select=device_name,status,approved_at,last_seen_at&source_program=eq.pc-backup-vault&status=eq.active&order=last_seen_at.desc.nullslast&limit=1`,{headers:H}).catch(()=>null);const [core,sr,fr,gh,teleReq,maschReq,kiccReq]=await Promise.all([coreP,snapP,futureP,gitP,teleP,maschP,kiccP]);requests+=2;
// Fehlt die Momentaufnahme, faellt frueher der ganze Lauf aus - eine einzige
// KC-eigene Funktion legte damit alles lahm, auch die Kacheln, die nichts mit
// ihr zu tun haben. Jetzt faellt nur aus, was von ihr abhaengt.
let snap:any=null;if(sr?.r?.ok)try{snap=await sr.r.json()}catch{}
const snapFehlt=!sr?.r?.ok,snapStatus=sr?.r?.status??0;
const mh=snap?mirrorHealth(snap):{status:snapStatus===404?"not_configured":"unknown",health:null,age_min:null};
const coreBytes=Number(snap?.database_bytes??0);let fd:any={},gd:any={},tele:any=null;if(fr?.r?.ok)try{fd=await fr.r.json()}catch{}if(gh?.r?.ok)try{gd=await gh.r.json()}catch{}if(teleReq?.r?.ok)try{tele=(await teleReq.r.json())?.[0]||null}catch{}let masch:any=null;if(maschReq?.r?.ok)try{masch=(await maschReq.r.json())?.[0]||null}catch{}
// Die Backup-App meldet seit 1.8.x ueber den KICC-Weg in kicc_backup_telemetry, nicht
// (nur) in kc_backup_machine_telemetry. Gemessen 07.09.2026: machine 0 Zeilen, kicc 1 Zeile
// (v1.8.9, SUCCESS) - und die Kachel stand trotzdem rot. Beide Quellen lesen, die neuere gilt.
let kicc:any=null;if(kiccReq?.r?.ok)try{kicc=(await kiccReq.r.json())?.[0]||null}catch{}
if(kicc&&(!tele||Date.parse(kicc.measured_at||"")>Date.parse(tele.measured_at||""))){
  const ziel=String(kicc.backup_target||"").toLowerCase(),st=kicc.last_backup_status||kicc.status||null;
  tele={measured_at:kicc.measured_at,updated_at:kicc.updated_at,last_backup_at:kicc.last_backup_at,last_backup_status:st,last_backup_stored_bytes:kicc.last_backup_bytes,storage_target:kicc.backup_target,
    b2_status:/b2|backblaze/.test(ziel)||!ziel?st:null,neon_status:/neon/.test(ziel)?st:null,integrity:kicc.integrity_status||kicc.last_verify_result||null,restore:kicc.last_restore_test_result||null,app_version:kicc.app_version||null,quelle:"kicc_backup_telemetry"};
}const [neonDirect,b2Direct,r2Direct,ociDirect,repoConfig]=await Promise.all([optionalEndpoint("NEON"),optionalEndpoint("B2"),optionalEndpoint("R2"),optionalEndpoint("OCI"),publicConfig(gd)]);requests++;for(const x of[neonDirect,b2Direct,r2Direct,ociDirect])if(x)requests++;const futureBytes=Number(fd?.database_bytes??0),cu=pct(coreBytes,FREE_DB_BYTES),coreOk=!!core?.r?.ok,coreMs=core?.ms??null,coreStatus=coreOk?(coreMs!==null&&coreMs>3000?"warning":"healthy"):"critical",coreHealth=coreOk?(coreMs!==null&&coreMs>3000?82:coreMs!==null&&coreMs>1500?90:100):35;
let neon=endpointResult("neon","Neon · Direktcheck","database",neonDirect,"Direktcheck vorbereitet; die Supabase→Neon-Spiegelung wird separat geprüft");if(!neonDirect&&tele?.neon_status){const t=telemetryState(tele.neon_status);neon={...neon,status:t.status,health:t.health,capacityLabel:"PC Backup Vault Telemetrie",detail:`Neon-Telemetrie: ${tele.neon_status}`,metrics:{direct_check:false,telemetry:true,measured_at:tele.measured_at}}}
// Liegt ein Zugang zur Spiegeldatenbank bereit, wird sie selbst befragt statt
// nur ueber Dritte beurteilt. Ohne Zugang bleibt die bisherige Kachel stehen.
const neonCred=zugaenge.neon_mirror||null;
let sicherung=backupResult({ok:false,reason:"kein_zugang"});
if(neonCred){const [nq,bq]=await Promise.all([neonQuery(neonCred),backupQuery(neonCred)]);requests+=2;neon=neonResult(nq,neon);sicherung=backupResult(bq)}
let b2=endpointResult("b2","Backblaze B2","storage",b2Direct,"Adapter bereit; noch keine B2-Telemetrie oder sichere Read-only-Verbindung");if(!b2Direct&&tele?.b2_status){const t=telemetryState(tele.b2_status),age=tele.measured_at?Math.round((Date.now()-Date.parse(tele.measured_at))/60000):null;b2={...b2,status:t.status,health:t.health,capacityLabel:tele.last_backup_stored_bytes?`${mb(Number(tele.last_backup_stored_bytes))} MB letzter Backup-Satz`:"PC Backup Vault Telemetrie",detail:`B2 ${tele.b2_status} · letzter Backup-Status ${tele.last_backup_status||"unbekannt"}${tele.integrity?` · Integrität ${tele.integrity}`:""}${tele.restore?` · Restore-Test ${tele.restore}`:""}${tele.app_version?` · App v${tele.app_version}`:""}${age!==null?` · Telemetrie vor ${age} min`:""}`,metrics:{direct_check:false,telemetry:true,measured_at:tele.measured_at,last_backup_at:tele.last_backup_at,last_backup_status:tele.last_backup_status,last_backup_stored_bytes:tele.last_backup_stored_bytes,storage_target:tele.storage_target}}}
// Backup-Alter und Schweigen der Backup-App sind Befunde, keine Einrichtungsluecke.
// Vorher blieb die Kachel "nicht eingerichtet", solange nie Telemetrie kam - auch
// wenn die Maschine laengst gekoppelt war und seit Wochen nichts mehr sicherte.
// Gemessen am 07.09.2026: Kopplung aktiv seit 24.08., zuletzt gesehen 26.08.,
// letztes Backup 24.08., Telemetrie 0 Zeilen, Kachel gruen-neutral. Das faengt diese Regel.
if(!b2Direct){b2=backupAgeRules(b2,tele,masch)}
const r2=endpointResult("r2","Cloudflare R2","storage",r2Direct,"Als Backup-/Failback-Anbieter vorbereitet; Scharfstellung nach Zugangseinrichtung"),oci=endpointResult("oci","Oracle OCI Object Storage","storage",ociDirect,"Als Reserve-Anbieter vorbereitet; Scharfstellung nach Zugangseinrichtung");
const [securityRes,capacityRes,programRes,exposure]=await Promise.all([rpc(own,service,"kc_system_check_security_audit"),rpc(own,service,"kc_system_check_db_capacity"),rpc(own,service,"kc_system_check_programs"),exposureResult(own)]);requests+=5;const zweitesProjekt=secondProjectResult(futureCfg,fr,fd);const dbSecurity=securityResult(securityRes),dbCapacity=capacityResult(capacityRes),programme=programResult(programRes),keyLifetime=keyLifetimeResult();
const all:any[]=[{id:"kc_core",name:"KC Core · Supabase",kind:"database",status:coreStatus,health:coreHealth,latency:coreMs,usage:snapFehlt?null:cu,capacityLabel:snapFehlt?"Kapazität nicht verfügbar":`${mb(coreBytes)} / 500 MB`,detail:coreOk?(snapFehlt?`Erreichbar, aber die Momentaufnahme fehlt (HTTP ${snapStatus||"Netz"}) · Kapazität und Spiegelung sind damit ungeprüft`:(coreMs!==null&&coreMs>3000?"Erreichbar, aber langsam":"KC Core erreichbar")):"KC Core nicht erreichbar",metrics:{database_bytes:coreBytes,free_tier_database_bytes:FREE_DB_BYTES,usage_percent:cu,latency_ms:coreMs,snapshot_latency_ms:sr?.ms??null,probe_http_status:core?.r?.status??null}},zweitesProjekt,{id:"mirror",name:"Spiegelung · Supabase → Neon",kind:"replication",status:mh.status,health:mh.health,latency:null,usage:null,capacityLabel:`${snap?.runs_24h??0} Läufe / 24 h`,detail:mirrorDetail(mh,snap,snapFehlt),metrics:{...snap?.mirror,age_min:mh.age_min,open_tables:mh.open_tables??0,runs_24h:snap?.runs_24h,non_ok_24h:snap?.non_ok_24h,mismatches_24h:snap?.mismatches_24h,last_issue:snap?.last_issue??null,snapshot_latency_ms:sr?.ms??null}},neon,sicherung,repoResult(gh,gd,repoConfig),b2,r2,oci,programme,dbSecurity,dbCapacity,exposure,keyLifetime];const aliases:any={supabase:["kc_core","future_academy"],sicherheit:["db_security","endpoint_exposure","key_lifetime"]},raw=u.searchParams.get("systems")?.split(",").filter(Boolean)||[],wanted=[...new Set(raw.flatMap(x=>aliases[x]||[x]))],results=wanted.length?all.filter(x=>wanted.includes(x.id)):all,status=worst(results),h=health(results),bekanntePruefungen=all.length,messbar=results.filter(x=>["healthy","warning","critical"].includes(x.status)).length,uebersprungen=all.filter(x=>!results.includes(x)).map(x=>x.id),coverage=Math.round(messbar/Math.max(1,bekanntePruefungen)*100),duration=Date.now()-started,payload:any={version:"0.4.0-live",status,health:h,coverage,selection:{selected:wanted.length>0,run:results.length,known:bekanntePruefungen,skipped:uebersprungen},checkedAt:new Date().toISOString(),duration_ms:duration,capacity:{kc_core_database_bytes:coreBytes,future_academy_database_bytes:futureBytes||null,free_database_bytes:FREE_DB_BYTES},resource_usage:{request_count:requests,estimated:true},provider_registry:{source:"PC Backup Vault",prepared:["b2","r2","oci"],no_test_uploads:true},results};const bytes=enc.encode(JSON.stringify(payload)).byteLength;payload.resource_usage.response_bytes=bytes;let recorded=false;if(u.searchParams.get("record")!=="0"){const who=await callerRole(req,own,service);let allowed=!!who.role;if(!allowed){let lastAt:any=null;try{const rows=await core?.r?.json();lastAt=rows?.[0]?.checked_at??null}catch{}const age=lastAt?Date.now()-Date.parse(lastAt):Number.POSITIVE_INFINITY;allowed=!(Number.isFinite(age)&&age<10*60*1000)}if(allowed){recorded=true;const trigger=["auto","selected"].includes(u.searchParams.get("trigger")||"")?u.searchParams.get("trigger"):"manual";await fetch(`${own}/rest/v1/kc_system_check_history`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json","Prefer":"return=minimal"},body:JSON.stringify({trigger_type:trigger,overall_status:status,health:h,duration_ms:duration,request_count:requests,response_bytes:bytes,results})}).catch(()=>null)}}payload.recorded=recorded;return new Response(JSON.stringify(payload),{headers:CORS})}catch(e){return new Response(JSON.stringify({version:"0.4.0-live",status:"critical",health:0,checkedAt:new Date().toISOString(),error:String((e as Error)?.message||e)}),{status:500,headers:CORS})}});
