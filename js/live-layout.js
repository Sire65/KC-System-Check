import{subscribe,latestRun}from"./state.js";
import{esc}from"./safe-html.js";

const $=s=>document.querySelector(s);
const TAB_KEY="kc-live-subtab-v1";
const FLOW_LIVE_MS=60_000;
const FLOW_RECENT_MS=10*60_000;
let currentState=null;
let activeTab="betrieb";
let observer=null;
let badgeObserver=null;
let rehomePending=false;

const ageMs=value=>{const n=Date.parse(value||"");return Number.isFinite(n)?Math.max(0,Date.now()-n):null};
const ageText=ms=>ms==null?"nie":ms<60_000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3_600_000?`vor ${Math.round(ms/60_000)} min`:ms<86_400_000?`vor ${(ms/3_600_000).toFixed(ms<10_800_000?1:0)} h`:`vor ${Math.round(ms/86_400_000)} T`;
const badStatus=value=>/error|fail|critical|down|corrupt/i.test(String(value||""));
const warnStatus=value=>/warn|degrad|partial/i.test(String(value||""));
const clsFromStatus=value=>badStatus(value)?"bad":warnStatus(value)?"warn":/ok|healthy|success|online|pass|verified/i.test(String(value||""))?"ok":"idle";

function injectCss(){
  if($("#kcLiveLayoutCss"))return;
  const style=document.createElement("style");
  style.id="kcLiveLayoutCss";
  style.textContent=`
    #live[data-locked="1"]>.kc-live-subtabs,#live[data-locked="1"]>.kc-live-subview{display:none!important}
    .kc-live-subtabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;position:sticky;top:74px;z-index:8;padding:6px;background:rgba(11,18,32,.94);backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:14px}
    .kc-live-subtab{min-width:0;padding:10px 7px;border:1px solid var(--line);border-radius:10px;background:#0e1728;color:var(--muted);font-weight:800;font-size:12px;white-space:nowrap}
    .kc-live-subtab.active{background:var(--card2);color:var(--text);border-color:#5aa7ff88}
    .kc-live-subview{display:grid;gap:11px}
    .kc-live-subview[hidden]{display:none!important}
    .kc-live-head-card #liveKpis{display:none!important}
    .kc-core-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px}
    .kc-core-state{font-size:12px;font-weight:850;padding:5px 9px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}
    .kc-core-state.ok{border-color:#2ecc7188;color:#8ff0b7}.kc-core-state.warn{border-color:#f3c34d88;color:#ffe08a}.kc-core-state.bad{border-color:#ef5a5a88;color:#ff9d9d}.kc-core-state.idle{color:var(--muted)}
    .kc-core-list{display:grid;margin-top:8px}
    .kc-core-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 1px;border-top:1px solid var(--line)}
    .kc-core-row:first-child{border-top:0}.kc-core-row strong{display:block;font-size:14px}.kc-core-row .muted{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .kc-core-tag{font-size:10px;font-weight:850;padding:4px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);white-space:nowrap}
    .kc-core-detail-btn{width:100%;margin-top:9px}
    .kc-flow-summary{display:grid;gap:8px;margin-top:9px}
    .kc-flow-row{display:grid;grid-template-columns:minmax(88px,1fr) minmax(72px,1.2fr) minmax(88px,1fr) auto;gap:8px;align-items:center;padding:11px;border:1px solid var(--line);border-radius:13px;background:#0e1728}
    .kc-flow-node{font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis}.kc-flow-node.to{text-align:right}
    .kc-flow-track{height:5px;border-radius:999px;background:#26344e;position:relative;overflow:hidden}.kc-flow-track.ok{background:#1d5039}.kc-flow-track.warn{background:#5e5128}.kc-flow-track.bad{background:#612b34}
    .kc-flow-track.moving::after{content:"";position:absolute;width:11px;height:11px;border-radius:50%;top:50%;left:-11px;transform:translateY(-50%);background:var(--ok);box-shadow:0 0 10px var(--ok);animation:kcFlowMove 1.35s linear infinite}
    .kc-flow-track.bad.moving::after{background:var(--bad);box-shadow:0 0 10px var(--bad)}
    @keyframes kcFlowMove{to{left:100%}}
    .kc-flow-meta{grid-column:1/-1;color:var(--muted);font-size:11px;margin-top:-3px}
    .kc-flow-tag{font-size:9px;font-weight:900;padding:4px 6px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}.kc-flow-tag.ok{border-color:#2ecc7166}.kc-flow-tag.warn{border-color:#f3c34d66}.kc-flow-tag.bad{border-color:#ef5a5a66}
    .kc-tech-intro{border-style:dashed}.kc-tech-intro p{margin:4px 0 0}
    @media(max-width:620px){.kc-live-subtabs{top:66px}.kc-live-subtab{font-size:11px;padding:9px 4px}.kc-flow-row{grid-template-columns:minmax(72px,1fr) 54px minmax(72px,1fr) auto;padding:10px 8px}.kc-flow-node{font-size:11px}.kc-core-row .muted{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}.kc-core-row{align-items:start}}
    @media(prefers-reduced-motion:reduce){.kc-flow-track.moving::after{animation:none;left:calc(50% - 5px)}}
  `;
  document.head.appendChild(style);
}

