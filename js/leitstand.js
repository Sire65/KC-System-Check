import{loadLeitstand}from"./adapters/live.js";
import{state,publish}from"./state.js";
import{hasSession,login,clearSession,onSessionChange}from"./session.js";
const $=s=>document.querySelector(s);
const eur=c=>Number.isFinite(Number(c))?new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(Number(c)/100):"—";
const bytes=n=>{const v=Number(n);if(!Number.isFinite(v)||v<0)return"—";if(v<1024)return`${v} B`;if(v<1024**2)return`${(v/1024).toFixed(1)} KB`;if(v<1024**3)return`${(v/1024**2).toFixed(1)} MB`;return`${(v/1024**3).toFixed(2)} GB`};
const ageSeconds=t=>{const n=Date.parse(t||"");return Number.isFinite(n)?Math.max(0,Math.round((Date.now()-n)/1000)):null};
const ageText=s=>s==null?"nie":s<60?`vor ${s} s`:s<3600?`vor ${Math.round(s/60)} min`:s<86400?`vor ${Math.round(s/3600)} h`:`vor ${Math.round(s/86400)} T`;
const operational=id=>/(kasse|markt|pos|manager)/i.test(id||"");
function hbState(h,thresholds={}){const age=ageSeconds(h?.measured_at||h?.received_at),warn=Number(thresholds.heartbeat_warn_seconds||90),crit=Number(thresholds.heartbeat_critical_seconds||180);if(age==null)return{cls:"idle",label:"Noch nie gemeldet",age};if(!operational(h.program_id)&&age>crit)return{cls:"idle",label:`Nicht aktiv · letzte Meldung ${ageText(age)}`,age};if(age>crit)return{cls:"bad",label:`Keine Meldung ${ageText(age)}`,age};if(age>warn)return{cls:"warn",label:`Heartbeat verspätet · ${ageText(age)}`,age};return{cls:"ok",label:`Online · ${ageText(age)}`,age}}
function heartbeatName(h){const id=String(h.program_id||"").toLowerCase();if(id.includes("manager"))return"PC Manager";if(id.includes("kasse")||id.includes("markt")||id.includes("pos"))return`Kasse · ${h.instance_id||"Instanz"}`;if(id==="kc-dp2")return"KC DP2";if(id==="kicc")return"KC Communication / KICC";return h.program_id||"KC Programm"}
function placeholder(name,text){return`<div class="live-device"><span class="dot idle"></span><div><strong>${name}</strong><div class="muted small">${text}</div></div><span class="live-tag">vorbereitet</span></div>`}
function commRoutes(data){return data?.communication?.provider_state?.routes||[]}
function routeTime(r){return r?.checked_at||r?.last_checked_at||r?.updated_at||r?.measured_at||r?.last_success_at||r?.last_failure_at||null}
function commState(route){const raw=String(route?.health_status||"").toLowerCase(),age=ageSeconds(routeTime(route));if(age==null)return{cls:"idle",tag:"UNBEKANNT",detail:"kein aktueller Prüfzeitpunkt",age};if(age>86400)return{cls:"idle",tag:"VERALTET",detail:`Status veraltet · ${ageText(age)}`,age};if(raw==="healthy")return{cls:"ok",tag:"OK",detail:`aktuell · ${ageText(age)}`,age};if(raw==="down"||Number(route?.consecutive_failures||0)>=3)return{cls:"bad",tag:"STÖRUNG",detail:`aktuell · ${ageText(age)}`,age};if(raw)return{cls:"warn",tag:"WARNUNG",detail:`aktuell · ${ageText(age)}`,age};return{cls:"idle",tag:"UNBEKANNT",detail:`Status unbekannt · ${ageText(age)}`,age}}
function commClass(route){return commState(route).cls}
function appMatches(appId,h){const id=String(h?.program_id||"").toLowerCase(),a=String(appId||"").toUpperCase();if(a==="KC_DP")return id==="kc-dp2"||id.includes("dienstplan")||id.includes("kc-dp");if(a==="KC_COMMUNICATION")return id==="kicc"||id.includes("communication")||id.includes("communicator");if(a==="KC_MANAGER")return id.includes("manager");if(a==="KC_MARKTKASSE")return /(kasse|markt|pos)/i.test(id);if(a==="KC_BACKUP")return id.includes("backup");const token=a.replace(/^KC_/,"").toLowerCase().replaceAll("_","-");return id.includes(token)}
function latestHb(list){return [...list].sort((a,b)=>Date.parse(b.measured_at||b.received_at||0)-Date.parse(a.measured_at||a.received_at||0))[0]||null}
function ensurePanel(id,title,subtitle,afterSelector){let el=$(id);if(el)return el;const anchor=$(afterSelector)?.closest("article");if(!anchor)return null;const article=document.createElement("article");article.className="card";article.innerHTML=`<div class="row between"><div><h3>${title}</h3><div class="muted small">${subtitle}</div></div><span class="badge">AUTO</span></div><div id="${id.slice(1)}" style="margin-top:8px"></div>`;anchor.insertAdjacentElement("afterend",article);return $(id)}
function renderRegisteredApps(data){const host=ensurePanel("#liveApps","Registrierte KC Programme","Automatisch aus KC Core · alter ONLINE-Status wird nicht als live gewertet","#livePrograms");if(!host)return;const apps=data.apps||[],hs=data.heartbeats||[],now=Date.now();host.innerHTML=apps.map(app=>{const matches=hs.filter(h=>appMatches(app.app_id,h)),latest=latestHb(matches),age=latest?ageSeconds(latest.measured_at||latest.received_at):null,recent=matches.filter(h=>now-Date.parse(h.measured_at||h.received_at||0)<=86400000),versions=[...new Set(recent.map(h=>h.version).filter(Boolean))],diverged=versions.length>1,errors=Number(latest?.error_count||0),fresh=age!==null&&age<=180,prepared=["KC_MANAGER","KC_MARKTKASSE"].includes(app.app_id)&&!latest;let cls="idle",tag="REGISTRIERT",detail="Noch keine Telemetrie";if(prepared){detail="Anbindung vorbereitet · aktuelle Programmversion später anbinden";tag="VORBEREITET"}else if(latest&&fresh){cls=diverged||errors>0?"warn":"ok";tag=cls==="ok"?"AKTIV":"PRÜFEN";detail=`${heartbeatName(latest)} · ${latest.version?`v${latest.version} · `:""}${ageText(age)}${errors?` · ${errors} Fehler gemeldet`:""}${diverged?` · Versionsabweichung: ${versions.join(" / ")}`:""}`}else if(latest){detail=`Status veraltet · zuletzt ${ageText(age)}${latest.version?` · v${latest.version}`:""}${matches.length>1?` · ${matches.length} bekannte Instanzen`:""}`;tag="VERALTET"}return`<div class="live-device"><span class="dot ${cls}"></span><div><strong>${app.name}</strong><div class="muted small">${detail}</div></div><span class="live-tag">${tag}</span></div>`}).join("")||`<div class="muted small">Keine registrierten KC Programme gefunden.</div>`}
function pickBackup(data){const m=data?.backup?.machine||{},k=data?.backup?.kicc||{};return Object.keys(m).length?{...m,source:"PC Backup Vault"}:Object.keys(k).length?{...k,source:"KICC Backup"}:null}
// "PASS" (so meldet es die Backup-App) passte bisher nicht auf "passed" - Integritaet und
// Restore-Test standen deshalb gelb, obwohl bestanden. Gemessen 07.09.2026.
function backupClass(v){const s=String(v||"").toLowerCase();if(["ok","healthy","success","pass","verified"].some(x=>s.includes(x)))return"ok";if(["error","failed","critical","down","corrupt"].some(x=>s.includes(x)))return"bad";if(s)return"warn";return"idle"}
function renderBackup(data){const host=ensurePanel("#liveBackup","Backup & Wiederherstellung","Read-only-Telemetrie aus dem bestehenden Backup-System","#liveApps");if(!host)return;const b=pickBackup(data);if(!b){host.innerHTML=`<div class="live-empty"><strong>Backup-Telemetrie vorbereitet.</strong><div class="muted small">Noch keine Messwerte vorhanden. B2/Neon werden nicht künstlich grün angezeigt.</div></div>`;return}const lastAge=ageSeconds(b.last_backup_at),stale=lastAge!=null&&lastAge>86400,status=stale?"idle":backupClass(b.status||b.last_backup_status),last=b.last_backup_at?`${stale?"Status veraltet · ":""}${ageText(lastAge)}`:"noch kein Backup",verify=b.integrity_result||b.last_verify_result||b.integrity_status||"—",restore=b.restore_result||b.last_restore_test_result||"—",stored=b.last_backup_stored_bytes??b.last_backup_bytes;host.innerHTML=`<div class="live-kpis"><div class="live-kpi"><span class="dot ${status}"></span><div class="muted small">Backup-Status</div><div class="kpi">${stale?"VERALTET":String(b.last_backup_status||b.status||"—").toUpperCase()}</div><div class="muted small">${last}</div></div><div class="live-kpi"><span class="dot ${backupClass(verify)}"></span><div class="muted small">Integrität</div><div class="kpi">${String(verify).toUpperCase()}</div><div class="muted small">${b.last_integrity_at||b.last_verify_at?ageText(ageSeconds(b.last_integrity_at||b.last_verify_at)):"kein Prüftermin"}</div></div><div class="live-kpi"><span class="dot ${backupClass(restore)}"></span><div class="muted small">Restore-Test</div><div class="kpi">${String(restore).toUpperCase()}</div><div class="muted small">${b.last_restore_test_at?ageText(ageSeconds(b.last_restore_test_at)):"noch kein Test"}</div></div><div class="live-kpi"><span class="dot ${status}"></span><div class="muted small">Letzter Satz</div><div class="kpi">${bytes(stored)}</div><div class="muted small">${b.storage_target||b.backup_target||b.source}</div></div></div>`}
function renderPrograms(data){const hs=data.heartbeats||[],thresholds=data.thresholds||{},sorted=[...hs].sort((a,b)=>Date.parse(b.measured_at||0)-Date.parse(a.measured_at||0)),pos=sorted.filter(h=>/(kasse|markt|pos)/i.test(h.program_id||"")),manager=sorted.filter(h=>/manager/i.test(h.program_id||""));// Eine Zeile je Browser-Sitzung, fuer immer - die Liste wurde zur Halde: 27
// Zeilen, davon zwei aktiv. Was gerade laeuft, ging darin unter. Aktive oben,
// alles Historische hinter einem Aufklapper.
const karte=h=>{const st=hbState(h,thresholds),q=Number(h.queue_depth||0),err=Number(h.error_count||0),extra=[h.version?`v${h.version}`:"",q?`Queue ${q}`:"",err?`${err} Fehler`:""].filter(Boolean).join(" · ");return`<div class="live-device ${st.cls==='bad'?'live-alert':''}"><span class="dot ${st.cls}"></span><div><strong>${heartbeatName(h)}</strong><div class="muted small">${st.label}${extra?` · ${extra}`:""}</div></div><span class="live-tag">${st.cls==="ok"?"LIVE":st.cls==="warn"?"VERSPÄTET":st.cls==="bad"?"OFFLINE":"HISTORISCH"}</span></div>`};
  const aktuell=sorted.filter(h=>hbState(h,thresholds).cls!=="idle"),historisch=sorted.filter(h=>hbState(h,thresholds).cls==="idle");
  let html=aktuell.map(karte).join("");
  if(historisch.length)html+=`<details class="live-history"><summary class="muted small" style="cursor:pointer;padding:10px 2px">${historisch.length} ältere Sitzung(en) einblenden · seit über ${Math.round((Date.now()-Date.parse(historisch[0].measured_at||historisch[0].received_at||Date.now()))/3600000)} h ohne Meldung</summary>${historisch.map(karte).join("")}</details>`;if(pos.length<2)for(let i=pos.length;i<2;i++)html+=placeholder(`Kasse ${i+1}`,"Heartbeat-Anbindung vorbereitet");if(!manager.length)html+=placeholder("PC Manager","Heartbeat-Anbindung vorbereitet");for(const r of commRoutes(data)){const st=commState(r),name=r.channel==="email"?"KC E-Mail":"KC Push",fails=Number(r.consecutive_failures||0);html+=`<div class="live-device ${st.cls==='bad'?'live-alert':''}"><span class="dot ${st.cls}"></span><div><strong>${name}</strong><div class="muted small">Provider ${r.provider_id||"—"} · ${st.detail}${fails&&st.cls!=="idle"?` · ${fails} Fehler in Folge`:""}${r.last_failure_at?` · Fehlerhistorie ${ageText(ageSeconds(r.last_failure_at))}`:""}</div></div><span class="live-tag">${st.tag}</span></div>`}$("#livePrograms").innerHTML=html||placeholder("KC Programme","Noch keine Heartbeats vorhanden")}
