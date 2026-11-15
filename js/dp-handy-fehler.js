// KC-SC-DP-HANDYFEHLER (0.10.8, 15.11.2026, Freigabe Hansi): Fehlerampel fuer die
// Dienstplan-App auf Mitglieder-Handys. Ersetzt die nie eingebaute Ampel aus dem
// Kassen-PC-Manager (Kasse, feature/kc-dp-error-monitor) - hier gibt es Anmeldung,
// Laufzeitkonfiguration und Systemmonitor schon (Regel 3: bestehende Kerne nutzen).
//
// - Quelle: RPC kc_dp_error_admin_list_v2 (erlaubt nur Dienstplan-Rollen planner,
//   duty_manager, admin); ohne Anmeldung oder Rolle: UNBEKANNT, nie OK (Regel 11).
// - Sparsam: hoechstens alle 5 Minuten und nur bei sichtbarem Fenster.
// - Datenschutz: nur Zahlen und Fehlercodes; keine Namen, Geraete-IDs oder Fehlertexte.
import{loadRuntimeConfig}from"./runtime-config.js";
import{sessionToken,projectBaseUrl,onSessionChange}from"./session.js";

export const REFRESH_MS=5*60*1000;
export const STALE_MS=15*60*1000;
const RPC="kc_dp_error_admin_list_v2";

// Reine Auswertung (getestet in tests/dp-handy-fehler.test.js).
export function summarize(rows){
  const list=Array.isArray(rows)?rows:[];
  const open=list.filter(r=>r&&["new","reviewed"].includes(String(r.status||"")));
  const critical=open.filter(r=>r.severity==="critical").length;
  const errors=open.filter(r=>r.severity==="error").length;
  const occurrences=open.reduce((n,r)=>n+Math.max(1,Number(r.occurrence_count)||1),0);
  const devices=new Set(open.map(r=>r.device_id).filter(Boolean)).size;
  const codes=new Map();
  for(const r of open){const c=String(r.error_code||"ohne Code").slice(0,60);codes.set(c,(codes.get(c)||0)+Math.max(1,Number(r.occurrence_count)||1))}
  const topCodes=[...codes.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([code,count])=>({code,count}));
  const status=critical||errors?"critical":open.length?"warning":"healthy";
  return{status,open:open.length,critical,errors,occurrences,devices,topCodes};
}

// Zustand -> Anzeige. Alles ausser einer frischen, erfolgreichen Messung ist UNBEKANNT/VERALTET.
export function view(state,now=Date.now()){
  if(!state||state.kind==="idle")return{cls:"idle",tag:"UNBEKANNT",text:"Noch nicht geprüft"};
  if(state.kind==="login")return{cls:"idle",tag:"UNBEKANNT",text:"Anmeldung am Leitstand nötig, um Handy-Fehler zu sehen"};
  if(state.kind==="forbidden")return{cls:"idle",tag:"UNBEKANNT",text:"Keine Dienstplan-Rolle (Planer, Dienstleitung oder Admin) – Handy-Fehler nicht sichtbar"};
  if(state.kind==="error")return{cls:"idle",tag:"UNBEKANNT",text:`Abfrage fehlgeschlagen${state.detail?` (${state.detail})`:""}`};
  const s=state.summary,age=now-Number(state.at||0);
  if(age>STALE_MS)return{cls:"idle",tag:"VERALTET",text:`Letzte Messung vor ${Math.round(age/60000)} Min.`};
  if(s.status==="healthy")return{cls:"ok",tag:"OK",text:"Keine offenen Handy-Fehler"};
  const parts=[`${s.open} offene Fehlerbild${s.open===1?"":"er"}`,`${s.occurrences} Vorkommnis${s.occurrences===1?"":"se"}`,`${s.devices} Gerät${s.devices===1?"":"e"}`];
  if(s.topCodes.length)parts.push(s.topCodes.map(c=>`${c.code} ${c.count}×`).join(", "));
  return s.status==="critical"
    ?{cls:"bad",tag:`${s.critical+s.errors} FEHLER`,text:parts.join(" · ")}
    :{cls:"warn",tag:"WARNUNG",text:parts.join(" · ")};
}

let state={kind:"idle"},loading=false,lastAttempt=0;

async function refresh(force=false){
  if(loading||typeof document==="undefined"||document.hidden)return;
  if(!force&&Date.now()-lastAttempt<REFRESH_MS)return;
  loading=true;lastAttempt=Date.now();
  try{
    const token=sessionToken();
    if(!token){state={kind:"login"};return}
    const config=await loadRuntimeConfig(),base=await projectBaseUrl();
    if(!base||!config?.apiToken){state={kind:"error",detail:"Live-Konfiguration fehlt"};return}
    const r=await fetch(`${base}/rest/v1/rpc/${RPC}`,{method:"POST",cache:"no-store",
      headers:{apikey:config.apiToken,Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({p_limit:200})});
    const text=await r.text();
    if(!r.ok){state=/forbidden/i.test(text)?{kind:"forbidden"}:{kind:"error",detail:`HTTP ${r.status}`};return}
    state={kind:"ok",at:Date.now(),summary:summarize(text?JSON.parse(text):[])};
  }catch{state={kind:"error",detail:"keine Verbindung"}}
  finally{loading=false;render()}
}

function findCard(){
  return [...document.querySelectorAll("#operationsOverview .kc-ops-card")]
    .find(c=>c.textContent?.includes("Kassen & Geräte"))||null;
}

function render(){
  if(typeof document==="undefined")return;
  const card=findCard();if(!card)return;
  card.querySelector(".kc-dp-handyfehler")?.remove();
  const v=view(state);
  const box=document.createElement("div");box.className="kc-dp-handyfehler";
  box.style.marginTop="8px";box.style.paddingTop="8px";box.style.borderTop="1px solid var(--line)";
  const head=document.createElement("div");head.className="kc-ops-fact";
  const left=document.createElement("span");left.className="muted";
  const dot=document.createElement("span");dot.className=`dot ${v.cls}`;dot.style.marginRight="6px";
  left.append(dot,document.createTextNode("Dienstplan · Handy-Fehler"));
  const right=document.createElement("span");right.className="kc-ops-ready";right.textContent=v.tag;
  head.append(left,right);
  const detail=document.createElement("div");detail.className="muted small";detail.style.marginTop="4px";detail.textContent=v.text;
  box.append(head,detail);card.append(box);
  refresh();
}

if(typeof document!=="undefined"){
  document.addEventListener("kc:operations-rendered",render);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
  onSessionChange(()=>refresh(true));
  setInterval(()=>{if(!document.hidden)refresh()},60_000);
}
