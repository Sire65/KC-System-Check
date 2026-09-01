import { normalizeResult } from "../health-model.js";
import { timedFetch } from "./http-json.js";
export async function checkSupabase(cfg){
  if(!cfg.url || !cfg.anonKey) return normalizeResult({id:"supabase",name:"Supabase",kind:"database",health:0,detail:"Noch nicht konfiguriert"});
  try{
    const {response,latency}=await timedFetch(`${cfg.url.replace(/\/$/,"")}/rest/v1/`,{
      headers:{apikey:cfg.anonKey,Authorization:`Bearer ${cfg.anonKey}`,Accept:"application/json"}},cfg.timeoutMs||5000);
    return normalizeResult({id:"supabase",name:"Supabase",kind:"database",health:response.ok?(latency>600?82:98):35,latency,
      detail:response.ok?"API erreichbar":`HTTP ${response.status}`,metrics:{http_status:response.status,latency_ms:latency}});
  }catch(e){ return normalizeResult({id:"supabase",name:"Supabase",kind:"database",health:15,detail:e.name==="AbortError"?"Zeitüberschreitung":e.message}); }
}