function renderSummary(data){const hs=data.heartbeats||[],th=data.thresholds||{},active=hs.map(h=>({h,s:hbState(h,th)})),fresh=active.filter(x=>x.s.cls==="ok"),pos=active.filter(x=>/(kasse|markt|pos)/i.test(x.h.program_id||"")),manager=active.filter(x=>/manager/i.test(x.h.program_id||"")),posOnline=pos.filter(x=>x.s.cls==="ok").length,managerOnline=manager.some(x=>x.s.cls==="ok"),queue=fresh.reduce((n,x)=>n+Number(x.h.queue_depth||0),0),errors=fresh.reduce((n,x)=>n+Number(x.h.error_count||0),0),routeStates=commRoutes(data).map(r=>({r,s:commState(r)})),badRoute=routeStates.find(x=>x.s.cls==="bad"),warnRoute=routeStates.find(x=>x.s.cls==="warn"),freshRoutes=routeStates.filter(x=>x.s.cls!=="idle"),commCls=badRoute?"bad":warnRoute?"warn":freshRoutes.length?"ok":"idle",commValue=badRoute?"STÖRUNG":warnRoute?"WARNUNG":freshRoutes.length?"OK":"—",commSub=badRoute?`${badRoute.r.channel}: ${badRoute.s.detail}`:warnRoute?`${warnRoute.r.channel}: ${warnRoute.s.detail}`:freshRoutes.length?`${freshRoutes.length} aktuelle Kanäle`:routeStates.length?"Statusdaten veraltet":"Keine Providerdaten",backup=pickBackup(data),backupAge=ageSeconds(backup?.last_backup_at),backupCls=backupAge!=null&&backupAge>86400?"idle":backup?backupClass(backup.last_backup_status||backup.status):"idle";const kpis=[{label:"Live-Meldungen",value:String(fresh.length),sub:`von ${hs.length} bekannten Instanzen aktuell`,cls:fresh.length?"ok":"idle"},{label:"Kassen",value:pos.length?`${posOnline}/${Math.max(2,pos.length)}`:"0/2",sub:pos.length?"online":"Anbindung vorbereitet",cls:pos.some(x=>x.s.cls==="bad")?"bad":pos.some(x=>x.s.cls==="warn")?"warn":posOnline?"ok":"idle"},{label:"PC Manager",value:manager.length?(managerOnline?"ONLINE":"OFFLINE"):"—",sub:manager.length?manager.map(x=>x.s.label).join(", "):"Anbindung vorbereitet",cls:manager.length?(managerOnline?"ok":"bad"):"idle"},{label:"Sync-Queue",value:String(queue),sub:queue?"Datensätze warten":"keine wartenden Live-Datensätze",cls:queue>20?"bad":queue>0?"warn":"ok"},{label:"Fehler aktuell",value:String(errors),sub:"nur aus frischen Heartbeats",cls:errors>10?"bad":errors>0?"warn":"ok"},{label:"Kommunikation",value:commValue,sub:commSub,cls:commCls},{label:"Backup",value:backupAge!=null&&backupAge>86400?"VERALTET":backup?String(backup.last_backup_status||backup.status||"—").toUpperCase():"—",sub:backup?.last_backup_at?`letztes Backup ${ageText(backupAge)}`:"Telemetrie vorbereitet",cls:backupCls}];$("#liveKpis").innerHTML=kpis.map(k=>`<div class="live-kpi"><span class="dot ${k.cls}"></span><div class="muted small">${k.label}</div><div class="kpi">${k.value}</div><div class="muted small">${k.sub}</div></div>`).join("")}
function renderSales(data){if(data.sales_hidden){$("#liveSalesSummary").textContent="Kassenereignisse sind für diese Rolle nicht freigegeben";$("#liveSales").innerHTML=`<div class="live-empty"><strong>Technik-Sicht aktiv.</strong><div class="muted small">Buchungen, Beträge und Zahlungsarten sieht nur die Rolle superadmin. Technische Zustände sind vollständig sichtbar.</div></div>`;return}const sales=data.sales||[],today=sales.filter(x=>x.event_type==="sale"),sum=today.reduce((n,x)=>n+Number(x.amount_cents||0),0);$("#liveSalesSummary").textContent=sales.length?`${today.length} Verkäufe · ${eur(sum)} · letzte 24 h`:`Live-Buchungsfeed vorbereitet · noch keine Kassenereignisse empfangen`;$("#liveSales").innerHTML=sales.length?sales.slice(0,20).map(x=>`<div class="live-sale"><div><strong>${x.register_id}</strong><div class="muted small">${new Date(x.occurred_at).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",second:"2-digit"})} · ${x.event_type}${x.payment_type?` · ${x.payment_type}`:""}${Number.isFinite(Number(x.item_count))?` · ${x.item_count} Artikel`:""}</div></div><div class="live-sale-value">${x.event_type==="sale"?eur(x.amount_cents):x.event_type.toUpperCase()}<div class="muted small">${x.sync_state||""}</div></div></div>`).join(""):`<div class="live-empty"><strong>Live-Monitor ist bereit.</strong><div class="muted small">Sobald Kassen Technik-Telemetrie senden, erscheinen hier Buchungszeit, Kasse, Betrag, Zahlungsart, Artikelanzahl und Sync-Status.</div></div>`}
function renderFlows(data){const flows=data.flows||[];$("#liveFlows").innerHTML=flows.length?flows.slice(0,12).map(x=>{const age=ageSeconds(x.measured_at),st=age!=null&&age>86400?"idle":String(x.status).toLowerCase().includes("error")?"bad":"ok";return`<div class="live-flow"><span class="dot ${st}"></span><div><strong>${x.source_id||x.program_id||"Quelle"} → ${x.target_id||"Ziel"}</strong><div class="muted small">${age!=null&&age>86400?"Status veraltet · ":""}${x.flow_type||"Datenfluss"} · ${x.event_count||0} Ereignisse · ${ageText(age)}</div></div></div>`}).join(""):`<div class="muted small">Noch keine Flow-Telemetrie. Der Bereich wird automatisch aktiv, sobald Programme Datenflüsse melden.</div>`}
function render(data){state.live=data;renderSummary(data);renderPrograms(data);renderRegisteredApps(data);renderBackup(data);renderSales(data);renderFlows(data);renderDatenfluss(data,laufzeit);const t=new Date(data.checked_at||Date.now());$("#liveLastUpdate").textContent=data.error?`Fehler: ${data.error}`:`Aktualisiert ${t.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",second:"2-digit"})} · Server ${data.server_latency_ms??"—"} ms`;publish()}
function gateHost(){const live=$("#live");if(!live)return null;let host=$("#kcLiveGate");if(host)return host;host=document.createElement("article");host.id="kcLiveGate";host.className="card";host.innerHTML=`<div class="eyebrow">Zugang</div><h2>Anmeldung erforderlich</h2><div id="kcLiveGateText" class="muted small">Der LIVE-Leitstand zeigt Betriebsdaten und ist nur für freigeschaltete Konten sichtbar.</div><label style="display:grid;gap:6px;margin-top:12px">E-Mail<input id="kcLiveEmail" type="email" autocomplete="username"></label><label style="display:grid;gap:6px;margin-top:8px">Passwort<input id="kcLivePassword" type="password" autocomplete="current-password"></label><div class="row" style="margin-top:12px;gap:8px"><button id="kcLiveLoginBtn" class="primary" type="button">Anmelden</button><button id="kcLiveLogoutBtn" class="secondary" type="button">Abmelden</button></div>`;live.prepend(host);return host}
function showGate(message){const live=$("#live");if(!live)return;const host=gateHost();if(!host)return;live.dataset.locked="1";const text=$("#kcLiveGateText");if(text&&message)text.textContent=message;host.hidden=false}
function hideGate(){const live=$("#live");if(live)delete live.dataset.locked;const host=$("#kcLiveGate");if(host)host.hidden=true}
let laufzeit=null;
export function setupLeitstand(runtime){laufzeit=runtime;let running=false,timer=null,controller=null;async function refresh(){if(running)return;if(!hasSession()){showGate("Der LIVE-Leitstand zeigt Betriebsdaten und ist nur für freigeschaltete Konten sichtbar.");return}running=true;const btn=$("#liveRefreshBtn");if(btn){btn.disabled=true;btn.textContent="Aktualisiere …"}controller=new AbortController();try{const data=await loadLeitstand(runtime,{signal:controller.signal});if(data?.status===403){showGate(data.error||"Dieses Konto ist für den Leitstand nicht freigeschaltet.")}else{hideGate();render(data)}}catch(e){$("#liveLastUpdate").textContent=`Leitstand-Fehler: ${e.message}`}finally{running=false;controller=null;if(btn){btn.disabled=false;btn.textContent="Jetzt aktualisieren"}}}function schedule(){clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&$("#live")?.classList.contains("active"))refresh()},30000)}$("#liveRefreshBtn")?.addEventListener("click",refresh);
  document.addEventListener("click",async event=>{
    if(event.target?.id==="kcLiveLoginBtn"){
      const button=event.target,email=$("#kcLiveEmail")?.value?.trim()||"",password=$("#kcLivePassword")?.value||"",text=$("#kcLiveGateText");
      if(!email||!password){if(text)text.textContent="E-Mail und Passwort eingeben.";return}
      button.disabled=true;if(text)text.textContent="Anmeldung läuft …";
      try{await login(email,password);const field=$("#kcLivePassword");if(field)field.value="";hideGate();await refresh()}
      catch(error){if(text)text.textContent=String(error.message||error)}
      finally{button.disabled=false}
    }
    if(event.target?.id==="kcLiveLogoutBtn"){clearSession();showGate("Abgemeldet.")}
  });
  onSessionChange(token=>{if(token)refresh();else showGate("Abgemeldet.")});document.addEventListener("visibilitychange",()=>{if(!document.hidden&&$("#live")?.classList.contains("active"))refresh()});document.querySelector('[data-view="live"]')?.addEventListener("click",refresh);refresh();schedule();return()=>{clearInterval(timer);controller?.abort()}}
