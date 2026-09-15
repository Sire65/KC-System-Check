import{state,subscribe}from"./state.js";

const MARKET_START=new Date(2026,11,4);
const MARKET_END=new Date(2026,11,14);
const MARKET_LABEL="04.–13.12.2026";
const FRESH_MS=180000;
const ageMs=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?Math.max(0,Date.now()-t):null};
const ageText=ms=>ms===null?"Zeit unbekannt":ms<60000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3600000?`vor ${Math.round(ms/60000)} min`:ms<86400000?`vor ${Math.round(ms/3600000)} h`:`vor ${Math.round(ms/86400000)} T`;
const fresh=h=>{const a=ageMs(h?.measured_at||h?.received_at);return a!==null&&a<=FRESH_MS};
const norm=v=>{const s=String(v||"").toLowerCase();if(["healthy","ok"].includes(s))return"healthy";if(["warning","warn"].includes(s))return"warning";if(["critical","bad"].includes(s))return"critical";if(s==="not_configured")return"not_configured";return"unknown"};
function latestRun(){return state.lastRun||state.history?.at?.(-1)||state.history?.[state.history.length-1]||null}
function liveData(){const x=state.live||{};return x.live&&typeof x.live==="object"?x.live:x}
function heartbeats(){return Array.isArray(liveData()?.heartbeats)?liveData().heartbeats:[]}
function resultById(id){const run=latestRun(),rows=Array.isArray(run?.results)?run.results:[];return rows.find(r=>r?.id===id)||null}
function statusText(row){const s=norm(row?.status);if(s==="healthy")return"OK";if(s==="warning")return"PRÜFEN";if(s==="critical")return"STÖRUNG";if(s==="not_configured")return"VORBEREITET";return"UNBEKANNT"}
function hbState(h){
  if(!h)return"TELEMETRIE VORBEREITET";
  const age=ageMs(h?.measured_at||h?.received_at),raw=String(h?.status||"").toUpperCase();
  if(!fresh(h))return`NICHT AKTIV · ${ageText(age)}`;
  if(["DEGRADED","WARNING","WARN"].includes(raw))return`PRÜFEN · ${ageText(age)}`;
  if(["ERROR","FAILED","CRITICAL","BAD","OFFLINE"].includes(raw))return`STÖRUNG · ${ageText(age)}`;
  return`OK · ${ageText(age)}`;
}
function latestMatches(rx){
  const map=new Map();
  for(const h of heartbeats()){
    if(!rx.test(String(h?.program_id||"")))continue;
    const key=String(h?.instance_id||h?.source_id||h?.program_id||"");
    const old=map.get(key);
    const nt=Date.parse(h?.measured_at||h?.received_at||0),ot=Date.parse(old?.measured_at||old?.received_at||0);
    if(!old||nt>ot)map.set(key,h);
  }
  return[...map.values()].sort((a,b)=>Date.parse(b?.measured_at||b?.received_at||0)-Date.parse(a?.measured_at||a?.received_at||0));
}
function row(label,value){const d=document.createElement("div");d.className="kc-ops-fact";const a=document.createElement("span");a.className="muted";a.textContent=label;const b=document.createElement("span");b.textContent=value;d.append(a,b);return d}
function ensureBox(host){let box=host.querySelector("#marketModeInfo");if(box)return box;box=document.createElement("div");box.id="marketModeInfo";box.className="kc-ops-facts";box.style.marginTop="10px";host.appendChild(box);return box}
function render(){
  if(typeof document==="undefined")return;
  const host=document.querySelector("#operationsOverviewCard");if(!host)return;
  const box=ensureBox(host),now=new Date();box.innerHTML="";
  const phase=now<MARKET_START?"Vorbereitung":now<MARKET_END?"AKTIV":"Abgeschlossen";
  box.append(row("Marktbetrieb",`${phase} · ${MARKET_LABEL}`));
  if(now>=MARKET_END){const note=document.createElement("div");note.className="muted small";note.textContent="Die Marktkomponenten werden außerhalb des Marktzeitraums nicht als Pflichtbetrieb bewertet.";box.append(note);return}
  box.append(row("Supabase",statusText(resultById("kc_core"))));
  box.append(row("Neon",statusText(resultById("neon"))));
  box.append(row("Spiegelung",statusText(resultById("mirror"))));

  const managers=latestMatches(/manager/i);
  box.append(row("PC Manager",hbState(managers[0]||null)));

  const kassen=latestMatches(/kasse|markt|pos/i);
  box.append(row("Kasse 1",hbState(kassen[0]||null)));
  box.append(row("Kasse 2",hbState(kassen[1]||null)));
  if(kassen.length>2)box.append(row("Weitere Kassen",`${kassen.length-2} zusätzliche Instanz(en) erkannt`));

  box.append(row("Router / Internet","TELEMETRIE VORBEREITET"));
  box.append(row("Bondrucker","TELEMETRIE VORBEREITET"));
  box.append(row("Money Butler","TELEMETRIE VORBEREITET"));
  const note=document.createElement("div");note.className="muted small";note.textContent="Kasse 1/2 und PC Manager werden aus eindeutigen Heartbeat-Instanzen abgeleitet. Frisch = maximal 3 Minuten. Fehlende Telemetrie bleibt neutral und erzeugt noch keinen Alarm.";box.append(note);
}
if(typeof document!=="undefined")subscribe(render);
