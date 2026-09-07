import{state,subscribe}from"./state.js";

const TARGET_ORDER=["nas_backup","hidrive_1","hidrive_2"];
const LABELS={nas_backup:"NAS Backup",hidrive_1:"HiDrive 1",hidrive_2:"HiDrive 2"};
const DAY=86400000;

const finite=v=>Number.isFinite(Number(v))?Number(v):null;
const text=(v,max=180)=>v==null?"":String(v).slice(0,max);
const pick=(o,...keys)=>{for(const k of keys)if(o?.[k]!=null)return o[k];return null};

export function storageTargetsFromLive(live){
  const backup=live?.backup||{};
  const source=backup.machine&&Object.keys(backup.machine).length?backup.machine:backup.kicc||{};
  const raw=source.storage_targets??source.storageTargets??backup.storage_targets??backup.storageTargets??[];
  const rows=Array.isArray(raw)?raw:[];
  const byId=new Map(rows.filter(x=>x&&typeof x==="object").map(x=>[String(x.id||x.targetId||""),x]));
  return TARGET_ORDER.map(id=>{
    const row=byId.get(id);
    if(!row)return{id,name:LABELS[id],kind:id==="nas_backup"?"nas":"hidrive",status:"not_configured",latencyMs:null,checkedAt:null,lastSuccessAt:null,lastBackupAt:null,lastVerifyAt:null,lastRestoreTestAt:null,usageBytes:null,capacityBytes:null,detail:"Noch keine Ziel-Telemetrie vorhanden",detailCode:"NO_TELEMETRY"};
    const status=String(row.status||"unknown").toLowerCase();
    return{
      id,
      name:text(row.name||LABELS[id],80),
      kind:text(row.kind||(id==="nas_backup"?"nas":"hidrive"),24),
      status:["healthy","warning","critical","unknown","not_configured"].includes(status)?status:"unknown",
      latencyMs:finite(pick(row,"latencyMs","latency_ms")),
      checkedAt:pick(row,"checkedAt","checked_at","measuredAt","measured_at"),
      lastSuccessAt:pick(row,"lastSuccessAt","last_success_at"),
      lastBackupAt:pick(row,"lastBackupAt","last_backup_at"),
      lastVerifyAt:pick(row,"lastVerifyAt","last_verify_at"),
      lastRestoreTestAt:pick(row,"lastRestoreTestAt","last_restore_test_at"),
      usageBytes:finite(pick(row,"usageBytes","usage_bytes")),
      capacityBytes:finite(pick(row,"capacityBytes","capacity_bytes")),
      detail:text(row.detail,180),
      detailCode:text(pick(row,"detailCode","detail_code"),60),
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

function ageMs(value){const ts=Date.parse(value||"");return Number.isFinite(ts)?Math.max(0,Date.now()-ts):null}
function ageText(value){
  const ms=ageMs(value);if(ms==null)return"nie";const s=Math.round(ms/1000);
  if(s<60)return`vor ${s} s`;if(s<3600)return`vor ${Math.round(s/60)} min`;if(s<86400)return`vor ${Math.round(s/3600)} h`;return`vor ${Math.round(s/86400)} T`;
}
function bytes(n){const v=finite(n);if(v==null||v<0)return"—";if(v<1024)return`${v} B`;if(v<1024**2)return`${(v/1024).toFixed(1)} KB`;if(v<1024**3)return`${(v/1024**2).toFixed(1)} MB`;if(v<1024**4)return`${(v/1024**3).toFixed(1)} GB`;return`${(v/1024**4).toFixed(2)} TB`}
function capacity(row){if(row.usageBytes==null||row.capacityBytes==null||row.capacityBytes<=0)return null;const pct=Math.max(0,Math.min(100,row.usageBytes/row.capacityBytes*100));return{pct,free:Math.max(0,row.capacityBytes-row.usageBytes)}}
function effectiveVisual(row){
  const base=storageTargetVisual(row.status),age=ageMs(row.checkedAt);
  if(row.status==="not_configured")return{...base,reason:"Ziel ist noch nicht eingerichtet"};
  if(age==null)return{cls:"idle",tag:"KEINE MESSUNG",reason:"Es liegt noch keine gültige Messzeit vor"};
  if(age>DAY)return{cls:"idle",tag:"VERALTET",reason:`Letzte Messung ${ageText(row.checkedAt)}`};
  return{...base,reason:row.detail||"Kein Fehler gemeldet"};
}

function ensureHost(){
  let host=document.querySelector("#liveStorageTargets");if(host)return host;
  const backup=document.querySelector("#liveBackup")?.closest("article");if(!backup)return null;
  const article=document.createElement("article");article.className="card storage-pro-card";
  article.innerHTML='<div class="row between"><div><h3>Speicher & Backup</h3><div class="muted small">NAS und beide HiDrive-Ziele · Zustand, Alter, Prüfungen und Kapazität</div></div><span class="badge">LIVE</span></div><div id="liveStorageTargets" style="margin-top:10px"></div>';
  backup.insertAdjacentElement("afterend",article);return article.querySelector("#liveStorageTargets");
}

function targetHtml(row){
  const visual=effectiveVisual(row),cap=capacity(row),latency=row.latencyMs==null?"—":`${Math.round(row.latencyMs)} ms`;
  const backup=row.lastBackupAt?ageText(row.lastBackupAt):"keine Angabe",verify=row.lastVerifyAt?ageText(row.lastVerifyAt):"keine Angabe",restore=row.lastRestoreTestAt?ageText(row.lastRestoreTestAt):"keine Angabe";
  const capHtml=cap?`<div class="bar" style="margin-top:6px"><span style="width:${cap.pct.toFixed(1)}%"></span></div><div class="muted small">${cap.pct.toFixed(1)} % belegt · ${bytes(cap.free)} frei von ${bytes(row.capacityBytes)}</div>`:`<div class="muted small">Kapazität: keine verlässlichen Messwerte</div>`;
  return`<details class="live-history storage-target-detail" ${visual.cls==='bad'?'open':''}><summary class="live-device ${visual.cls==='bad'?'live-alert':''}" style="cursor:pointer;list-style:none"><span class="dot ${visual.cls}"></span><div><strong>${row.name}</strong><div class="muted small">${visual.reason} · Messung ${ageText(row.checkedAt)} · ${latency}</div></div><span class="live-tag">${visual.tag}</span></summary><div style="padding:10px 12px 14px 30px"><div class="live-kpis"><div class="live-kpi"><div class="muted small">Letzte Sicherung</div><div class="kpi" style="font-size:1rem">${backup}</div></div><div class="live-kpi"><div class="muted small">Letzte Prüfung</div><div class="kpi" style="font-size:1rem">${verify}</div></div><div class="live-kpi"><div class="muted small">Restore-Test</div><div class="kpi" style="font-size:1rem">${restore}</div></div><div class="live-kpi"><div class="muted small">Latenz</div><div class="kpi" style="font-size:1rem">${latency}</div></div></div><div style="margin-top:10px">${capHtml}</div><div class="muted small" style="margin-top:8px">Diagnose: ${row.detail||"keine technische Ursache gemeldet"}${row.detailCode?` · Code ${row.detailCode}`:""}</div></div></details>`;
}

function render(live){
  if(typeof document==="undefined")return;const host=ensureHost();if(!host)return;
  const rows=storageTargetsFromLive(live),views=rows.map(effectiveVisual),configured=rows.filter(r=>r.status!=="not_configured"),bad=views.filter(v=>v.cls==="bad").length,warn=views.filter(v=>v.cls==="warn").length,ok=views.filter(v=>v.cls==="ok").length;
  const headline=bad?`${bad} Speicherziel${bad===1?"":"e"} mit Störung`:warn?`${warn} Speicherziel${warn===1?"":"e"} mit Warnung`:configured.length&&ok===configured.length?"Alle eingerichteten Speicherziele aktuell in Ordnung":"Speicherstatus noch unvollständig";
  host.innerHTML=`<div class="live-kpi" style="margin-bottom:10px"><div class="muted small">Gesamtlage Speicher</div><div class="kpi" style="font-size:1.05rem">${headline}</div><div class="muted small">${ok} OK · ${warn} Warnung · ${bad} Störung · ${rows.length-configured.length} nicht eingerichtet</div></div>${rows.map(targetHtml).join("")}`;
}

if(typeof document!=="undefined")subscribe(s=>render(s.live));