// ============================================================================
// Datenfluss-Karte + Überwachungsläufe (frueher js/datenfluss.js). Eingebettet,
// weil der Pages-Workflow eine feste Kopierliste hat und neue Dateien dort
// nur mit Workflow-Rechten eingetragen werden koennen. Inhaltlich unveraendert.
// ============================================================================
// Datenfluss-Karte und Überwachungsläufe im LIVE-Leitstand.
//
// Woher die Zahlen kommen - und was sie NICHT kosten:
// 1. Kanten aus dem Leitstand-Schnappschuss (data.flows, data.heartbeats,
//    data.backup): der wird beim LIVE-Tab ohnehin alle 30 s geladen, hier
//    kommt keine Abfrage dazu.
// 2. Live-Meldungen der Programme über Supabase Realtime Broadcast, Kanal
//    "kc-datenfluss". Broadcast geht am Postgres vorbei (kein Insert, kein
//    Egress aus der Datenbank), nur ein Websocket. Der Client hier ist
//    absichtlich ein eigener Minimal-Client (Phoenix-Protokoll, ~40 Zeilen),
//    weil die PWA keine Fremdbibliothek laden soll (Manifest-Hashes, Offline).
// 3. Die Zeile "Überwachungsläufe" liest den letzten Prüflauf, der schon im
//    Speicher liegt (state.lastRun / Verlauf) - ebenfalls null Traffic.
//
// Alle IDs und Klassen tragen das Präfix kcdf, damit nichts mit Alt-Code kollidiert.

