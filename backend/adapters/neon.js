import { genericHealth } from "./http-json.js";
export async function checkNeon(cfg){
  if(!cfg.healthUrl) return {id:"neon",name:"Neon",kind:"database",health:0,status:"bad",latency:null,usage:null,
    detail:"Health-Endpunkt noch nicht konfiguriert",metrics:{},checkedAt:new Date().toISOString()};
  return genericHealth({id:"neon",name:"Neon",kind:"database",url:cfg.healthUrl,token:cfg.healthToken,warnLatency:700});
}
