import{subscribe,state}from"./state.js";
import{esc}from"./safe-html.js";

// Datenfluss-Wahrheitsschicht v3:
// - Grau bedeutet nur: diese Route ist vorgesehen / momentan ohne gemessenen Verkehr.
// - Grün + wandernder Punkt bedeutet: innerhalb der letzten 60 s wurde echter Verkehr gemessen.
// - Kumulative Heartbeat-Zaehler werden nur als DELTA zwischen zwei Messungen gewertet.
// - Ein Backup zaehlt zum Zeitpunkt last_backup_at, nicht zum Zeitpunkt einer spaeteren Statusmeldung.
// - Spiegelungs- und explizite Flow-Ereignisse behalten ihren echten Ereigniszeitpunkt.
const LIVE_MS=60_000,ERROR_MS=10*60_000,RECENT_MS=24*60*60_000,KANAL="kc-datenfluss";
const STATIC_ROUTES=[
  {from:"kasse-01",to:"supabase",fromLabel:"Kasse 01",toLabel:"Supabase · KC Core",kind:"Kassen-Sync"},
  {from:"kasse-02",to:"supabase",fromLabel:"Kasse 02",toLabel:"Supabase · KC Core",kind:"Kassen-Sync"},
  {from:"pc-manager",to:"supabase",fromLabel:"PC Manager",toLabel:"Supabase · KC Core",kind:"Manager-Sync"},
  {from:"money-butler",to:"supabase",fromLabel:"Money Butler",toLabel:"Supabase · KC Core",kind:"Bargeld-Sync"},
  {from:"dp-app",to:"supabase",fromLabel:"KC Dienstplan",toLabel:"Supabase · KC Core",kind:"Dienstplan-Sync"},
  {from:"pc-backup",to:"b2",fromLabel:"PC Backup Vault",toLabel:"Backblaze B2",kind:"Backup"},
  {from:"pc-backup",to:"neon-vault",fromLabel:"PC Backup Vault",toLabel:"Neon · Backup",kind:"Backup"},
  {from:"supabase",to:"neon-mirror",fromLabel:"Supabase · KC Core",toLabel:"Neon · Spiegel",kind:"Spiegelung"}
];
const ROUTE_BY_KEY=new Map(STATIC_ROUTES.map(r=>[`${r.from}>${r.to}`,r]));
const activity=new Map(),counters=new Map(),seen=new Map();
let snapshot=null,observer=null,queued=false,ws=null,wsTimer=null,wsHeartbeat=null,wsRuntimeKey="",realtimeState="aus";

