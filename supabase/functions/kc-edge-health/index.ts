import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"GET,OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});
const ACCOUNT=(Deno.env.get("CLOUDFLARE_ACCOUNT_ID")||"").trim();
const TOKEN=(Deno.env.get("CLOUDFLARE_API_TOKEN")||"").trim();
const API="https://api.cloudflare.com/client/v4";
const safe=(v:unknown,n=120)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").slice(0,n);
async function cf(path:string){const started=Date.now();const r=await fetch(API+path,{headers:{Authorization:`Bearer ${TOKEN}`},cache:"no-store"});let body:any=null;try{body=await r.json()}catch{}return{ok:r.ok&&body?.success!==false,status:r.status,ms:Date.now()-started,body};}
const state=(configured:boolean,ok:boolean)=>!configured?"not_configured":ok?"healthy":"critical";

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="GET")return json({error:"GET erforderlich"},405);
  if(!ACCOUNT||!TOKEN)return json({id:"kc_edge",name:"Cloudflare / Edge",kind:"edge",provider:"cloudflare",status:"not_configured",worker:"not_configured",hyperdrive:"not_configured",kv:"not_configured",latencyMs:null,checkedAt:new Date().toISOString(),detail:"Cloudflare API noch nicht konfiguriert"});
  const account=encodeURIComponent(ACCOUNT);
  const [workers,hyperdrive,kv]=await Promise.all([
    cf(`/accounts/${account}/workers/scripts`),
    cf(`/accounts/${account}/hyperdrive/configs`),
    cf(`/accounts/${account}/storage/kv/namespaces`)
  ]);
  const all=[workers,hyperdrive,kv],ok=all.every(x=>x.ok),latency=Math.max(...all.map(x=>x.ms));
  return json({
    id:"kc_edge",name:"Cloudflare / Edge",kind:"edge",provider:"cloudflare",
    status:ok?"healthy":"warning",worker:state(true,workers.ok),hyperdrive:state(true,hyperdrive.ok),kv:state(true,kv.ok),
    latencyMs:latency,checkedAt:new Date().toISOString(),
    detail:ok?"Cloudflare API erreichbar":`API unvollständig: Worker ${workers.status}, Hyperdrive ${hyperdrive.status}, KV ${kv.status}`,
    account:safe(ACCOUNT,12)
  });
});
