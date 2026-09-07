import{state,subscribe}from"./state.js";

const TARGET_ORDER=["nas_backup","hidrive_1","hidrive_2"];
const LABELS={nas_backup:"NAS Backup",hidrive_1:"HiDrive 1",hidrive_2:"HiDrive 2"};

export function storageTargetsFromLive(live){
  const backup=live?.backup||{};
  const source=backup.machine&&Object.keys(backup.machine).length?backup.machine:backup.kicc||{};
  const raw=source.storage_targets??source.storageTargets??backup.storage_targets??backup.storageTargets??[];
  const rows=Array.isArray(raw)?raw:[];
  const byId=new Map(rows.filter(x=>x&&typeof x==="object").map(x=>[String(x.id||""),x]));
  return TARGET_ORDER.map(id=>{
    const row=byId.get(id);
    if(!row)return{id,name:LABELS[id],kind:id==="nas_backup"?"nas":"hidrive",status:"not_configured",latencyMs:null,checkedAt:null,detail:"Noch keine Ziel-Telemetrie vorhanden"};
    const status=String(row.status||"unknown").toLowerCase();
    return{
      id,
      name:String(row.name||LABELS[id]).slice(0,80),
      kind:String(row.kind|| (id==="nas_backup"?"nas":"hidrive")).slice(0,24),
      status:["healthy","warning","critical","unknown","not_configured"].includes(status)?status:"unknown",
      latencyMs:Number.isFinite(Number(row.latencyMs??row.latency_ms))?Number(row.latencyMs??row.latency_ms):null,
      checkedAt:row.checkedAt??row.checked_at??null,
      detail:String(row.detail||"").slice(0,180),
    };
  });
}

export function storageTargetVisual(status){
  const s=String(status||"unknown").toLowerCase();
  if(s==="healthy")return{cls:"ok",tag:"OK"};
  if(s==="warning")return{cls:"warn",tag:"WARNUNG"};
  if(s==="critical")return{cls:"bad",tag:"STÖRUNG"};
  if(s==="not_configured")return{cls:"idle",tag:"NICHT EINGERICHTET"};
  return{cls:"idle",tag:"UNBEKANNT"};
}

function ageText(value){
  const ts=Date.parse(value||"");
  if(!Number.isFinite(ts))return"noch keine Messung";
  const s=Math.max(0,Math.round((Date.now()-ts)/1000));
  if(s<60)return`vor ${s} s`;
  if(s<3600)return`vor ${Math.round(s/60)} min`;
  if(s<86400)return`vor ${Math.round(s/3600)} h`;
  return`vor ${Math.round(s/86400)} T`;
}

function ensureHost(){
  let host=document.querySelector("#liveStorageTargets");
  if(host)return host;
  const backup=document.querySelector("#liveBackup")?.closest("article");
  if(!backup)return null;
  const article=document.createElement("article");
  article.className="card";
  article.innerHTML='<div class="row between"><div><h3>Speicherziele</h3><div class="muted small">NAS und beide HiDrive-Ziele · nur Status, keine Zugangsdaten oder Pfade</div></div><span class="badge">LIVE</span></div><div id="liveStorageTargets" style="margin-top:8px"></div>';
  backup.insertAdjacentElement("afterend",article);
  return article.querySelector("#liveStorageTargets");
}

function render(live){
  if(typeof document==="undefined")return;
  const host=ensureHost();
  if(!host)return;
  const rows=storageTargetsFromLive(live);
  host.innerHTML=rows.map(row=>{
    const visual=storageTargetVisual(row.status);
    const latency=row.latencyMs==null?"":` · ${Math.round(row.latencyMs)} ms`;
    const detail=row.detail|| (row.status==="not_configured"?"Ziel noch nicht eingerichtet":"Kein Detail gemeldet");
    return`<div class="live-device ${visual.cls==='bad'?'live-alert':''}"><span class="dot ${visual.cls}"></span><div><strong>${row.name}</strong><div class="muted small">${detail} · ${ageText(row.checkedAt)}${latency}</div></div><span class="live-tag">${visual.tag}</span></div>`;
  }).join("");
}

if(typeof document!=="undefined")subscribe(s=>render(s.live));
