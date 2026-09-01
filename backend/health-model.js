export function statusFromHealth(health){
  return health >= 90 ? "ok" : health >= 70 ? "warn" : "bad";
}
export function normalizeResult({id,name,kind="service",health=0,latency=null,usage=null,detail="",metrics={}}){
  return {id,name,kind,health,status:statusFromHealth(health),latency,usage,detail,metrics,checkedAt:new Date().toISOString()};
}
export function aggregate(results){
  const valid=results.filter(Boolean);
  const health=valid.length ? valid.reduce((s,r)=>s+r.health,0)/valid.length : 0;
  return {health:Math.round(health*10)/10,status:statusFromHealth(health),results:valid};
}
