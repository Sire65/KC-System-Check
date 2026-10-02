// KC-CHECK-CLUB-NOTBETRIEB (0.10.3): Läuft die Köcheclub-App im Notbetrieb (Ersatz-Server bei Cloudflare)?
// Bewusst direkt aus dem Browser und NICHT über die Prüf-API: Fällt Supabase aus, ist auch die Prüf-API weg –
// genau dann muss diese Anzeige noch funktionieren. Adressen kommen aus der Laufzeitkonfiguration (clubNotbetrieb).
// Geprüft wird nur Öffentliches ohne Zugangsdaten:
//  - Handschalter notbetrieb.json der Club-App (modus auto/an/aus, url des Ersatz-Servers)
//  - GET <Ersatz-Server>/status → { ok, stand } (Alter des Notfall-Pakets, ohne Daten)
//  - Club-Server: Anfrage ohne Zugang. Antwortet er (auch mit „Kein Zugang“), läuft er; 5xx/keine Antwort = weg.
// UNKNOWN nie als OK: Ohne Messung bleibt die Anzeige grau.
import{subscribe}from"./state.js";
import{loadRuntimeConfig}from"./runtime-config.js";

const PRUEF_MS=2*60*1000,TIMEOUT_MS=8000;
export const STAND_WARN_MIN=45; // Club-Server bestätigt den Stand alle 15 Min.; nach 3 verpassten Läufen gelb
let letzte=null,laeuft=false,zuletzt=0;

const uhr=d=>{try{return new Date(d).toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})}catch{return"?"}};
const minuten=(stand,jetzt)=>{const t=Date.parse(stand);return Number.isFinite(t)?Math.max(0,Math.round((jetzt-t)/60000)):null};

// Reine Bewertung (testbar). konfig/worker: Objekt oder null (= nicht erreichbar); server: true/false/null (= nicht geprüft)
export function clubNotbetriebBewerten({konfig,worker,server,jetzt=Date.now()}){
  const modus=String(konfig?.modus||"auto").toLowerCase();
  const bereit=!!(worker&&worker.ok&&worker.stand);
  const alter=bereit?minuten(worker.stand,jetzt):null;
  const standText=bereit?`Stand ${uhr(worker.stand)} Uhr${alter!=null&&alter>=60?` (vor ${alter} Min.)`:""}`:"kein Stand";
  if(!konfig&&!worker&&server==null)return{status:"unknown",label:"NICHT GEPRÜFT",text:"Keine Verbindung – Club-Notbetrieb konnte nicht geprüft werden.",notbetrieb:null};
  if(konfig&&!konfig.url)return{status:"not_configured",label:"NICHT EINGERICHTET",text:"Für die Club-App ist kein Ersatz-Server eingetragen.",notbetrieb:false};
  if(modus==="an")return{status:"critical",label:"NOTBETRIEB AKTIV",text:`Club-App läuft im Notbetrieb (von Hand eingeschaltet) · ${standText}. Mitglieder können nur ansehen.`,notbetrieb:true};
  if(server===false)return bereit
    ?{status:"critical",label:"NOTBETRIEB AKTIV",text:`Club-Server nicht erreichbar – Club-App läuft im Notbetrieb · ${standText}. Mitglieder können nur ansehen.`,notbetrieb:true}
    :{status:"critical",label:"AUSFALL",text:"Club-Server nicht erreichbar und Ersatz-Server nicht bereit – Club-App gerade nicht nutzbar.",notbetrieb:false};
  if(server==null)return{status:"unknown",label:"NICHT GEPRÜFT",text:`Club-Server nicht geprüft · Ersatz-Server: ${bereit?standText:"nicht bereit"}.`,notbetrieb:null};
  if(modus==="aus")return{status:"warning",label:"ABGESCHALTET",text:"Normalbetrieb · Notbetrieb ist von Hand abgeschaltet (notbetrieb.json).",notbetrieb:false};
  if(!bereit)return{status:"warning",label:"PRÜFEN",text:"Normalbetrieb · Ersatz-Server antwortet nicht oder hat kein Notfall-Paket.",notbetrieb:false};
  if(alter!=null&&alter>STAND_WARN_MIN)return{status:"warning",label:"VERALTET",text:`Normalbetrieb · Notfall-Paket veraltet: ${standText}.`,notbetrieb:false};
  return{status:"healthy",label:"BEREIT",text:`Normalbetrieb · Notbetrieb bereit, ${standText}.`,notbetrieb:false};
}