function createShell(){
  const live=$("#live");
  if(!live||$("#kcLiveSubtabs"))return;
  injectCss();
  const legacy=[...live.children].filter(el=>el.matches?.("article")&&el.id!=="kcLiveGate");
  const nav=document.createElement("nav");
  nav.id="kcLiveSubtabs";nav.className="kc-live-subtabs";nav.setAttribute("aria-label","LIVE-Bereiche");
  nav.innerHTML=`<button class="kc-live-subtab" type="button" data-kc-live-tab="betrieb">Leitstand</button><button class="kc-live-subtab" type="button" data-kc-live-tab="flows">Datenflüsse</button><button class="kc-live-subtab" type="button" data-kc-live-tab="technik">Technik & Tests</button>`;
  const betrieb=document.createElement("div");betrieb.id="kcLiveBetrieb";betrieb.className="kc-live-subview";
  const flows=document.createElement("div");flows.id="kcLiveFlowsView";flows.className="kc-live-subview";
  const tech=document.createElement("div");tech.id="kcLiveTechView";tech.className="kc-live-subview";
  live.append(nav,betrieb,flows,tech);
  for(const article of legacy)placeArticle(article);
  ensureCards();
  nav.addEventListener("click",event=>{const b=event.target.closest("[data-kc-live-tab]");if(b)setTab(b.dataset.kcLiveTab)});
  live.addEventListener("click",event=>{if(event.target.closest("[data-kc-go-tech]"))setTab("technik")});
  try{activeTab=localStorage.getItem(TAB_KEY)||"betrieb"}catch{activeTab="betrieb"}
  setTab(["betrieb","flows","technik"].includes(activeTab)?activeTab:"betrieb");
  observer=new MutationObserver(()=>scheduleRehome());
  observer.observe(live,{childList:true,subtree:true});
  renderAll();
}

function setTab(tab){
  activeTab=tab;
  const ids={betrieb:"#kcLiveBetrieb",flows:"#kcLiveFlowsView",technik:"#kcLiveTechView"};
  for(const [key,selector]of Object.entries(ids)){const el=$(selector);if(el)el.hidden=key!==tab}
  document.querySelectorAll("[data-kc-live-tab]").forEach(b=>b.classList.toggle("active",b.dataset.kcLiveTab===tab));
  try{localStorage.setItem(TAB_KEY,tab)}catch{}
}

function placeArticle(article){
  if(!article||article.id==="kcLiveGate"||article.dataset.kcLiveOwned==="1")return;
  if(article.querySelector("#liveKpis")){$("#kcLiveBetrieb")?.append(article);article.classList.add("kc-live-head-card");return}
  if(article.querySelector("#kcdfKarte")){$("#kcLiveFlowsView")?.append(article);return}
  if(article.querySelector("#livePrograms,#liveSales,#liveFlows,#liveApps,#liveBackup,#kcdfLaeufe")){$("#kcLiveTechView")?.append(article);return}
  $("#kcLiveTechView")?.append(article);
}

function scheduleRehome(){
  if(rehomePending)return;rehomePending=true;
  queueMicrotask(()=>{rehomePending=false;rehomeDynamic()});
}
function rehomeDynamic(){
  const live=$("#live");if(!live)return;
  for(const article of live.querySelectorAll("article")){
    if(article.id==="kcLiveGate"||article.dataset.kcLiveOwned==="1")continue;
    const target=article.querySelector("#kcdfKarte")?$("#kcLiveFlowsView"):article.querySelector("#liveKpis")?$("#kcLiveBetrieb"):article.querySelector("#livePrograms,#liveSales,#liveFlows,#liveApps,#liveBackup,#kcdfLaeufe")?$("#kcLiveTechView"):null;
    if(target&&article.parentElement!==target)target.append(article);
  }
  ensureCards();
  syncLegacyMapBadge();
}

