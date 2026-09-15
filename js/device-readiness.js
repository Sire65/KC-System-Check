import{state,subscribe}from"./state.js";
import"./schema-drift.js";
import{latestInstances,stableCashRegisterSlots}from"./device-slots.js";

const WARN_MS=90000,CRIT_MS=180000;
const ageMs=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?Math.max(0,Date.now()-t):null};
const ago=ms=>ms==null?"nie":ms<60000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3600000?`vor ${Math.round(ms/60000)} min`:ms<86400000?`vor ${Math.round(ms/3600000)} h`:`vor ${Math.round(ms/86400000)} T`;
const latest=list=>[...list].sort((a,b)=>Date.parse(b.measured_at||b.received_at||0)-Date.parse(a.measured_at||a.received_at||0))[0]||null;
const num=(...v)=>{for(const x of v){const n=Number(x);if(Number.isFinite(n))return n}return null};

function liveData(){const x=state.live||{};return x.live&&typeof x.live==="object"?x.live:x}
function findCard(){return [...document.querySelectorAll("#operationsOverview .kc-ops-card")].find(c=>c.textContent?.includes("Kassen & Geräte"))||null}
function row(label,value){const d=document.createElement("div");d.className="kc-ops-fact";const a=document.createElement("span");a.className="muted";a.textContent=label;const b=document.createElement("span");b.textContent=value;d.append(a,b);return d}
function deviceState(h){
  if(!h)return"Anbindung vorbereitet";
  const age=ageMs(h.measured_at||h.received_at),raw=String(h.status||"").toUpperCase();
  if(age===null||age>CRIT_MS)return`nicht aktiv · ${ago(age)}`;
  if(["ERROR","FAILED","CRITICAL","BAD","OFFLINE","DISCONNECTED"].includes(raw))return`STÖRUNG · ${ago(age)}`;
  if(age>WARN_MS||["DEGRADED","WARNING","WARN"].includes(raw))return`PRÜFEN · ${ago(age)}`;
  return`ONLINE · ${ago(age)}`;
}
function metrics(h){if(!h)return null;return{
  battery:num(h.battery_percent,h.battery,h.device_battery_percent),
  wifi:num(h.wifi_percent,h.wifi_signal_percent,h.signal_percent),
  free:num(h.storage_free_percent,h.free_storage_percent),
};}
function meter(name,value,suffix="%") {return value==null?`${name}: noch keine Telemetrie`:`${name}: ${Math.round(value)}${suffix}`}
function activeConflictSlots(assigned){
  return new Set((assigned?.conflicts||[]).filter(c=>{const a=ageMs(c?.duplicate?.measured_at||c?.duplicate?.received_at);return a!==null&&a<=CRIT_MS}).map(c=>c.slot));
}
function registerState(h,slot,conflictSlots){
  const base=deviceState(h);return conflictSlots.has(slot)&&!base.startsWith("STÖRUNG")?`PRÜFEN · doppelte aktive Zuordnung · ${base}`:base;
}

function render(){
  if(typeof document==="undefined")return;
  const card=findCard();if(!card)return;
  card.querySelector(".kc-device-facts")?.remove();
  const data=liveData(),hs=Array.isArray(data?.heartbeats)?data.heartbeats:[];
  const pos=hs.filter(h=>/kasse|markt|pos/i.test(h?.program_id||""));
  const mgr=hs.filter(h=>/manager/i.test(h?.program_id||""));
  const assigned=stableCashRegisterSlots(pos),posRows=assigned.instances,conflictSlots=activeConflictSlots(assigned);
  const current=assigned.slots.filter(h=>{const a=ageMs(h?.measured_at||h?.received_at);return a!==null&&a<=WARN_MS}).length;
  const box=document.createElement("div");box.className="kc-ops-facts kc-device-facts";
  box.append(row("Kassen",posRows.length?`${current}/2 aktuell`:`0/2 · Anbindung vorbereitet`));
  box.append(row("Kasse 1",registerState(assigned.slots[0],1,conflictSlots)));
  box.append(row("Kasse 2",registerState(assigned.slots[1],2,conflictSlots)));
  if(conflictSlots.size)box.append(row("Kassen-Zuordnung",`PRÜFEN · ${conflictSlots.size} doppelte aktive Slot-Zuordnung(en)`));
  if(assigned.extras.length)box.append(row("Weitere Kassen",`${assigned.extras.length} nicht zugeordnete Instanz(en) erkannt`));
  const mh=latest(latestInstances(mgr));box.append(row("PC Manager",deviceState(mh)));
  const newest=latest([...posRows,mh].filter(Boolean));
  box.append(row("Letzter Gerätekontakt",newest?ago(ageMs(newest.measured_at||newest.received_at)):"noch keiner"));
  const m=metrics(newest);
  const extra=document.createElement("div");extra.className="muted small";extra.textContent=m?[meter("Akku",m.battery),meter("WLAN",m.wifi),meter("Speicher frei",m.free)].join(" · "):"Akku · WLAN · Speicher: Telemetrie vorbereitet, aber noch nicht geliefert";
  box.append(extra);
  const note=document.createElement("div");note.className="muted small";note.textContent="Kasse 1/2 werden stabil über explizite Kassen-/Terminalnummern oder ersatzweise über eine feste Gerätekennung zugeordnet. Zwei gleichzeitig aktive Geräte mit derselben Kassennummer werden als Konflikt markiert und nicht auf Kasse 1/2 verteilt. Ein Ersatztablet sollte dieselbe logische Kassennummer weiterführen. Bis 90 s aktuell, 90–180 s PRÜFEN, danach nicht aktiv. DP2 erzeugt keine Geräte-Störung.";box.append(note);
  card.append(box);
}

if(typeof document!=="undefined"){
  subscribe(render);
  document.addEventListener("kc:operations-rendered",render);
}
