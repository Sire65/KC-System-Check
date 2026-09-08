import{state,publish}from"./state.js";
import{loadRemoteHistory}from"./adapters/live.js";

// Der LIVE-Bereich "Überwachungsläufe" wurde bisher aus state.lastRun gespeist.
// state.lastRun ist lokaler Browser-Zustand und kann Stunden alt sein, obwohl der
// serverseitige 15-Minuten-Cron längst neue Läufe in kc_system_check_history
// geschrieben hat. Das erzeugte die falsche rote Meldung "AUSGEBLIEBEN".
//
// Wir halten den lokalen Referenzlauf deshalb mit dem jüngsten Serverlauf gleich.
// Gleichzeitig normalisieren wir den Namen des Backup-Zeitstempels: der
// System-Check liefert last_ok_at, die Laufanzeige erwartet last_backup_at.
const POLL_MS=5*60*1000;
let busy=false;

function ts(v){const n=Date.parse(v||"");return Number.isFinite(n)?n:null}
function newestHistory(rows){return [...(rows||[])].sort((a,b)=>(ts(b.checked_at||b.at)||0)-(ts(a.checked_at||a.at)||0))[0]||null}

function normalizeResult(r){
  if(!r||typeof r!=="object")return r;
  if(r.id!=="backup")return r;
  const m={...(r.metrics||{})};
  if(!m.last_backup_at&&m.last_ok_at)m.last_backup_at=m.last_ok_at;
  return{...r,metrics:m};
}

function normalizeRun(raw){
  if(!raw)return null;
  const at=raw.at||raw.checked_at||raw.checkedAt||null;
  return{
    ...raw,
    at,
    checked_at:raw.checked_at||at,
    status:raw.status||raw.overall_status||"unknown",
    results:(raw.results||[]).map(normalizeResult)
  };
}

function newerThanLocal(run){
  const remoteAt=ts(run?.at||run?.checked_at),localAt=ts(state.lastRun?.at||state.lastRun?.checked_at||state.lastRun?.checkedAt);
  return remoteAt!==null&&(localAt===null||remoteAt>localAt);
}

function patchProgramRow(){
  const host=document.querySelector("#kcdfLaeufe");
  if(!host)return;
  for(const row of host.querySelectorAll(".live-device")){
    const title=row.querySelector("strong")?.textContent?.trim();
    if(title!=="Lebenszeichen der Programme")continue;
    const detail=row.querySelector(".muted.small");
    if(detail&&detail.textContent?.startsWith("kein Lauf bekannt"))
      detail.textContent=detail.textContent.replace(/^kein Lauf bekannt/,"kein eigener Lauf · Bewertung im System-Check");
  }
}

async function sync(){
  if(busy||document.visibilityState==="hidden")return;
  if(state.runtime?.mode!=="live"||!state.runtime?.apiBaseUrl)return;
  busy=true;
  try{
    const remote=await loadRemoteHistory(state.runtime);
    const run=normalizeRun(newestHistory(remote?.history));
    if(run&&newerThanLocal(run)){
      state.lastRun=run;
      publish();
    }else if(state.lastRun){
      // Auch ein bereits aktueller lokaler Lauf braucht die Backup-Alias-Korrektur.
      state.lastRun={...state.lastRun,results:(state.lastRun.results||[]).map(normalizeResult)};
    }
  }catch{/* LIVE-Leitstand soll bei einem einzelnen History-Fehler weiterlaufen */}
  finally{busy=false;setTimeout(patchProgramRow,0)}
}

const observer=new MutationObserver(()=>patchProgramRow());
function start(){
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(sync,400);
  setInterval(sync,POLL_MS);
  setInterval(patchProgramRow,5000);
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")sync()});
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
