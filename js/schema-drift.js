import{state,subscribe}from"./state.js";

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

function latestResult(){
  const run=state.lastRun||state.history?.at?.(-1)||state.history?.[state.history.length-1]||null;
  return (run?.results||[]).find(r=>r?.id==="schema_drift")||null;
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
    detail.textContent="Signatur-Prüfung ist in 0.8 vorbereitet. Sie wird erst aktiviert, wenn der Serververgleich getestet ist; bis dahin entsteht kein Alarm.";
  }else{
    const m=r.metrics||{},parts=[];
    if(Number.isFinite(Number(m.tables_compared)))parts.push(`${Number(m.tables_compared)} Tabellen verglichen`);
    if(Number.isFinite(Number(m.tables_different))&&Number(m.tables_different)>0)parts.push(`${Number(m.tables_different)} unterschiedlich`);
    if(Array.isArray(m.different_tables)&&m.different_tables.length)parts.push(m.different_tables.slice(0,5).join(", "));
    detail.textContent=parts.join(" · ")||r.detail||"Schema-Vergleich abgeschlossen";
  }
  box.append(detail);card.append(box);
}

if(typeof document!=="undefined")subscribe(render);
