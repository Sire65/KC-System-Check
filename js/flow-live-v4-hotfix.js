import {subscribe} from "./state.js";
import {esc} from "./safe-html.js";
import {__flowTruthForTests as truth,normalizeFlowNode} from "./flow-live-v4.js";

// v0.7.40: Der Spiegelstatus kommt ausschliesslich aus dem serverseitig
// bestaetigten Mirror-Lauf. Generische Realtime-Broadcasts duerfen diese
// Route nicht rot faerben. Ausserdem zeigt der Programmaustausch jetzt alle
// bekannten Routen und benennt fehlende Flow-Telemetrie offen.
const MIRROR_KEY="supabase>neon-mirror";
const badWord=v=>/error|fail|critical|down|corrupt/i.test(String(v||""));
const parseTime=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?t:null};
const ageText=ms=>ms==null?"nie":ms<60_000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3_600_000?`vor ${Math.round(ms/60_000)} min`:ms<86_400_000?`vor ${(ms/3_600_000).toFixed(ms<10_800_000?1:0)} h`:`vor ${Math.round(ms/86_400_000)} T`;
const byteText=n=>{const b=Number(n||0);return b<=0?"":b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`};

export function shouldAcceptFlowWrite(key,value){
  return !(key===MIRROR_KEY&&value?.source==="Realtime");
}

export function mirrorAuthority(live){
  const rows=(live?.flows||[]).map(f=>({f,at:parseTime(f.measured_at||f.received_at)})).filter(x=>{
    if(!x.at)return false;
    const from=normalizeFlowNode(x.f.source_id||x.f.program_id),to=normalizeFlowNode(x.f.target_id);
    return from==="supabase"&&to==="neon-mirror"&&String(x.f.flow_type||"").toLowerCase()==="replication";
  }).sort((a,b)=>b.at-a.at);
  if(!rows.length)return null;
  const {f,at}=rows[0],events=Math.max(0,Number(f.event_count||0)),bytes=Math.max(0,Number(f.byte_count||0));
  return{key:MIRROR_KEY,at,events:events||1,bytes,bad:badWord(f.status),source:`Spiegel-Lauf · Serverstatus ${String(f.status||"unbekannt").toUpperCase()}`,status:String(f.status||"")};
}

let nativeSet=null;
function installMirrorGuard(){
  const map=truth.activity;
  if(map.__kcMirrorAuthorityGuard)return;
  nativeSet=map.set.bind(map);
  Object.defineProperty(map,"__kcMirrorAuthorityGuard",{value:true,enumerable:false});
  map.set=function(key,value){
    if(!shouldAcceptFlowWrite(key,value))return map;
    return nativeSet(key,value);
  };
}

function applyMirrorAuthority(live){
  const a=mirrorAuthority(live);
  if(!a||!nativeSet)return false;
  const old=truth.activity.get(MIRROR_KEY);
  const next={at:a.at,events:a.events,bytes:a.bytes,bad:a.bad,source:a.source};
  const same=old&&old.at===next.at&&old.events===next.events&&old.bytes===next.bytes&&old.bad===next.bad&&old.source===next.source;
  if(same)return false;
  nativeSet(MIRROR_KEY,next);
  return true;
}

function requestTruthRender(){
  if(typeof document==="undefined")return;
  const list=document.querySelector("#kcLiveFlowOverview"),map=document.querySelector("#kcdfKarte"),live=document.querySelector("#live");
  if(list)list.dataset.kcFlowTruth="authority-refresh";
  if(map)map.dataset.kcFlowTruth="authority-refresh";
  if(live){const marker=document.createComment("kc-flow-authority-refresh");live.appendChild(marker);marker.remove()}
}

function routePresentation(x){
  if(!x.state?.at)return{cls:"idle",tag:"OHNE MESSUNG",meta:`${x.kind} · direkte Flow-Telemetrie noch nicht angebunden`};
  const v=x.view,st=x.state,cls=v.bad?"bad":v.moving||v.recent?"ok":"idle",tag=v.bad?"STÖRUNG":v.moving?"VERKEHR":v.recent?"KÜRZLICH":"RUHE";
  const details=[x.kind,st.events?`${st.events} Ereignis${st.events===1?"":"se"}`:"",byteText(st.bytes),`letzter echter Verkehr ${ageText(v.age)}`,st.source].filter(Boolean).join(" · ");
  return{cls,tag,meta:details};
}

function renderProgramExchange(){
  if(typeof document==="undefined")return;
  const host=document.querySelector("#liveFlows");
  if(!host)return;
  const list=truth.entries(),measured=list.filter(x=>x.state?.at).length,active=list.filter(x=>x.view.moving||x.view.recent).length,missing=list.length-measured;
  const summary=`Messabdeckung ${measured}/${list.length} Datenwege · ${active} aktuell/kürzlich aktiv · ${missing} noch ohne direkte Flow-Telemetrie. Heartbeats allein zählen bewusst nicht als Datenaustausch.`;
  host.innerHTML=`<div class="live-empty" style="margin-bottom:8px"><strong>Programmaustausch · echte Messwerte</strong><div class="muted small">${esc(summary)}</div></div>`+list.map(x=>{const p=routePresentation(x);return`<div class="live-flow"><span class="dot ${p.cls}"></span><div><strong>${esc(x.fromLabel)} → ${esc(x.toLabel)}</strong><div class="muted small">${esc(p.meta)}</div></div><span class="live-tag">${esc(p.tag)}</span></div>`}).join("");
}

installMirrorGuard();
subscribe(s=>{
  const changed=applyMirrorAuthority(s?.live);
  if(changed)requestTruthRender();
  if(typeof queueMicrotask==="function")queueMicrotask(renderProgramExchange);else setTimeout(renderProgramExchange,0);
});

export const __flowHotfixForTests={MIRROR_KEY,applyMirrorAuthority,routePresentation,renderProgramExchange};
