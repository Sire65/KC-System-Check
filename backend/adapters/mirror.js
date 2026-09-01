import { normalizeResult } from "../health-model.js";
export async function checkMirror(cfg){
  if(!cfg.endpoint) return normalizeResult({id:"mirror",name:"Spiegelung",kind:"replication",health:0,detail:"Mirror-Status-Endpunkt noch nicht konfiguriert"});
  try{
    const r=await fetch(cfg.endpoint,{headers:cfg.token?{Authorization:`Bearer ${cfg.token}`}:{},cache:"no-store"});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const x=await r.json();
    const mismatches=Number(x.mismatch_count||0), stale=Boolean(x.stale);
    const health=mismatches?45:stale?75:100;
    return normalizeResult({id:"mirror",name:"Spiegelung",kind:"replication",health,detail:mismatches?`${mismatches} Abweichung(en)`:stale?"Letzter Lauf zu alt":"Quelle und Ziel identisch",
      metrics:{mismatch_count:mismatches,last_success:x.last_success||null,stale}});
  }catch(e){ return normalizeResult({id:"mirror",name:"Spiegelung",kind:"replication",health:20,detail:e.message}); }
}
