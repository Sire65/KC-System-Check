import{state,subscribe}from"./state.js";

const GROUPS=[
  {id:"systems",title:"Systeme",ids:["kc_core","future_academy","github","programs"]},
  {id:"failover",title:"Datenbank & Failover",ids:["mirror","neon","db_capacity"]},
  {id:"devices",title:"Kassen & Geräte",ids:["programs","device_health","kicc_devices","cash_registers"]},
  {id:"backup",title:"Backup & Sicherheit",ids:["b2","r2","oci","db_security","endpoint_exposure","key_lifetime"]}
];

function norm(status){
  const s=String(status||"").toLowerCase();
  if(s==="critical"||s==="bad")return"critical";
  if(s==="warning"||s==="warn")return"warning";
  if(s==="healthy"||s==="ok")return"healthy";
  if(s==="not_configured")return"not_configured";
  return"unknown";
}

function rank(status){return({critical:4,warning:3,unknown:2,not_configured:1,healthy:0})[status]??2}

function visual(status){
  if(status==="critical")return{cls:"bad",tag:"ROT",text:"Sofort prüfen"};
  if(status==="warning")return{cls:"warn",tag:"GELB",text:"Prüfung erforderlich"};
  if(status==="unknown")return{cls:"idle",tag:"HINWEIS",text:"Status unvollständig"};
  if(status==="not_configured")return{cls:"idle",tag:"INFO",text:"Noch nicht vollständig angebunden"};
  return{cls:"ok",tag:"GRÜN",text:"Betriebsbereit"};
}

function summarize(results,group){
  const rows=results.filter(r=>group.ids.includes(r?.id));
  if(!rows.length)return{status:"unknown",count:0,total:0};
  let worst="healthy";
  for(const row of rows){const s=norm(row.status);if(rank(s)>rank(worst))worst=s}
  const count=rows.filter(row=>rank(norm(row.status))>0).length;
  return{status:worst,count,total:rows.length};
}

function numberFrom(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n))return n}return null}
function minutesText(value){const n=numberFrom(value);if(n===null)return"Alter unbekannt";if(n<60)return`vor ${Math.max(0,Math.round(n))} min`;const h=n/60;if(h<48)return`vor ${h.toFixed(h<10?1:0).replace(".0","")} h`;return`vor ${Math.round(h/24)} T`}
function stateWord(row){const s=norm(row?.status);if(s==="healthy")return"OK";if(s==="warning")return"PRÜFEN";if(s==="critical")return"STÖRUNG";if(s==="not_configured")return"NICHT EINGERICHTET";return"UNBEKANNT"}

function failoverFacts(results){
  const primary=results.find(r=>r?.id==="kc_core")||null;
  const mirror=results.find(r=>r?.id==="mirror")||null;
  const neon=results.find(r=>r?.id==="neon")||null;
  const mismatch=numberFrom(mirror?.metrics?.mismatch_count,mirror?.mismatch_count);
  const age=numberFrom(mirror?.metrics?.age_min,mirror?.metrics?.age_minutes,mirror?.age_min);
  const openTables=numberFrom(mirror?.metrics?.open_tables,mirror?.metrics?.stale_tables);
  const mirrorReady=norm(mirror?.status)==="healthy"&&(mismatch===null||mismatch===0)&&(openTables===null||openTables===0);
  const neonReady=norm(neon?.status)==="healthy";
  const measured=Boolean(mirror&&neon);
  const ready=measured&&mirrorReady&&neonReady;
  const readiness=ready?"JA":measured?"NEIN":"NOCH NICHT BEWERTBAR";
  const detail=[];
  detail.push(`Primär Supabase: ${stateWord(primary)}`);
  detail.push(`Reserve Neon: ${stateWord(neon)}`);
  if(mirror){
    const bits=[`Spiegel: ${stateWord(mirror)}`];
    if(mismatch!==null)bits.push(`${mismatch} Abw.`);
    if(openTables!==null&&openTables>0)bits.push(`${openTables} offen`);
    if(age!==null)bits.push(minutesText(age));
    detail.push(bits.join(" · "));
  }else detail.push("Spiegel: noch keine Messung");
  return{ready,measured,readiness,detail};
}

function ensureHost(){
  const dashboard=document.querySelector("#dashboard");
  if(!dashboard)return null;
  let host=document.querySelector("#operationsOverview");
  if(host)return host;
  const article=document.createElement("article");
  article.className="card";
  article.id="operationsOverviewCard";
  article.innerHTML='<div class="row between"><div><div class="eyebrow">Schnellübersicht</div><h3>Betriebsübersicht</h3></div><span class="muted small">Details bleiben darunter vollständig erhalten</span></div><div id="operationsOverview" class="kc-ops-grid" style="margin-top:10px"></div>';
  dashboard.prepend(article);
  if(!document.querySelector("#kcOpsOverviewStyle")){
    const style=document.createElement("style");
    style.id="kcOpsOverviewStyle";
    style.textContent='.kc-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kc-ops-card{padding:12px;border:1px solid var(--line);border-radius:14px;background:#0e1728;min-width:0}.kc-ops-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.kc-ops-tag{font-size:10px;font-weight:800;padding:4px 7px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}.kc-ops-card strong{display:block;overflow-wrap:anywhere}.kc-ops-card .dot{margin-right:7px}.kc-ops-facts{display:grid;gap:4px;margin-top:9px;padding-top:8px;border-top:1px solid var(--line)}.kc-ops-fact{display:flex;justify-content:space-between;gap:10px;font-size:11px}.kc-ops-ready{font-weight:850;letter-spacing:.02em}@media(max-width:620px){.kc-ops-grid{grid-template-columns:1fr}.kc-ops-fact{display:block}}';
    document.head.appendChild(style);
  }
  return article.querySelector("#operationsOverview");
}

function appendFailover(card,results){
  const f=failoverFacts(results),facts=document.createElement("div");facts.className="kc-ops-facts";
  const readiness=document.createElement("div");readiness.className="kc-ops-fact";
  const label=document.createElement("span");label.className="muted";label.textContent="Failover bereit";
  const value=document.createElement("span");value.className="kc-ops-ready";value.textContent=f.readiness;
  readiness.append(label,value);facts.appendChild(readiness);
  for(const line of f.detail){const row=document.createElement("div");row.className="muted small";row.textContent=line;facts.appendChild(row)}
  card.appendChild(facts);
}

function render(){
  if(typeof document==="undefined")return;
  const host=ensureHost();
  if(!host)return;
  const run=state.lastRun||state.history?.at?.(-1)||state.history?.[state.history.length-1]||null;
  const results=Array.isArray(run?.results)?run.results:[];
  host.innerHTML="";
  for(const group of GROUPS){
    const sum=summarize(results,group),v=visual(sum.status),card=document.createElement("div");
    card.className="kc-ops-card";
    const head=document.createElement("div");head.className="kc-ops-head";
    const title=document.createElement("strong");
    const dot=document.createElement("span");dot.className=`dot ${v.cls}`;
    title.append(dot,document.createTextNode(group.title));
    const tag=document.createElement("span");tag.className="kc-ops-tag";tag.textContent=v.tag;
    head.append(title,tag);
    const detail=document.createElement("div");detail.className="muted small";detail.style.marginTop="6px";
    detail.textContent=sum.total?`${v.text}${sum.count?` · ${sum.count} auffällig`:""} · ${sum.total} Prüfungen`:`${v.text} · noch keine Messung`;
    card.append(head,detail);
    if(group.id==="failover")appendFailover(card,results);
    host.appendChild(card);
  }
}

if(typeof document!=="undefined")subscribe(render);
