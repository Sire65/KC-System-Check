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
    style.textContent='.kc-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.kc-ops-card{padding:12px;border:1px solid var(--line);border-radius:14px;background:#0e1728;min-width:0}.kc-ops-head{display:flex;justify-content:space-between;gap:8px;align-items:center}.kc-ops-tag{font-size:10px;font-weight:800;padding:4px 7px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}.kc-ops-card strong{display:block;overflow-wrap:anywhere}.kc-ops-card .dot{margin-right:7px}@media(max-width:620px){.kc-ops-grid{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }
  return article.querySelector("#operationsOverview");
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
    card.append(head,detail);host.appendChild(card);
  }
}

if(typeof document!=="undefined")subscribe(render);