function ensureCards(){
  const betrieb=$("#kcLiveBetrieb"),flows=$("#kcLiveFlowsView"),tech=$("#kcLiveTechView");
  if(betrieb&&!$("#kcLiveCore")){
    const a=document.createElement("article");a.id="kcLiveCore";a.dataset.kcLiveOwned="1";a.className="card";
    a.innerHTML=`<div class="kc-core-head"><div><div class="eyebrow">Nur das Wichtige</div><h3>Kernbetrieb</h3><div class="muted small">Fünf Punkte reichen für den täglichen Blick.</div></div><span id="kcLiveCoreState" class="kc-core-state idle">PRÜFE</span></div><div id="kcLiveCoreList" class="kc-core-list"></div><button type="button" class="secondary kc-core-detail-btn" data-kc-go-tech>Technische Details & Tests</button>`;
    const head=betrieb.querySelector("article:has(#liveKpis)");head?.insertAdjacentElement("afterend",a);if(!a.isConnected)betrieb.prepend(a);
  }
  if(flows&&!$("#kcLiveFlowOverview")){
    const a=document.createElement("article");a.id="kcLiveFlowOverview";a.dataset.kcLiveOwned="1";a.className="card";
    a.innerHTML=`<div class="row between"><div><div class="eyebrow">Echte Betriebsdaten</div><h3>Leitflüsse</h3><div class="muted small">Bewegung = Verkehr gerade jetzt. Eine ruhige Linie zeigt den letzten echten Kontakt.</div></div><span id="kcFlowOverall" class="badge">STATUS</span></div><div id="kcLiveFlowList" class="kc-flow-summary"></div>`;
    flows.prepend(a);
  }
  if(tech&&!$("#kcLiveTechIntro")){
    const a=document.createElement("article");a.id="kcLiveTechIntro";a.dataset.kcLiveOwned="1";a.className="card kc-tech-intro";
    a.innerHTML=`<div class="eyebrow">Diagnosebereich</div><h3>Technik & Tests</h3><p class="muted small">Hier liegen Detailtelemetrie, vorbereitete Anbindungen, Einzelprogramme, Test- und Wartungsanzeigen. Sie überladen den normalen Leitstand nicht mehr.</p>`;
    tech.prepend(a);
  }
}

