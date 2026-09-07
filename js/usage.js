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
// Speicherziele live. Absichtlich in usage.js eingebettet, weil der Pages-
// Workflow eine feste Kopierliste hat. Nur technische Telemetrie; keine
// Zugangsdaten, Benutzernamen oder Pfade werden dargestellt.
// ============================================================================

const TARGET_ORDER=["nas_backup","hidrive_1","hidrive_2"];
const LABELS={nas_backup:"NAS Backup",hidrive_1:"HiDrive 1",hidrive_2:"HiDrive 2"};
const STALE_SECONDS=6*60*60;

const num=(...values)=>{for(const v of values){const n=Number(v);if(Number.isFinite(n)&&n>=0)return n}return null};
const text=(value,max=180)=>String(value??"").slice(0,max);

export function storageTargetsFromLive(live){
  const backup=live?.backup||{};
  const source=backup.machine&&Object.keys(backup.machine).length?backup.machine:backup.kicc||{};
  const raw=source.storage_targets??source.storageTargets??backup.storage_targets??backup.storageTargets??[];
  const rows=Array.isArray(raw)?raw:[];
  const byId=new Map(rows.filter(x=>x&&typeof x==="object").map(x=>[String(x.id||""),x]));
  return TARGET_ORDER.map(id=>{
    const row=byId.get(id);
    if(!row)return{id,name:LABELS[id],kind:id==="nas_backup"?"nas":"hidrive",status:"not_configured",latencyMs:null,checkedAt:null,detail:"Noch keine Ziel-Telemetrie vorhanden",detailCode:"",lastBackupAt:null,lastVerifyAt:null,lastRestoreAt:null,totalBytes:null,freeBytes:null,usedBytes:null};
    const rawStatus=String(row.status||"unknown").toLowerCase();
    const checkedAt=row.checkedAt??row.checked_at??row.measuredAt??row.measured_at??null;
    const age=checkedAt?Math.max(0,(Date.now()-Date.parse(checkedAt))/1000):null;
    let status=["healthy","warning","critical","unknown","not_configured"].includes(rawStatus)?rawStatus:"unknown";
    if(status==="healthy"&&(!Number.isFinite(age)||age>STALE_SECONDS))status="unknown";
    return{
      id,
      name:text(row.name||LABELS[id],80),
      kind:text(row.kind|| (id==="nas_backup"?"nas":"hidrive"),24),
      status,
      latencyMs:num(row.latencyMs,row.latency_ms),
      checkedAt,
      detail:text(row.detail||row.message||"",180),
      detailCode:text(row.detailCode??row.detail_code??row.code??"",80),
      lastBackupAt:row.lastBackupAt??row.last_backup_at??null,
      lastVerifyAt:row.lastVerifyAt??row.last_verify_at??row.last_integrity_at??null,
      lastRestoreAt:row.lastRestoreAt??row.last_restore_at??row.last_restore_test_at??null,
      totalBytes:num(row.totalBytes,row.total_bytes,row.capacityBytes,row.capacity_bytes),
      freeBytes:num(row.freeBytes,row.free_bytes, row.availableBytes,row.available_bytes),
      usedBytes:num(row.usedBytes,row.used_bytes),
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
function stamp(label,value){return`<div><span class="muted small">${label}</span><strong>${value?ageText(value):"—"}</strong></div>`}
function capacity(row){
  let total=row.totalBytes,free=row.freeBytes,used=row.usedBytes;
  if(total!=null&&used==null&&free!=null)used=Math.max(0,total-free);
  if(total==null||total<=0)return"Keine verlässlichen Kapazitätsdaten";
  const pct=used==null?null:Math.min(100,Math.max(0,used/total*100));
  return`${free==null?"frei —":`frei ${formatBytes(free)}`} · gesamt ${formatBytes(total)}${pct==null?"":` · ${pct.toFixed(1)} % belegt`}`;
}
function overallStorage(rows){
  if(rows.some(x=>x.status==="critical"))return{cls:"bad",label:"Störung",text:"Mindestens ein Speicherziel meldet eine Störung."};
  if(rows.some(x=>x.status==="warning"))return{cls:"warn",label:"Prüfen",text:"Mindestens ein Speicherziel meldet eine Warnung."};
  if(rows.some(x=>x.status==="unknown"))return{cls:"idle",label:"Unvollständig",text:"Mindestens ein Status fehlt oder ist veraltet."};
  if(rows.every(x=>x.status==="not_configured"))return{cls:"idle",label:"Noch nicht eingerichtet",text:"Es liegen noch keine Zielmessungen vor."};
  if(rows.some(x=>x.status==="not_configured"))return{cls:"idle",label:"Teilweise eingerichtet",text:"Mindestens ein Speicherziel ist noch nicht eingerichtet."};
  return{cls:"ok",label:"Speicher gesund",text:"Alle eingerichteten Speicherziele melden aktuelle, unauffällige Werte."};
}

function ensureHost(){
  let host=document.querySelector("#liveStorageTargets");
  if(host)return host;
  const backup=document.querySelector("#liveBackup")?.closest("article");
  if(!backup)return null;
  const article=document.createElement("article");
  article.className="card";
  article.innerHTML='<div class="row between"><div><h3>Speicher-Leitstand</h3><div class="muted small">NAS und beide HiDrive-Ziele · technische Read-only-Telemetrie</div></div><span class="badge">LIVE</span></div><div id="liveStorageTargets" style="margin-top:8px"></div>';
  backup.insertAdjacentElement("afterend",article);
  return article.querySelector("#liveStorageTargets");
}

function render(live){
  if(typeof document==="undefined")return;
  const host=ensureHost();
  if(!host)return;
  const rows=storageTargetsFromLive(live),overall=overallStorage(rows);
  host.innerHTML=`<div class="live-kpi" style="margin-bottom:10px"><span class="dot ${overall.cls}"></span><div class="muted small">Gesamtlage Speicher</div><div class="kpi">${overall.label}</div><div class="muted small">${overall.text}</div></div>`+rows.map(row=>{
    const visual=storageTargetVisual(row.status),latency=row.latencyMs==null?"—":`${Math.round(row.latencyMs)} ms`;
    const detail=row.detail|| (row.status==="not_configured"?"Ziel noch nicht eingerichtet":"Kein technisches Detail gemeldet");
    return`<details class="live-history" style="margin-top:8px" ${visual.cls==='bad'?'open':''}><summary class="live-device ${visual.cls==='bad'?'live-alert':''}" style="cursor:pointer"><span class="dot ${visual.cls}"></span><div><strong>${row.name}</strong><div class="muted small">${detail} · ${ageText(row.checkedAt)}</div></div><span class="live-tag">${visual.tag}</span></summary><div class="live-kpis" style="margin-top:8px"><div class="live-kpi"><div class="muted small">Letzte Messung</div><div class="kpi">${ageText(row.checkedAt)}</div><div class="muted small">Latenz ${latency}</div></div><div class="live-kpi"><div class="muted small">Kapazität</div><div class="kpi">${row.totalBytes==null?"—":formatBytes(row.totalBytes)}</div><div class="muted small">${capacity(row)}</div></div></div><div class="live-kpis" style="margin-top:8px">${stamp("Letzte Sicherung",row.lastBackupAt)}${stamp("Letzte Prüfung",row.lastVerifyAt)}${stamp("Restore-Test",row.lastRestoreAt)}</div>${row.detailCode?`<div class="muted small" style="margin-top:8px">Diagnosecode: ${row.detailCode}</div>`:""}</details>`;
  }).join("");
}

if(typeof document!=="undefined")subscribe(s=>render(s.live));