const NS="http://www.w3.org/2000/svg";
const FENSTER_MS=60000;      // "gerade" = letzte 60 s
const VERALTET_MS=150000;    // danach gestrichelt
const KANAL="kc-datenfluss";

// Knoten in drei Spalten: Programme vor Ort · Cloud-Kern · Sicherung
const STANDARD_KNOTEN=[
  {id:"kasse-01",name:"Kasse 01",typ:"geraet",spalte:0},
  {id:"kasse-02",name:"Kasse 02",typ:"geraet",spalte:0},
  {id:"pc-manager",name:"PC-Manager",typ:"geraet",spalte:0},
  {id:"money-butler",name:"Money Butler",typ:"geraet",spalte:0},
  {id:"dp-app",name:"Dienstplan-App",typ:"geraet",spalte:0},
  {id:"pc-backup",name:"PC Backup Vault",typ:"geraet",spalte:0},
  {id:"supabase",name:"Supabase\nKC Core",typ:"db",spalte:1},
  {id:"neon-mirror",name:"Neon\nKC Core Mirror",typ:"db",spalte:2},
  {id:"neon-vault",name:"Neon\nBackup Vault",typ:"db",spalte:2},
  {id:"b2",name:"Backblaze B2",typ:"speicher",spalte:2}
];
const RAND={geraet:"#5aa7ff",db:"#2ecc71",speicher:"#f3c34d"};