export function counterDelta(previous,current){
  const a=Number(previous),b=Number(current);
  if(previous==null||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<0||b<=a)return 0;
  return b-a;
}
export function normalizeFlowNode(raw){
  const id=String(raw||"").toLowerCase();
  if(!id)return null;
  if(/kasse|markt|pos/.test(id)){const n=id.match(/(\d{1,2})/);return n?`kasse-${n[1].padStart(2,"0")}`:"kasse-01"}
  if(/manager/.test(id))return"pc-manager";
  if(/money|butler|bargeld/.test(id))return"money-butler";
  if(/kc[-_]?dp|dienstplan/.test(id))return"dp-app";
  if(/neon[-_]?mirror|mirror|spiegel/.test(id))return"neon-mirror";
  if(/b2|backblaze/.test(id))return"b2";
  if(/neon/.test(id))return"neon-vault";
  if(/pc[-_]?backup|backup|vault|pbv/.test(id))return"pc-backup";
  if(/supabase|kc[-_]?core|kicc|communication|system-check/.test(id))return"supabase";
  return null;
}
export function trafficView(entry,now=Date.now()){
  if(!entry?.at)return{moving:false,bad:false,cls:"idle",tag:"KEIN VERKEHR"};
  const age=Math.max(0,now-entry.at),bad=!!entry.bad&&age<=ERROR_MS,moving=!bad&&Number(entry.events||0)>0&&age<=LIVE_MS;
  return{moving,bad,cls:bad?"bad":moving?"active":"idle",tag:bad?"STÖRUNG":moving?"VERKEHR":"RUHE",age};
}
const parseTime=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?t:null};
const routeKey=(from,to)=>`${from}>${to}`;
const isBad=s=>/error|fail|critical|down|corrupt/i.test(String(s||""));
const ago=ms=>ms==null?"nie":ms<60_000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3_600_000?`vor ${Math.round(ms/60_000)} min`:ms<86_400_000?`vor ${(ms/3_600_000).toFixed(ms<10_800_000?1:0)} h`:`vor ${Math.round(ms/86_400_000)} T`;
const bytesText=n=>{const b=Number(n||0);return b<=0?"":b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`};
function rememberSeen(id,at){seen.set(id,at);if(seen.size>1200){const cut=Date.now()-RECENT_MS;for(const[k,t]of seen)if(t<cut)seen.delete(k)}}
function touch(from,to,{at=Date.now(),events=1,bytes=0,bad=false,source="Messung"}={}){
  if(!from||!to||from===to)return;
  const key=routeKey(from,to);if(!ROUTE_BY_KEY.has(key))return;
  const old=activity.get(key)||{};
  if(old.at&&at<old.at)return;
  activity.set(key,{at,events:Math.max(0,Number(events||0)),bytes:Math.max(0,Number(bytes||0)),bad:!!bad,source});
}
function actualBackup(live){const m=live?.backup?.machine,k=live?.backup?.kicc;return m&&Object.keys(m).length?m:k&&Object.keys(k).length?k:null}
function backupTarget(b){const t=String(b?.storage_target||b?.backup_target||"").toLowerCase();if(/b2|backblaze/.test(t))return"b2";if(/neon/.test(t))return"neon-vault";return null}
function ingestFlowRows(live){
  const backup=actualBackup(live),backupAt=parseTime(backup?.last_backup_at);
  for(const f of live?.flows||[]){
    if(String(f.flow_type||"").toLowerCase()==="heartbeat_sync")continue; // kumulativer Zaehler ist kein Einzelereignis
    const from=normalizeFlowNode(f.source_id||f.program_id),to=normalizeFlowNode(f.target_id);if(!from||!to||!ROUTE_BY_KEY.has(routeKey(from,to)))continue;
    let at=parseTime(f.measured_at||f.received_at);if(from==="pc-backup"&&backupAt)at=backupAt; // Status-Telemetrie darf ein altes Backup nicht frisch machen
    if(!at)continue;
    const id=`flow|${from}|${to}|${at}|${f.event_count||0}|${f.byte_count||0}|${f.status||""}`;if(seen.has(id))continue;rememberSeen(id,at);
    const events=Math.max(0,Number(f.event_count||0)),bytes=Math.max(0,Number(f.byte_count||0));if(events>0||bytes>0)touch(from,to,{at,events:events||1,bytes,bad:isBad(f.status),source:f.flow_type||"Flow-Telemetrie"});
  }
  if(backup&&backupAt){const to=backupTarget(backup);if(to){const id=`backup|${to}|${backupAt}`;if(!seen.has(id)){rememberSeen(id,backupAt);touch("pc-backup",to,{at:backupAt,events:1,bytes:Number(backup.last_backup_stored_bytes||backup.last_backup_bytes||0),bad:isBad(backup.last_backup_status||backup.status),source:"Backup-Abschluss"})}}}
}
function ingestHeartbeatCounters(live){
  for(const h of live?.heartbeats||[]){
    const from=normalizeFlowNode(h.program_id);if(!from||from==="supabase"||!ROUTE_BY_KEY.has(routeKey(from,"supabase")))continue;
    const tx=Number(h.traffic_tx),at=parseTime(h.measured_at||h.received_at);if(!Number.isFinite(tx)||tx<0||!at)continue;
    const id=`${h.program_id||""}|${h.instance_id||""}`,prev=counters.get(id);
    if(!prev){counters.set(id,{value:tx,at});continue}
    if(at<=prev.at)continue;
    const delta=counterDelta(prev.value,tx);counters.set(id,{value:tx,at});
    if(delta>0)touch(from,"supabase",{at,events:delta,source:"Zählerdifferenz"});
  }
}
function ingest(live){if(!live)return;ingestFlowRows(live);ingestHeartbeatCounters(live)}
function ingestBroadcast(p){
  const from=normalizeFlowNode(p?.von);if(!from||!Array.isArray(p?.kanten))return;
  const at=parseTime(p.zeit)||Date.now();for(const e of p.kanten){const to=normalizeFlowNode(e?.nach),events=Math.max(0,Number(e?.req||0)),bytes=Math.max(0,Number(e?.bytes||0)),bad=Number(e?.fehler||0)>0||isBad(p?.status);if(to&&(events>0||bytes>0||bad))touch(from,to,{at,events:events||1,bytes,bad,source:"Realtime"})}renderAll()
}
function entries(){return STATIC_ROUTES.map(r=>({...r,state:activity.get(routeKey(r.from,r.to))||null,view:trafficView(activity.get(routeKey(r.from,r.to)))}))}
function overall(list){return list.some(x=>x.view.bad)?"bad":list.some(x=>x.view.moving)?"live":"idle"}
function ensureCss(){if(typeof document==="undefined"||document.querySelector("#kcFlowTruthCss"))return;const s=document.createElement("style");s.id="kcFlowTruthCss";s.textContent=`
#kcdfKarteBadge{display:none!important}.kc-truth-list{display:grid;gap:8px;margin-top:10px}.kc-truth-row{display:grid;grid-template-columns:minmax(82px,1fr) minmax(70px,1.2fr) minmax(82px,1fr) auto;gap:8px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:13px;background:#0e1728}.kc-truth-node{font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis}.kc-truth-node.to{text-align:right}.kc-truth-line{height:5px;border-radius:999px;background:#30394a;position:relative;overflow:hidden}.kc-truth-line.active{background:var(--ok)}.kc-truth-line.bad{background:var(--bad)}.kc-truth-line.active:after{content:"";position:absolute;width:10px;height:10px;border-radius:50%;top:50%;left:-10px;transform:translateY(-50%);background:var(--ok);box-shadow:0 0 10px var(--ok);animation:kcTruthMove 1.35s linear infinite}.kc-truth-tag{font-size:9px;font-weight:900;padding:4px 6px;border:1px solid var(--line);border-radius:999px;white-space:nowrap}.kc-truth-meta{grid-column:1/-1;color:var(--muted);font-size:11px;margin-top:-3px}.kc-truth-map svg{display:block;width:100%;height:auto;max-width:900px;margin:0 auto}.kc-truth-legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:8px}.kc-truth-swatch{display:inline-block;width:20px;height:3px;border-radius:2px;background:#30394a;margin-right:5px;vertical-align:middle}.kc-truth-swatch.live{background:var(--ok)}.kc-truth-swatch.bad{background:var(--bad)}@keyframes kcTruthMove{to{left:100%}}@media(max-width:620px){.kc-truth-row{grid-template-columns:minmax(68px,1fr) 50px minmax(68px,1fr) auto;padding:9px 7px}.kc-truth-node{font-size:11px}}@media(prefers-reduced-motion:reduce){.kc-truth-line.active:after{animation:none;left:calc(50% - 5px)}}`;
document.head.appendChild(s)}
function renderList(){
  if(typeof document==="undefined")return;const host=document.querySelector("#kcLiveFlowOverview");if(!host)return;ensureCss();host.dataset.kcFlowTruth="1";
  const list=entries(),o=overall(list),badge=o==="bad"?"STÖRUNG":o==="live"?"LIVE":"RUHE";
  host.innerHTML=`<div class="row between"><div><div class="eyebrow">Echte Betriebsdaten</div><h3>Leitflüsse</h3><div class="muted small">Dunkelgrau = Route vorhanden, aber kein gemessener Verkehr. Grün + wandernder Punkt = echter Verkehr in den letzten 60 s.</div></div><span class="badge${o==="live"?" live":""}">${badge}</span></div><div class="kc-truth-list">${list.map(x=>{const st=x.state,v=x.view,meta=st?.at?[x.kind,st.events?`${st.events} Ereignis${st.events===1?"":"se"}`:"",bytesText(st.bytes),`letzter gemessener Verkehr ${ago(v.age)}`,st.source].filter(Boolean).join(" · "):`${x.kind} · bisher kein gemessener Verkehr`;return`<div class="kc-truth-row"><div class="kc-truth-node">${esc(x.fromLabel)}</div><div class="kc-truth-line ${v.cls}"></div><div class="kc-truth-node to">${esc(x.toLabel)}</div><span class="kc-truth-tag">${esc(v.tag)}</span><div class="kc-truth-meta">${esc(meta)}</div></div>`}).join("")}</div>`;
}
const MAP_NODES={
  "kasse-01":{x:100,y:45,label:"Kasse 01"},"kasse-02":{x:100,y:105,label:"Kasse 02"},"pc-manager":{x:100,y:165,label:"PC Manager"},"money-butler":{x:100,y:225,label:"Money Butler"},"dp-app":{x:100,y:285,label:"KC Dienstplan"},"pc-backup":{x:100,y:355,label:"PC Backup"},
  supabase:{x:385,y:190,label:"Supabase · KC Core"},"neon-mirror":{x:660,y:95,label:"Neon · Spiegel"},"neon-vault":{x:660,y:235,label:"Neon · Backup"},b2:{x:660,y:355,label:"Backblaze B2"}
};
function mapPath(a,b){const x1=a.x+72,x2=b.x-72,m=(x1+x2)/2;return`M${x1},${a.y} C${m},${a.y} ${m},${b.y} ${x2},${b.y}`}
function renderMap(){
  if(typeof document==="undefined")return;const host=document.querySelector("#kcdfKarte");if(!host)return;ensureCss();host.dataset.kcFlowTruth="1";const list=entries(),o=overall(list),reduce=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const paths=list.map((x,i)=>{const a=MAP_NODES[x.from],b=MAP_NODES[x.to],d=mapPath(a,b),v=x.view,stroke=v.bad?"var(--bad)":v.moving?"var(--ok)":"#30394a",width=v.moving?3.4:2.2,id=`kcTruthPath${i}`;const dot=v.moving&&!reduce?`<circle r="4" fill="var(--ok)"><animateMotion dur="1.5s" repeatCount="indefinite"><mpath href="#${id}"/></animateMotion></circle>`:"";return`<path id="${id}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>${dot}`}).join("");
  const nodes=Object.values(MAP_NODES).map(n=>`<g transform="translate(${n.x-72} ${n.y-20})"><rect width="144" height="40" rx="9" fill="#0e1728" stroke="#52617a"/><text x="72" y="25" text-anchor="middle" fill="var(--text)" font-size="12" font-weight="700">${esc(n.label)}</text></g>`).join("");
  host.innerHTML=`<div class="kc-truth-map"><div class="row between" style="margin-bottom:5px"><div class="muted small">Feste dunkelgraue Routen werden erst bei gemessenem Verkehr grün.</div><span class="badge${o==="live"?" live":""}">${o==="bad"?"STÖRUNG":o==="live"?"VERKEHR":"RUHE"}</span></div><svg viewBox="0 0 760 410" role="img" aria-label="KC Datenfluss: graue Routen ohne Verkehr, grüne Routen bei aktuellem Verkehr">${paths}${nodes}</svg><div class="kc-truth-legend"><span><i class="kc-truth-swatch"></i>kein Verkehr</span><span><i class="kc-truth-swatch live"></i>Verkehr ≤ 60 s</span><span><i class="kc-truth-swatch bad"></i>Fehler</span><span>Quelle: echter Snapshot-Zeitpunkt + Realtime + Zählerdifferenz</span></div></div>`;
}
function renderAll(){renderList();renderMap()}
function upgradeWhenReady(){if(typeof document==="undefined")return;const a=document.querySelector("#kcLiveFlowOverview"),b=document.querySelector("#kcdfKarte");if(a&&!a.dataset.kcFlowTruth||b&&!b.dataset.kcFlowTruth)renderAll()}
function queueUpgrade(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;upgradeWhenReady()})}
function realtimeStop(){clearInterval(wsHeartbeat);clearTimeout(wsTimer);wsHeartbeat=wsTimer=null;try{ws?.close()}catch{}ws=null}
function ensureRealtime(runtime){
  if(typeof WebSocket==="undefined")return;const base=String(runtime?.apiBaseUrl||""),m=base.match(/^https:\/\/([a-z0-9-]+\.supabase\.co)/i),token=runtime?.apiToken||"",key=`${m?.[1]||""}|${token}`;if(!m||!token)return;if(key===wsRuntimeKey&&ws)return;realtimeStop();wsRuntimeKey=key;let ref=0,closed=false;const send=(topic,event,payload)=>{if(ws?.readyState===1)ws.send(JSON.stringify({topic,event,payload,ref:String(++ref)}))};
  const connect=()=>{if(closed)return;try{ws=new WebSocket(`wss://${m[1]}/realtime/v1/websocket?apikey=${encodeURIComponent(token)}&vsn=1.0.0`)}catch{return}ws.onopen=()=>{send(`realtime:${KANAL}`,"phx_join",{config:{broadcast:{self:false},presence:{key:""},postgres_changes:[]},access_token:token});wsHeartbeat=setInterval(()=>send("phoenix","heartbeat",{}),30000)};ws.onmessage=e=>{let msg;try{msg=JSON.parse(e.data)}catch{return}if(msg.event==="phx_reply"&&msg.topic===`realtime:${KANAL}`)realtimeState=msg.payload?.status==="ok"?"verbunden":"abgelehnt";if(msg.event==="broadcast"&&msg.payload?.event==="fluss")ingestBroadcast(msg.payload.payload)};ws.onclose=()=>{clearInterval(wsHeartbeat);wsHeartbeat=null;realtimeState="getrennt";if(!closed)wsTimer=setTimeout(connect,5000)};ws.onerror=()=>{}};connect();
  return()=>{closed=true;realtimeStop()}
}
function onState(s){snapshot=s;ingest(s?.live);ensureRealtime(s?.runtime);renderAll();queueUpgrade()}
if(typeof document!=="undefined"){ensureCss();observer=new MutationObserver(queueUpgrade);const start=()=>{const live=document.querySelector("#live");if(live)observer.observe(live,{childList:true,subtree:true});queueUpgrade()};if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start()}
subscribe(onState);

export const __flowTruthForTests={STATIC_ROUTES,activity,counters,get realtimeState(){return realtimeState},ingest,entries};