async function holen(url,opt={}){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
  try{return await fetch(url,{cache:"no-store",credentials:"omit",signal:ctl.signal,...opt})}finally{clearTimeout(t)}
}
async function json(url){try{const r=await holen(url);return r.ok?await r.json():null}catch{return null}}
// Wie die Club-App selbst: erst nach zwei Fehlversuchen gilt der Club-Server als weg (kein Alarm bei einem Wackler)
async function serverErreichbar(url){
  if(await serverEinmal(url))return true;
  await new Promise(r=>setTimeout(r,3000));
  return serverEinmal(url);
}
async function serverEinmal(url){
  try{
    const r=await holen(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"ping"})});
    if(r.status>=500)return false;
    await r.json();return true; // auch „Kein Zugang“ (401) heißt: Club-Server läuft
  }catch{return false}
}

export async function clubNotbetriebPruefen(){
  const cfg=(await loadRuntimeConfig())?.clubNotbetrieb;
  if(!cfg?.konfigUrl||!cfg?.serverUrl)return null;
  const konfig=await json(`${cfg.konfigUrl}?t=${Date.now()}`);
  const ersatz=String(konfig?.url||cfg.ersatzUrl||"").replace(/\/+$/,"");
  const [worker,server]=await Promise.all([ersatz?json(`${ersatz}/status`):null,serverErreichbar(cfg.serverUrl)]);
  // Ohne Internet sind alle drei weg: dann nicht „Ausfall“ melden, sondern „nicht geprüft“
  const offline=!konfig&&!worker&&server===false;
  return{...clubNotbetriebBewerten({konfig,worker,server:offline?null:server}),gemessen:Date.now()};
}

async function aktualisieren(){
  if(laeuft||Date.now()-zuletzt<PRUEF_MS)return;
  laeuft=true;zuletzt=Date.now();
  try{const r=await clubNotbetriebPruefen();if(r){letzte=r;render()}}catch{}finally{laeuft=false}
}

const KLASSE={healthy:"ok",warning:"warn",critical:"bad"};
function render(){
  if(typeof document==="undefined")return;
  const ops=document.querySelector("#operationsOverview");
  const card=[...document.querySelectorAll("#operationsOverview .kc-ops-card")].find(c=>c.textContent?.includes("Systeme"))||null;
  document.querySelector("#kcClubNotBanner")?.remove();
  if(card){
    card.querySelector(".kc-club-notbetrieb")?.remove();
    const r=letzte,box=document.createElement("div");box.className="kc-club-notbetrieb";box.style.cssText="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)";
    const head=document.createElement("div");head.className="kc-ops-fact";
    const left=document.createElement("span");left.className="muted";
    const dot=document.createElement("span");dot.className=`dot ${KLASSE[r?.status]||"idle"}`;dot.style.marginRight="6px";
    left.append(dot,document.createTextNode("Köcheclub-App · Notbetrieb"));
    const right=document.createElement("span");right.className="kc-ops-ready";right.textContent=r?r.label:"WIRD GEPRÜFT";
    head.append(left,right);
    const detail=document.createElement("div");detail.className="muted small";detail.style.marginTop="4px";
    detail.textContent=r?`${r.text} Geprüft ${uhr(r.gemessen)} Uhr.`:"Prüfung läuft …";
    box.append(head,detail);card.append(box);
  }
  if(ops&&letzte?.notbetrieb){
    const b=document.createElement("div");b.id="kcClubNotBanner";b.setAttribute("role","alert");
    b.style.cssText="margin:0 0 9px;padding:10px 12px;border-radius:12px;background:#e67e22;color:#1f1300;font-weight:800";
    b.textContent=`⚠️ ${letzte.text}`;ops.prepend(b);
  }
  aktualisieren();
}

if(typeof document!=="undefined"){
  subscribe(render);
  document.addEventListener("kc:operations-rendered",render);
  setInterval(()=>{if(document.visibilityState!=="hidden")aktualisieren()},PRUEF_MS);
}