// Programm-IDs aus Heartbeats/Flows auf Knoten abbilden
export function knotenId(raw){
  const id=String(raw||"").toLowerCase();
  if(!id)return null;
  if(/kasse|markt|pos/.test(id)){const n=id.match(/(\d{1,2})/);return n?`kasse-${n[1].padStart(2,"0")}`:"kasse-01"}
  if(/manager/.test(id))return"pc-manager";
  if(/money|butler|bargeld/.test(id))return"money-butler";
  if(/dp|dienstplan/.test(id))return"dp-app";
  if(/backup|vault|pbv/.test(id))return"pc-backup";
  if(/supabase|kc[-_]?core|kicc|communication|system-check/.test(id))return"supabase";
  if(/mirror|spiegel/.test(id))return"neon-mirror";
  if(/neon/.test(id))return"neon-vault";
  if(/b2|backblaze/.test(id))return"b2";
  return id.replace(/[^a-z0-9-]/g,"-");
}

function el(name,attrs,parent){const e=document.createElementNS(NS,name);for(const k in attrs||{})e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e}
const bytesText=b=>b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`;
const vorText=ms=>ms<1000?"gerade eben":ms<60000?`vor ${Math.round(ms/1000)} s`:ms<3600000?`vor ${Math.round(ms/60000)} min`:ms<86400000?`vor ${(ms/3600000).toFixed(1)} h`:`vor ${Math.round(ms/86400000)} T`;
const alter=t=>{const n=Date.parse(t||"");return Number.isFinite(n)?Math.max(0,Date.now()-n):null};

// ---------------------------------------------------------------- Karte
export function karteErzeugen(container,optionen={}){
  const knotenListe=(optionen.knoten||STANDARD_KNOTEN).map(k=>({...k})),knoten={},kanten={};
  const reduziert=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const B=740,H=420,SPALTE_X=[150,400,640],KB=150,KH=46;
  const css=getComputedStyle(document.documentElement),farbe={
    aktiv:css.getPropertyValue("--ok").trim()||"#2ecc71",fehler:css.getPropertyValue("--bad").trim()||"#ef5a5a",
    warn:css.getPropertyValue("--warn").trim()||"#f3c34d",ruhe:css.getPropertyValue("--idle").trim()||"#64748b",
    text:css.getPropertyValue("--text").trim()||"#f5f7fb",karte:"#0e1728"};

  container.innerHTML=`<div class="kcdf"><style>
    .kcdf svg{display:block;width:100%;height:auto;max-width:900px;margin:0 auto}
    .kcdf-treffer{cursor:pointer}.kcdf-knoten text{pointer-events:none}
    .kcdf-fuss{display:flex;gap:14px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;margin-top:8px}
    .kcdf-legende{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px}
    .kcdf-legende span::before{content:"";display:inline-block;width:18px;height:3px;vertical-align:middle;margin-right:5px;border-radius:2px;background:var(--ok)}
    .kcdf-legende .ruhe::before{background:var(--idle)}.kcdf-legende .fehler::before{background:var(--bad)}
    .kcdf-legende .veraltet::before{background:repeating-linear-gradient(90deg,var(--idle) 0 4px,transparent 4px 7px)}
    .kcdf-detail{min-width:240px;background:#0e1728;border:1px solid var(--line);border-radius:12px;padding:9px 12px;font-size:13px}
    .kcdf-detail:empty{display:none}
    @media(max-width:620px){.kcdf-fuss{flex-direction:column}}
  </style></div>`;
  const wurzel=container.firstElementChild;
  const svg=el("svg",{viewBox:`0 0 ${B} ${H}`,role:"img","aria-label":"Datenfluss zwischen KC-Programmen und Datenbanken"},wurzel);
  const fuss=document.createElement("div");fuss.className="kcdf-fuss";
  fuss.innerHTML=`<div class="kcdf-legende"><span>Verkehr in den letzten 60 s</span><span class="ruhe">kein Verkehr</span><span class="veraltet">keine Meldung seit über 2 min</span><span class="fehler">Fehler dabei</span></div><div class="kcdf-detail"></div>`;
  wurzel.appendChild(fuss);
  const detail=fuss.querySelector(".kcdf-detail");
  const gKanten=el("g",{},svg),gPunkte=el("g",{},svg),gKnoten=el("g",{},svg);

  function anordnen(){const sp=[[],[],[]];knotenListe.forEach(k=>sp[k.spalte||0].push(k));sp.forEach((l,s)=>{const d=H/(l.length+1);l.forEach((k,i)=>{k.x=SPALTE_X[s];k.y=Math.round(d*(i+1))})});knotenListe.forEach(k=>knoten[k.id]=k)}
  function knotenZeichnen(){gKnoten.innerHTML="";for(const k of knotenListe){
    const g=el("g",{class:"kcdf-knoten",transform:`translate(${k.x-KB/2},${k.y-KH/2})`},gKnoten);
    el("rect",{width:KB,height:KH,rx:10,fill:farbe.karte,stroke:RAND[k.typ]||RAND.geraet,"stroke-width":1.5},g);
    el("rect",{width:6,height:KH,rx:3,fill:RAND[k.typ]||RAND.geraet},g);
    const zeilen=k.name.split("\n"),t=el("text",{x:16,y:zeilen.length>1?19:28,fill:farbe.text,"font-size":13,"font-weight":700},g);
    zeilen.forEach((z,i)=>{const ts=el("tspan",{x:16,dy:i?15:0},t);if(i){ts.setAttribute("font-weight",400);ts.setAttribute("fill","#9ba7bd")}ts.textContent=z});
    k.lampe=el("circle",{cx:KB-12,cy:KH/2,r:4.5,fill:farbe.ruhe},g);
  }}
  function pfad(a,b){
    if(a.x===b.x){const x0=a.x-KB/2,bx=x0-55;return`M${x0},${a.y} C${bx},${a.y} ${bx},${b.y} ${x0},${b.y}`}
    const l=a.x<b.x?a:b,r=a.x<b.x?b:a,x1=l.x+KB/2,x2=r.x-KB/2,mx=(x1+x2)/2;
    return`M${x1},${l.y} C${mx},${l.y} ${mx},${r.y} ${x2},${r.y}`;
  }
  function knotenNach(id){
    const spalte=/supabase/.test(id)?1:/neon|b2|vault/.test(id)?2:0;
    knotenListe.push({id,name:id,typ:spalte===0?"geraet":spalte===1?"db":"speicher",spalte});
    anordnen();knotenZeichnen();
    for(const k of Object.values(kanten)){k.pfad.setAttribute("d",pfad(knoten[k.von],knoten[k.nach]));k.treffer.setAttribute("d",k.pfad.getAttribute("d"));k.laenge=k.pfad.getTotalLength()}
  }
  function kante(von,nach){
    if(!knoten[von])knotenNach(von);if(!knoten[nach])knotenNach(nach);
    const id=`${von}>${nach}`;let k=kanten[id];
    if(!k){
      k=kanten[id]={von,nach,req:0,bytes:0,fehler:0,letzte:0,quelle:"",verlauf:[],punkte:[],geschwindigkeit:0};
      k.pfad=el("path",{class:"kcdf-kante",d:pfad(knoten[von],knoten[nach]),fill:"none",stroke:farbe.ruhe,"stroke-width":1.5,"stroke-linecap":"round"},gKanten);
      // breiter, unsichtbarer Treffbereich - dünne Linien sind auf dem Handy sonst nicht zu treffen
      k.treffer=el("path",{class:"kcdf-treffer",d:k.pfad.getAttribute("d"),fill:"none",stroke:"transparent","stroke-width":18,"pointer-events":"stroke"},gKanten);
      k.treffer.addEventListener("click",()=>zeige(k));
      k.laenge=k.pfad.getTotalLength();k.vorwaerts=knoten[von].x<=knoten[nach].x;
    }
    return k;
  }
  function eintragen(k,req,bytes,fehler,quelle,zeit){k.verlauf.push({t:zeit||Date.now(),req,bytes,fehler});k.quelle=quelle;k.letzte=Math.max(k.letzte,zeit||Date.now());summieren(k)}
  function summieren(k){const g=Date.now()-FENSTER_MS;k.verlauf=k.verlauf.filter(v=>v.t>=g);k.req=0;k.bytes=0;k.fehler=0;for(const v of k.verlauf){k.req+=v.req;k.bytes+=v.bytes;k.fehler+=v.fehler}}

  function darstellen(){
    const jetzt=Date.now(),lampen={};
    for(const k of Object.values(kanten)){
      summieren(k);
      const rate=k.req/(FENSTER_MS/1000),aktiv=k.req>0,veraltet=k.letzte&&jetzt-k.letzte>VERALTET_MS,f=k.fehler>0?farbe.fehler:aktiv?farbe.aktiv:farbe.ruhe;
      k.pfad.setAttribute("stroke",f);k.pfad.setAttribute("stroke-width",aktiv?Math.min(1.5+Math.log10(1+k.req)*2.2,7).toFixed(1):1.5);
      k.pfad.setAttribute("stroke-dasharray",veraltet?"5 6":"none");k.pfad.setAttribute("opacity",aktiv?1:.55);
      if(aktiv)lampen[k.von]=lampen[k.nach]=f;
      const soll=aktiv&&!reduziert?Math.min(6,Math.max(1,Math.round(1+rate*4))):0;
      while(k.punkte.length<soll)k.punkte.push({el:el("circle",{r:3.2,fill:f},gPunkte)});
      while(k.punkte.length>soll)gPunkte.removeChild(k.punkte.pop().el);
      k.geschwindigkeit=.12+Math.min(rate,5)*.16;k.punkte.forEach(p=>p.el.setAttribute("fill",f));
    }
    for(const k of knotenListe)k.lampe.setAttribute("fill",lampen[k.id]||k.eigeneLampe||farbe.ruhe);
    if(detail._kante)zeige(detail._kante);
  }
  const start=performance.now();
  function animation(t){const s=(t-start)/1000;for(const k of Object.values(kanten))k.punkte.forEach((p,i)=>{let a=(s*k.geschwindigkeit+i/k.punkte.length)%1;if(!k.vorwaerts)a=1-a;const pt=k.pfad.getPointAtLength(a*k.laenge);p.el.setAttribute("cx",pt.x.toFixed(1));p.el.setAttribute("cy",pt.y.toFixed(1))});if(!wurzel.isConnected)return;requestAnimationFrame(animation)}
  function zeige(k){
    detail._kante=k;const von=knoten[k.von].name.replace("\n"," "),nach=knoten[k.nach].name.replace("\n"," ");
    detail.innerHTML=`<strong>${von} → ${nach}</strong><br>${k.req?`${k.req} Ereignisse, ${bytesText(k.bytes)} in 60 s`:"kein Verkehr in den letzten 60 s"}${k.fehler?`<br><span style="color:var(--bad)">${k.fehler} fehlgeschlagen</span>`:""}<br><span class="muted small">Letzte Aktivität: ${k.letzte?vorText(Date.now()-k.letzte):"nie"} · Quelle: ${k.quelle||"–"}</span>`;
  }

  anordnen();knotenZeichnen();
  const timer=setInterval(()=>{if(!wurzel.isConnected){clearInterval(timer);return}darstellen()},2000);
  if(!reduziert)requestAnimationFrame(animation);

  return{
    // Broadcast-Payload eines Programms: {von, geraet, fenster_ms, kanten:[{nach,req,bytes,fehler}]}
    meldung(p){if(!p?.kanten)return;const von=knotenId(p.von);for(const e of p.kanten){const nach=knotenId(e.nach);if(!von||!nach||von===nach)continue; // PC-Manager-Fenster -> Manager-Dienst ist derselbe Kasten
      eintragen(kante(von,nach),e.req||0,e.bytes||0,e.fehler||0,`Meldung ${p.geraet||p.von}`)}},
    // Kante aus Schnappschuss/Log
    kante(von,nach,daten,quelle,zeit){eintragen(kante(knotenId(von),knotenId(nach)),daten.req||0,daten.bytes||0,daten.fehler||0,quelle||"Log",zeit)},
    // Lampe eines Knotens direkt setzen (z.B. aus Heartbeats), ohne Kante
    lampe(id,zustand){const k=knoten[knotenId(id)];if(k)k.eigeneLampe=zustand==="ok"?farbe.aktiv:zustand==="warn"?farbe.warn:zustand==="bad"?farbe.fehler:null},
    darstellen,
    zerstoeren(){clearInterval(timer);container.innerHTML=""}
  };
}

// ---------------------------------------------- Realtime Broadcast (minimal)
// Phoenix-Protokoll v1.0.0 über Websocket. Kein Postgres beteiligt.
export function broadcastAbonnieren(runtime,aufMeldung,aufZustand=()=>{}){
  const base=String(runtime?.apiBaseUrl||""),m=base.match(/^https:\/\/([a-z0-9-]+\.supabase\.co)/i);
  if(!m||!runtime?.apiToken){aufZustand("nicht konfiguriert");return()=>{}}
  const url=`wss://${m[1]}/realtime/v1/websocket?apikey=${encodeURIComponent(runtime.apiToken)}&vsn=1.0.0`;
  let ws=null,ref=0,herz=null,wieder=null,zu=false;
  const senden=(topic,event,payload)=>{if(ws?.readyState===1)ws.send(JSON.stringify({topic,event,payload,ref:String(++ref)}))};
  function verbinden(){
    if(zu)return;
    try{ws=new WebSocket(url)}catch(e){aufZustand(`Fehler: ${e.message}`);return}
    ws.onopen=()=>{senden(`realtime:${KANAL}`,"phx_join",{config:{broadcast:{self:false},presence:{key:""},postgres_changes:[]},access_token:runtime.apiToken});herz=setInterval(()=>senden("phoenix","heartbeat",{}),30000)};
    ws.onmessage=ev=>{let msg;try{msg=JSON.parse(ev.data)}catch{return}
      if(msg.event==="phx_reply"&&msg.topic===`realtime:${KANAL}`)aufZustand(msg.payload?.status==="ok"?"verbunden":`abgelehnt: ${JSON.stringify(msg.payload?.response||{})}`);
      if(msg.event==="broadcast"&&msg.payload?.event==="fluss")aufMeldung(msg.payload.payload)};
    ws.onclose=()=>{clearInterval(herz);aufZustand("getrennt");if(!zu)wieder=setTimeout(verbinden,5000)};
    ws.onerror=()=>{};
  }
  verbinden();
  return()=>{zu=true;clearInterval(herz);clearTimeout(wieder);try{ws?.close()}catch{}};
}

