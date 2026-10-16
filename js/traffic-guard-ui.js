// KC Check – isolierte Anzeige fuer den serverseitigen KC Traffic Guard.
// Keine Aenderung am bestehenden Pruef-/Alarmregelwerk.
const API="https://ptblnpiroqftcvlsrhac.supabase.co/functions/v1/kc-traffic-guard";
const safe=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let last=0,busy=false,cache=null;
function host(){
  let el=document.getElementById("kcTrafficGuardPanel");
  if(el)return el;
  const before=document.getElementById("capacityCards")||document.getElementById("usageCards");
  if(!before)return null;
  el=document.createElement("section");el.id="kcTrafficGuardPanel";el.style.cssText="margin:12px 0;padding:14px;border:1px solid var(--line,#374151);border-radius:12px;";
  el.innerHTML='<div class="row between"><strong>🚦 Supabase-Lastwächter</strong><button type="button" class="secondary" id="kcTrafficGuardRefresh">↻ Neu messen</button></div>'+
    '<div id="kcTrafficGuardValue" aria-live="polite" style="margin:8px 0">Noch keine Messung</div>'+
    '<div class="muted small">Kontrolliert den Datenbank-Anfragetrend automatisch alle 15 Minuten – auch bei geschlossenem KC Check. Keine GB-Abrechnungsdaten. Push über KC Communicator.</div>'+
    '<a href="https://supabase.com/dashboard/org/_/usage#egress" target="_blank" rel="noopener noreferrer">Offiziellen Supabase-Egress anzeigen ↗</a>';
  before.parentNode.insertBefore(el,before);
  el.querySelector("#kcTrafficGuardRefresh")?.addEventListener("click",()=>refresh(true));
  return el;
}
function render(){
 const el=host();if(!el)return;
 const h=el.querySelector("#kcTrafficGuardValue");
 const v=cache||{level:"unknown",detail:"Noch keine Messwerte"};
 const cls=v.level==="critical"?"bad":v.level==="warning"?"warn":v.level==="normal"?"ok":"idle";
 const label=({critical:"🔴 Kritische Datenbanklast",warning:"🟡 Datenbanklast erhöht",
   normal:"🟢 Datenbanklast unauffällig",unknown:"⚪ Messbasis wird aufgebaut"})[v.level]||"⚪ Unbekannt";
 const t=Date.parse(v.measured_at||"");const time=Number.isFinite(t)?new Date(t).toLocaleString("de-DE"):"—";
 el.className=cls;
 h.innerHTML='<strong>'+safe(label)+'</strong> · '+safe(v.detail||"")+
   '<div class="muted small">SQL-Aufrufe/15 Minuten: '+(Number.isFinite(Number(v.calls_15m))&&v.calls_15m!==null?Math.round(Number(v.calls_15m)).toLocaleString("de-DE"):"—")+
   ' · Letzte Messung: '+safe(time)+'</div>';
}
async function refresh(force=false){
 if(busy || !force&&Date.now()-last<5*60*1000)return;
 busy=true;last=Date.now();
 try{const r=await fetch(API,{cache:"no-store",signal:AbortSignal.timeout(7000)});
   if(!r.ok)throw new Error("HTTP "+r.status);cache=await r.json();
 }catch{cache={level:"unknown",detail:"Lastwächter zurzeit nicht erreichbar"};}
 finally{busy=false;render();}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>{render();refresh();},{once:true});
else{render();refresh();}
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden)refresh();},5*60*1000);