function resultById(id){return(latestRun()?.results||[]).find(r=>r?.id===id)||null}
function row(label,detail,cls,tag){return`<div class="kc-core-row"><span class="dot ${cls}"></span><div><strong>${esc(label)}</strong><div class="muted small">${esc(detail)}</div></div><span class="kc-core-tag">${esc(tag)}</span></div>`}
function runCore(){
  const run=latestRun(),t=ageMs(run?.checkedAt||run?.checked_at||run?.at),raw=String(run?.overall_status||run?.status||"");
  if(t==null)return{label:"Systemprüfung",detail:"Noch kein Serverlauf bekannt",cls:"idle",tag:"OFFEN"};
  const cls=t>40*60_000?"bad":t>20*60_000?"warn":badStatus(raw)?"bad":warnStatus(raw)?"warn":"ok";
  return{label:"Systemprüfung",detail:`letzter Lauf ${ageText(t)}`,cls,tag:cls==="ok"?"OK":cls==="warn"?"PRÜFEN":"STÖRUNG"};
}
function mirrorCore(){
  const r=resultById("mirror"),flow=newestFlow("supabase","neon-mirror"),a=flow?ageMs(flow.measured_at||flow.received_at):null;
  const status=flow?.status||r?.status||"",mis=Number(r?.metrics?.mismatch_count??r?.metrics?.open_tables??0);
  let cls=badStatus(status)||mis>0?"bad":warnStatus(status)?"warn":r?.status==="healthy"||flow?"ok":"idle";
  if(a!=null&&a>90*60_000)cls="bad";else if(a!=null&&a>45*60_000&&cls==="ok")cls="warn";
  const detail=flow?`letzte Spiegelung ${ageText(a)}${mis?` · ${mis} Abweichung(en)`:" · 0 Abweichungen"}`:r?.detail||"Noch kein Spiegelstatus";
  return{label:"Spiegelung → Neon",detail,cls,tag:cls==="ok"?"OK":cls==="warn"?"PRÜFEN":cls==="bad"?"STÖRUNG":"OFFEN"};
}
function neonBackupCore(){
  const r=resultById("backup"),hours=Number(r?.metrics?.age_hours),status=String(r?.status||"");
  let cls=badStatus(status)?"bad":warnStatus(status)?"warn":status==="healthy"?"ok":"idle";
  if(Number.isFinite(hours)){if(hours>48)cls="bad";else if(hours>26&&cls==="ok")cls="warn"}
  const detail=Number.isFinite(hours)?`letzte geprüfte Sicherung vor ${hours.toFixed(hours<10?1:0)} h`:r?.detail||"Noch kein Sicherungsstatus";
  return{label:"Sicherung → Neon",detail,cls,tag:cls==="ok"?"OK":cls==="warn"?"PRÜFEN":cls==="bad"?"STÖRUNG":"OFFEN"};
}
function pbvCore(){
  const b=currentState?.live?.backup?.machine||currentState?.live?.backup?.kicc||{},a=ageMs(b.last_backup_at),tele=ageMs(b.measured_at||b.updated_at),status=b.last_backup_status||b.status||"";
  let cls=Object.keys(b).length?clsFromStatus(status):"idle";
  if(a!=null&&a>7*86_400_000)cls="bad";else if(a!=null&&a>48*3_600_000&&cls==="ok")cls="warn";
  if(tele!=null&&tele>36*3_600_000&&cls==="ok")cls="warn";
  const target=b.storage_target||b.backup_target||"B2",detail=a==null?"Noch kein Backup-Zeitpunkt":`${target} · letztes Backup ${ageText(a)}${tele!=null?` · Telemetrie ${ageText(tele)}`:""}`;
  return{label:"PC Backup Vault",detail,cls,tag:cls==="ok"?"OK":cls==="warn"?"PRÜFEN":cls==="bad"?"STÖRUNG":"OFFEN"};
}
function commCore(){
  const routes=currentState?.live?.communication?.provider_state?.routes||[],enabled=routes.filter(r=>r.enabled!==false);
  if(!enabled.length)return{label:"Kommunikation",detail:"Keine aktiven Providerdaten",cls:"idle",tag:"OFFEN"};
  const bad=enabled.some(r=>String(r.health_status).toLowerCase()==="down"||Number(r.consecutive_failures||0)>=3),warn=!bad&&enabled.some(r=>String(r.health_status).toLowerCase()!=="healthy");
  const cls=bad?"bad":warn?"warn":"ok",channels=enabled.map(r=>r.channel==="email"?"E-Mail":"Push").join(" + ");
  return{label:"Kommunikation",detail:`${channels} · ${bad?"Störung":warn?"Warnhinweis":"Provider erreichbar"}`,cls,tag:cls==="ok"?"OK":cls==="warn"?"PRÜFEN":"STÖRUNG"};
}
function renderCore(){
  const host=$("#kcLiveCoreList"),badge=$("#kcLiveCoreState");if(!host)return;
  const items=[runCore(),mirrorCore(),neonBackupCore(),pbvCore(),commCore()];host.innerHTML=items.map(x=>row(x.label,x.detail,x.cls,x.tag)).join("");
  const cls=items.some(x=>x.cls==="bad")?"bad":items.some(x=>x.cls==="warn")?"warn":items.every(x=>x.cls==="ok")?"ok":"idle";
  if(badge){badge.className=`kc-core-state ${cls}`;badge.textContent=cls==="ok"?"ALLES OK":cls==="warn"?"PRÜFEN":cls==="bad"?"STÖRUNG":"TEILWEISE OFFEN"}
}