// ---------------------------------------------- Überwachungsläufe (Zeile)
// Sollzeiten: wann ein Lauf spätestens wieder da sein muss. Überschreitung = gelb,
// doppelte Überschreitung = rot. Werte folgen den Cron-Zeitplänen in Supabase.
const LAEUFE=[
  {id:"system-check",name:"System-Check",soll_min:20,quelle:"kc_system_check_history"},
  {id:"mirror",name:"Spiegelung Supabase → Neon",soll_min:45,quelle:"Momentaufnahme"},
  {id:"backup",name:"Backup + Verify (Neon)",soll_min:26*60,quelle:"kc_backup_sets"},
  {id:"b2",name:"PC Backup Vault",soll_min:48*60,quelle:"Telemetrie"},
  {id:"programs",name:"Lebenszeichen der Programme",soll_min:null,quelle:"kicc_program_heartbeats"}
];
export function laeufeErmitteln(run,jetzt=Date.now()){
  const results=run?.results||[],byId=Object.fromEntries(results.map(r=>[r.id,r])),checked=Date.parse(run?.at||run?.checked_at||run?.checkedAt||"");
  return LAEUFE.map(l=>{
    const r=byId[l.id],st=String(r?.status||"");
    let letzte=null;
    if(l.id==="system-check")letzte=Number.isFinite(checked)?checked:null;
    else if(l.id==="mirror"&&Number.isFinite(r?.metrics?.age_min))letzte=jetzt-r.metrics.age_min*60000;
    else if(l.id==="backup"&&r?.metrics?.last_backup_at)letzte=Date.parse(r.metrics.last_backup_at);
    else if(l.id==="b2")letzte=r?.metrics?.last_backup_at?Date.parse(r.metrics.last_backup_at):r?.metrics?.machine_last_seen_at?Date.parse(r.metrics.machine_last_seen_at):null;
    const alterMin=Number.isFinite(letzte)?(jetzt-letzte)/60000:null;
    let cls=st==="critical"?"bad":st==="warning"?"warn":st==="healthy"?"ok":"idle";
    if(l.id==="system-check"&&letzte!=null)cls="ok"; // der Lauf selbst existiert - sein Ergebnis steht in den Kacheln
    let hinweis=r?.detail||(l.id==="system-check"?"":"nicht bewertet");
    if(l.soll_min!=null&&alterMin!=null){
      if(alterMin>2*l.soll_min&&cls!=="bad"){cls="bad";hinweis=`ausgeblieben · Sollzeit ${sollText(l.soll_min)} mehr als doppelt überschritten`}
      else if(alterMin>l.soll_min&&cls==="ok"){cls="warn";hinweis=`überfällig · Sollzeit ${sollText(l.soll_min)} überschritten`}
    }
    if(l.id==="system-check"&&!hinweis)hinweis=cls==="ok"?"planmäßig":hinweis;
    return{id:l.id,name:l.name,cls,letzte,alterMin,hinweis,quelle:l.quelle,soll:l.soll_min};
  });
}
const sollText=m=>m<60?`${m} min`:m<1440?`${Math.round(m/60)} h`:`${Math.round(m/1440)} T`;
export function laeufeHtml(liste){
  return liste.map(l=>`<div class="live-device ${l.cls==="bad"?"live-alert":""}"><span class="dot ${l.cls}"></span><div><strong>${l.name}</strong><div class="muted small">${l.letzte?`letzter Lauf ${vorText(Date.now()-l.letzte)}`:"kein Lauf bekannt"}${l.soll?` · Sollzeit ${sollText(l.soll)}`:""}${l.hinweis?` · ${l.hinweis}`:""}</div></div><span class="live-tag">${l.cls==="ok"?"OK":l.cls==="warn"?"ÜBERFÄLLIG":l.cls==="bad"?"AUSGEBLIEBEN":"OFFEN"}</span></div>`).join("");
}

