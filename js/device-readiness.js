import{state,subscribe}from"./state.js";
import"./schema-drift.js";

const OP=/kasse|markt|pos|manager/i;
const ageMs=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?Math.max(0,Date.now()-t):null};
const ago=ms=>ms==null?"nie":ms<60000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3600000?`vor ${Math.round(ms/60000)} min`:ms<86400000?`vor ${Math.round(ms/3600000)} h`:`vor ${Math.round(ms/86400000)} T`;
const fresh=h=>{const a=ageMs(h?.measured_at||h?.received_at);return a!=null&&a<=180000};
const latest=list=>[...list].sort((a,b)=>Date.parse(b.measured_at||b.received_at||0)-Date.parse(a.measured_at||a.received_at||0))[0]||null;
const num=(...v)=>{for(const x of v){const n=Number(x);if(Number.isFinite(n))return n}return null};

function liveData(){const x=state.live||{};return x.live&&typeof x.live==="object"?x.live:x}
function findCard(){return [...document.querySelectorAll("#operationsOverview .kc-ops-card")].find(c=>c.textContent?.includes("Kassen & Geräte"))||null}
function row(label,value){const d=document.createElement("div");d.className="kc-ops-fact";const a=document.createElement("span");a.className="muted";a.textContent=label;const b=document.createElement("span");b.textContent=value;d.append(a,b);return d}
function metrics(h){if(!h)return null;return{
  battery:num(h.battery_percent,h.battery,h.device_battery_percent),
  wifi:num(h.wifi_percent,h.wifi_signal_percent,h.signal_percent),
  free:num(h.storage_free_percent,h.free_storage_percent),
};}
function meter(name,value,suffix="%") {return value==null?`${name}: noch keine Telemetrie`:`${name}: ${Math.round(value)}${suffix}`}

function render(){
  if(typeof document==="undefined")return;
  const card=findCard();if(!card)return;
  card.querySelector(".kc-device-facts")?.remove();
  const data=liveData(),hs=Array.isArray(data?.heartbeats)?data.heartbeats:[];
  const pos=hs.filter(h=>/kasse|markt|pos/i.test(h?.program_id||""));
  const mgr=hs.filter(h=>/manager/i.test(h?.program_id||""));
  const posLatest=new Map();for(const h of pos){const k=String(h.instance_id||h.source_id||h.program_id);const old=posLatest.get(k);if(!old||Date.parse(h.measured_at||0)>Date.parse(old.measured_at||0))posLatest.set(k,h)}
  const posRows=[...posLatest.values()];
  const online=posRows.filter(fresh).length;
  const mh=latest(mgr),managerOnline=fresh(mh);
  const box=document.createElement("div");box.className="kc-ops-facts kc-device-facts";
  box.append(row("Kassen",posRows.length?`${online}/${Math.max(2,posRows.length)} aktuell`:`0/2 · Anbindung vorbereitet`));
  box.append(row("PC Manager",mh?(managerOnline?"ONLINE":"nicht aktiv"):`Anbindung vorbereitet`));
  const newest=latest([...posRows,mh].filter(Boolean));
  box.append(row("Letzter Gerätekontakt",newest?ago(ageMs(newest.measured_at||newest.received_at)):"noch keiner"));
  const m=metrics(newest);
  const extra=document.createElement("div");extra.className="muted small";extra.textContent=m?[meter("Akku",m.battery),meter("WLAN",m.wifi),meter("Speicher frei",m.free)].join(" · "):"Akku · WLAN · Speicher: Telemetrie vorbereitet, aber noch nicht geliefert";
  box.append(extra);
  const note=document.createElement("div");note.className="muted small";note.textContent="Nur Kassen und PC Manager werden hier als betriebsrelevante Geräte gewertet. Inaktive Programme wie DP2 erzeugen keine Geräte-Störung.";box.append(note);
  card.append(box);
}

if(typeof document!=="undefined")subscribe(render);
