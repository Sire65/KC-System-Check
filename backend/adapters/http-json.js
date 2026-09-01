import { normalizeResult } from "../health-model.js";

export async function timedFetch(url, options={}, timeoutMs=5000){
  const c=new AbortController(); const t=setTimeout(()=>c.abort(),timeoutMs); const started=performance.now();
  try{
    const r=await fetch(url,{...options,signal:c.signal,cache:"no-store"});
    return {response:r,latency:Math.round(performance.now()-started)};
  } finally { clearTimeout(t); }
}
export function bearer(token){ return token ? {Authorization:`Bearer ${token}`} : {}; }

export async function genericHealth(def){
  try{
    const {response,latency}=await timedFetch(def.url,{headers:{Accept:"application/json",...bearer(def.token)}},def.timeoutMs||5000);
    const ok=response.ok;
    return normalizeResult({id:def.id,name:def.name,kind:def.kind,health:ok?(latency>(def.warnLatency||800)?82:98):35,
      latency,detail:ok?"Erreichbar":`HTTP ${response.status}`,metrics:{http_status:response.status,latency_ms:latency}});
  }catch(e){
    return normalizeResult({id:def.id,name:def.name,kind:def.kind,health:15,detail:e.name==="AbortError"?"Zeitüberschreitung":e.message,
      metrics:{error:e.name||"Error"}});
  }
}
