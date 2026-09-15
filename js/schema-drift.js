import{subscribe,latestResult as latestKnownResult}from"./state.js";
import{loadLiveRuntime}from"./runtime-config.js";
import{sessionToken}from"./session.js";

let remote=null,loading=false,lastAttempt=0;
const RETRY_MS=5*60*1000;
const statusClass=s=>{
  const x=String(s||"").toLowerCase();
  if(x==="healthy"||x==="ok")return"ok";
  if(x==="warning"||x==="warn")return"warn";
  if(x==="critical"||x==="bad")return"bad";
  return"idle";
};
const label=s=>s==="ok"?"GLEICH":s==="warn"?"PRÜFEN":s==="bad"?"ABWEICHUNG":"NOCH NICHT GEMESSEN";

function findCard(){
  return [...document.querySelectorAll("#operationsOverview .kc-ops-card")]
    .find(c=>c.textContent?.includes("Datenbank & Failover"))||null;
}
function latestResult(){return remote||latestKnownResult("schema_drift")||null}
function siblingUrl(base){
  try{
    const u=new URL(base,location.href);
    u.pathname=u.pathname.replace(/\/kc-system-check\/?$/,"/kc-schema-drift");
    return u.toString();
  }catch{return""}
}
async function refresh(){
  if(loading||Date.now()-lastAttempt<RETRY_MS)return;
  loading=true;lastAttempt=Date.now();
  try{
    const runtime=await loadLiveRuntime();
    const url=siblingUrl(runtime?.apiBaseUrl||"");
    const token=sessionToken()||runtime?.apiToken||"";
    if(!url||!token)return;
    const r=await fetch(url,{cache:"no-store",headers:{Authorization:`Bearer ${token}`}});
    if(!r.ok)return;
    const body=await r.json();
    if(body?.result?.id==="schema_drift"){remote=body.result;render()}
  }catch{}finally{loading=false}
}
function render(){
  if(typeof document==="undefined")return;
  const card=findCard();if(!card)return;
  card.querySelector(".kc-schema-drift")?.remove();
  const r=latestResult(),cls=statusClass(r?.status);
  const box=document.createElement("div");box.className="kc-schema-drift";box.style.marginTop="8px";box.style.paddingTop="8px";box.style.borderTop="1px solid var(--line)";
  const head=document.createElement("div");head.className="kc-ops-fact";
  const left=document.createElement("span");left.className="muted";left.textContent="Schema-Drift Supabase ↔ Neon";
  const right=document.createElement("span");right.className="kc-ops-ready";right.textContent=r?label(cls):"VORBEREITET";
  head.append(left,right);box.append(head);
  const detail=document.createElement("div");detail.className="muted small";detail.style.marginTop="4px";
  if(!r){
    detail.textContent="Spiegel-Kompatibilitätsprüfung ist vorbereitet. Solange der Beta-Endpunkt nicht erreichbar ist, entsteht kein Alarm.";
  }else{
    const m=r.metrics||{},parts=[];
    if(Number.isFinite(Number(m.tables_compared)))parts.push(`${Number(m.tables_compared)} Spiegel-Tabellen geprüft`);
    if(Number.isFinite(Number(m.tables_different))&&Number(m.tables_different)>0)parts.push(`${Number(m.tables_different)} Abweichung(en)`);
    const names=[...(Array.isArray(m.missing_in_neon)?m.missing_in_neon:[]),...(Array.isArray(m.different_tables)?m.different_tables:[])];
    if(names.length)parts.push([...new Set(names)].slice(0,5).join(", "));
    detail.textContent=parts.join(" · ")||r.detail||"Schema-Vergleich abgeschlossen";
  }
  box.append(detail);card.append(box);refresh();
}

if(typeof document!=="undefined"){
  subscribe(render);
  document.addEventListener("kc:operations-rendered",render);
}
