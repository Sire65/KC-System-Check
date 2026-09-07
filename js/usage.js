import{state,subscribe}from"./state.js";
export function formatBytes(n=0){n=Number(n)||0;const sign=n<0?"-":"";n=Math.abs(n);if(n<1024)return`${sign}${Math.round(n)} B`;if(n<1048576)return`${sign}${(n/1024).toFixed(1)} KB`;if(n<1073741824)return`${sign}${(n/1048576).toFixed(1)} MB`;return`${sign}${(n/1073741824).toFixed(2)} GB`}
function points(history=[],systemId){return history.map(r=>{const x=(r.results||[]).find(v=>v.id===systemId),b=Number(x?.metrics?.database_bytes),t=Date.parse(r.checked_at||r.at);return Number.isFinite(t)&&Number.isFinite(b)&&b>0?{t,b}:null}).filter(Boolean).sort((a,b)=>a.t-b.t)}
export function growthWindow(history=[],systemId,days=1){const p=points(history,systemId);if(p.length<2)return null;const z=p.at(-1),target=z.t-days*86400000,candidates=p.filter(x=>x.t<=target);if(!candidates.length)return null;const a=candidates.at(-1),span=Math.max(.001,(z.t-a.t)/86400000);return{bytes:z.b-a.b,perDay:(z.b-a.b)/span,spanDays:span}}
export function capacityTrend(history=[],systemId){const p=points(history,systemId);if(p.length<2)return{growthPerDay:null,daysToLimit:null};const a=p[0],z=p.at(-1),days=Math.max(.001,(z.t-a.t)/86400000),growth=(z.b-a.b)/days,limit=500*1024*1024;return{growthPerDay:growth,daysToLimit:growth>0?Math.max(0,Math.round((limit-z.b)/growth)):null}}
// Der Server darf Pruefungen liefern, die die App lokal nicht kennt. Sie
// erscheinen dann automatisch, statt unsichtbar zu bleiben.
export function mergeSystems(systems=[],results=[]){
  const known=new Set(systems.map(s=>s.id));
  const extra=[];
  for(const r of results){
    if(!r?.id||known.has(r.id))continue;
    known.add(r.id);
    extra.push({id:r.id,name:r.name||r.id,kind:r.kind||"service",enabled:true,serverOnly:true});
  }
  return [...systems,...extra];
}
export function statusClass(status){return status==="healthy"||status==="ok"?"ok":status==="warning"||status==="warn"?"warn":status==="critical"||status==="bad"?"bad":"idle"}
export function overallStatus(results=[]){if(results.some(r=>["critical","bad"].includes(r.status)))return"bad";if(results.some(r=>["warning","warn"].includes(r.status)))return"warn";if(!results.some(r=>["healthy","ok"].includes(r.status)))return"unknown";return"ok"}
// ============================================================================
// Speicherziele live (frueher js/storage-backup-live.js). Eingebettet in usage.js (reines, in Node testbares Modul), weil der
// Pages-Workflow eine feste Kopierliste hat - eine neue Datei laedt dort nicht,
// und ein fehlender Import laesst die ganze App leer (so bei v0.7.30).
// ============================================================================

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