function flowName(id){const s=String(id||"").toLowerCase();if(/kc[-_]?dp|dienstplan/.test(s))return"KC Dienstplan";if(/pc[-_]?backup|vault|pbv/.test(s))return"PC Backup Vault";if(/supabase|kc[-_]?core/.test(s))return"Supabase · KC Core";if(/neon[-_]?mirror|spiegel/.test(s))return"Neon · Spiegel";if(/neon/.test(s))return"Neon · Backup";if(/b2|backblaze/.test(s))return"Backblaze B2";if(/manager/.test(s))return"PC Manager";if(/kasse|markt|pos/.test(s))return"Kasse";if(/push/.test(s))return"Push";if(/email|mail|brevo/.test(s))return"E-Mail";return String(id||"Quelle")}
function newestFlow(from,to){
  const arr=currentState?.live?.flows||[];return arr.filter(f=>(!from||String(f.source_id||f.program_id)===from)&&(!to||String(f.target_id)===to)).sort((a,b)=>Date.parse(b.measured_at||b.received_at||0)-Date.parse(a.measured_at||a.received_at||0))[0]||null;
}
function flowRows(){
  const map=new Map();
  for(const f of currentState?.live?.flows||[]){const from=String(f.source_id||f.program_id||"Quelle"),to=String(f.target_id||"Ziel"),key=`${from}>${to}`,old=map.get(key);if(!old||Date.parse(f.measured_at||f.received_at||0)>Date.parse(old.measured_at||old.received_at||0))map.set(key,{...f,_from:from,_to:to,_kind:"flow"})}
  const routes=currentState?.live?.communication?.provider_state?.routes||[];
  for(const r of routes.filter(x=>x.enabled!==false)){const to=r.channel==="email"?"email":"push",t=r.last_success_at||r.last_failure_at||currentState?.live?.checked_at;map.set(`communication>${to}`,{_from:"KC Kommunikation",_to:to,_kind:"provider",flow_type:`${r.provider_id||"Provider"}`,status:r.health_status,measured_at:t,event_count:null,byte_count:null})}
  return[...map.values()].sort((a,b)=>Date.parse(b.measured_at||0)-Date.parse(a.measured_at||0));
}
function renderFlows(){
  const host=$("#kcLiveFlowList"),overall=$("#kcFlowOverall");if(!host)return;
  const rows=flowRows();if(!rows.length){host.innerHTML=`<div class="live-empty"><strong>Noch keine Leitflüsse messbar.</strong><div class="muted small">Die Ansicht bleibt neutral, bis echte Betriebsdaten vorliegen.</div></div>`;if(overall){overall.textContent="NOCH LEER";overall.classList.remove("live")}return}
  let anyBad=false,anyMoving=false;
  host.innerHTML=rows.map(f=>{const t=ageMs(f.measured_at||f.received_at),bad=badStatus(f.status),warn=!bad&&(warnStatus(f.status)||(t!=null&&t>FLOW_RECENT_MS)),moving=!bad&&t!=null&&t<=FLOW_LIVE_MS&&f._kind!=="provider",cls=bad?"bad":warn?"warn":"ok";anyBad||=bad;anyMoving||=moving;const tag=bad?"STÖRUNG":moving?"VERKEHR":f._kind==="provider"?"BEREIT":t!=null&&t<=FLOW_RECENT_MS?"LETZTER LAUF":"RUHE";const count=Number(f.event_count),bytes=Number(f.byte_count),parts=[f.flow_type||"Datenfluss",Number.isFinite(count)&&count>0?`${count} Ereignis${count===1?"":"se"}`:"",Number.isFinite(bytes)&&bytes>0?`${Math.round(bytes/1024*10)/10} KB`:"",t!=null?ageText(t):"Zeit unbekannt"].filter(Boolean).join(" · ");return`<div class="kc-flow-row"><div class="kc-flow-node">${esc(flowName(f._from))}</div><div class="kc-flow-track ${cls}${moving?" moving":""}" aria-hidden="true"></div><div class="kc-flow-node to">${esc(flowName(f._to))}</div><span class="kc-flow-tag ${cls}">${esc(tag)}</span><div class="kc-flow-meta">${esc(parts)}</div></div>`}).join("");
  if(overall){overall.textContent=anyBad?"STÖRUNG":anyMoving?"LIVE":"STATUS AKTUELL";overall.classList.toggle("live",!anyBad&&(anyMoving||rows.length>0))}
}

function syncLegacyMapBadge(){
  const badge=$("#kcdfKarteBadge");if(!badge)return;
  const active=(currentState?.live?.flows||[]).some(f=>{const a=ageMs(f.measured_at||f.received_at);return a!=null&&a<=FLOW_LIVE_MS&&!badStatus(f.status)});
  if(active){if(badge.textContent!=="LIVE")badge.textContent="LIVE";badge.classList.add("live");badge.title="Aktuelle Leitflussdaten aus dem Server-Schnappschuss. Realtime-Broadcast ist nur eine zusätzliche Quelle."}
  if(!badgeObserver){badgeObserver=new MutationObserver(()=>{if((currentState?.live?.flows||[]).some(f=>{const a=ageMs(f.measured_at||f.received_at);return a!=null&&a<=FLOW_LIVE_MS&&!badStatus(f.status)}))queueMicrotask(syncLegacyMapBadge)});badgeObserver.observe(badge,{childList:true,subtree:true,attributes:true})}
}
function renderAll(){renderCore();renderFlows();syncLegacyMapBadge()}

function boot(){createShell()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
subscribe(s=>{currentState=s;createShell();renderAll();scheduleRehome()});