// ---------------------------------------------- Einbau in den LIVE-Tab
let karte=null,abmelden=null,zustand="aus";
function panel(id,title,subtitle,vorSelector){
  let host=document.querySelector(id);if(host)return host;
  const anker=document.querySelector(vorSelector)?.closest("article");if(!anker)return null;
  const a=document.createElement("article");a.className="card";
  a.innerHTML=`<div class="row between"><div><h3>${title}</h3><div class="muted small">${subtitle}</div></div><span class="badge" id="${id.slice(1)}Badge">AUTO</span></div><div id="${id.slice(1)}" style="margin-top:8px"></div>`;
  anker.insertAdjacentElement("beforebegin",a);return document.querySelector(id);
}
export function renderDatenfluss(data,runtime){
  const host=panel("#kcdfKarte","Datenfluss","Wer spricht gerade mit wem · echte Zähler, keine Datenbankabfrage","#liveFlows");
  if(!host)return;
  if(!karte){karte=karteErzeugen(host);
    abmelden=broadcastAbonnieren(runtime,p=>{karte.meldung(p);karte.darstellen()},z=>{zustand=z;const b=document.querySelector("#kcdfKarteBadge");if(b){b.textContent=z==="verbunden"?"LIVE":z==="nicht konfiguriert"?"SCHNAPPSCHUSS":"GETRENNT";b.classList.toggle("live",z==="verbunden")}});
  }
  // Kanten aus dem Schnappschuss (Flow-Telemetrie der Programme, wie bisher)
  for(const f of data?.flows||[]){const zeit=Date.parse(f.measured_at||f.received_at||"");if(!Number.isFinite(zeit)||Date.now()-zeit>FENSTER_MS)continue;karte.kante(f.source_id||f.program_id,f.target_id,{req:Number(f.event_count||0),bytes:Number(f.byte_count||0),fehler:/error|fail/i.test(String(f.status||""))?1:0},`Flow-Telemetrie ${f.program_id||""}`.trim(),zeit)}
  // Lampen aus den Heartbeats: Programm lebt, auch wenn gerade nichts fließt
  const th=data?.thresholds||{},warn=Number(th.heartbeat_warn_seconds||90)*1000,crit=Number(th.heartbeat_critical_seconds||180)*1000;
  for(const h of data?.heartbeats||[]){const a=alter(h.measured_at||h.received_at);if(a==null)continue;karte.lampe(h.program_id,a<=warn?"ok":a<=crit?"warn":null)}
  // Backup-Kante aus der Telemetrie
  const b=data?.backup?.machine||data?.backup?.kicc;if(b?.last_backup_at){const zeit=Date.parse(b.last_backup_at);if(Number.isFinite(zeit)&&Date.now()-zeit<=FENSTER_MS)karte.kante("pc-backup",b.storage_target||b.backup_target||"b2",{req:1,bytes:Number(b.last_backup_stored_bytes||b.last_backup_bytes||0)},"Backup-Telemetrie",zeit)}
  karte.darstellen();

  const laufHost=panel("#kcdfLaeufe","Überwachungsläufe","Letzter Lauf, Ergebnis, Sollzeit · aus dem letzten Prüflauf","#liveFlows");
  if(laufHost){const run=state.lastRun||state.history?.at?.(-1)||null;laufHost.innerHTML=run?laeufeHtml(laeufeErmitteln(run)):`<div class="muted small">Noch kein Prüflauf im Speicher · ONE TOUCH ausführen.</div>`}
}
export function datenflussBeenden(){abmelden?.();abmelden=null;karte?.zerstoeren();karte=null}
