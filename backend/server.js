import http from "node:http";
import { config } from "./config.js";
import { aggregate } from "./health-model.js";
import { checkSupabase } from "./adapters/supabase.js";
import { checkNeon } from "./adapters/neon.js";
import { checkMirror } from "./adapters/mirror.js";
import { checkB2 } from "./adapters/b2.js";

const adapters={supabase:()=>checkSupabase(config.supabase),neon:()=>checkNeon(config.neon),mirror:()=>checkMirror(config.mirror),b2:()=>checkB2(config.b2)};
const json=(res,status,body)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*"});res.end(JSON.stringify(body));};
function authorized(req){ return !config.apiToken || req.headers.authorization===`Bearer ${config.apiToken}`; }

http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS"){res.writeHead(204,{"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type"});return res.end();}
  if(req.url==="/api/ping") return json(res,200,{ok:true,version:"0.2.0",time:new Date().toISOString()});
  if(req.url?.startsWith("/api/check")){
    if(!authorized(req)) return json(res,401,{error:"unauthorized"});
    const u=new URL(req.url,"http://localhost"); const ids=(u.searchParams.get("systems")||Object.keys(adapters).join(",")).split(",").filter(x=>adapters[x]);
    const started=Date.now(); const results=[];
    for(const id of ids) results.push(await adapters[id]());
    return json(res,200,{...aggregate(results),duration_ms:Date.now()-started,checkedAt:new Date().toISOString()});
  }
  return json(res,404,{error:"not_found"});
}).listen(config.port,()=>console.log(`KC System Check API auf Port ${config.port}`));
