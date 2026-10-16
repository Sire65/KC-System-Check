import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// KC Traffic Guard - separate, sparsamer Serverwaechter.
// "calls_15m" ist ein SQL-Lastindikator, NICHT die Supabase-Abrechnungsmetrik Egress.
const BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-kc-watch",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const H = {apikey:SERVICE, Authorization:"Bearer "+SERVICE, "Content-Type":"application/json"};
const json = (data:unknown, status=200) => new Response(JSON.stringify(data), {status,headers:CORS});
async function rpc(name:string, payload:unknown={}) {
  if (!BASE || !SERVICE) throw new Error("service_configuration_missing");
  const r=await fetch(BASE+"/rest/v1/rpc/"+name,{method:"POST",headers:H,body:JSON.stringify(payload)});
  if (!r.ok) throw new Error(name+"_http_"+r.status);
  return await r.json();
}
Deno.serve(async (req:Request) => {
  if (req.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
  if (req.method==="GET") {
    try {
      const status=await rpc("kc_traffic_guard_status");
      // Nur ein anonym nutzbares, technisch begrenztes Statussignal; keine Nutzerdaten/Schluessel.
      return json({ok:true,level:status?.level||"unknown",measured_at:status?.measured_at||null,
        calls_15m:status?.calls_15m??null,baseline_15m:status?.baseline_15m??null,
        detail:status?.detail||"Keine aktuelle Messung",billing_egress_gb:null,
        billing_meter:"not_configured",is_billing_egress:false});
    } catch { return json({ok:false,level:"unknown",detail:"Messstatus zurzeit nicht erreichbar",
      is_billing_egress:false,billing_egress_gb:null},503); }
  }
  if (req.method!=="POST") return json({error:"method_not_allowed"},405);
  const supplied=req.headers.get("x-kc-watch")||"";
  if (!/^[0-9a-f]{64}$/.test(supplied)) return json({error:"not_authorized"},401);
  let verified=false;
  try { verified=(await rpc("kc_traffic_guard_verify",{p_token:supplied}))===true; } catch {return json({error:"guard_auth_unavailable"},503);}
  if (!verified) return json({error:"not_authorized"},403);
  try {
    const sample=await rpc("kc_traffic_guard_sample");
    if (!sample?.notify || !["warning","critical"].includes(sample?.level))
      return json({ok:true,sample:sample?.sample_id,level:sample?.level||"unknown",notified:false});
    const critical=sample.level==="critical";
    const msg=(critical?"KRITISCHE Datenbanklast. ":"Auffaellige Datenbanklast. ")+
      String(sample.detail||"Bitte KC Check pruefen.").slice(0,250)+" KC Check: Kontingent-Waechter. "+
      "Diese Messung ist KEIN offizieller Supabase-Egress-Wert.";
    // Wiederverwendung des bestehenden KC-System-Check -> KC Communicator Push/Email-Regelwerks.
    const rr=await fetch(BASE+"/functions/v1/kc-communication-router",{
      method:"POST",headers:H,
      body:JSON.stringify({
        sourceProgram:"kc-system-check",
        eventKey:critical?"system_error":"system_warning",
        recipients:[],
        priority:critical?"critical":"high",testOnly:false,
        correlationId:"kc-traffic-guard-"+sample.sample_id,
        variables:{
          programName:"KC Traffic Guard",
          eventName:critical?"Supabase-Lastspitze":"Supabase-Fruehwarnung",
          title:critical?"🚨 KC: Datenbanklast kritisch":"⚠️ KC: Datenbanklast erhoeht",
          subject:"KC Supabase-Waechter",
          message:msg,body:msg,text:msg,short:msg,kurz:msg,
          status:sample.level, timestamp:new Date().toISOString(),
          url:"https://sire65.github.io/KC-Clubapp/"
        }
      })
    });
    const delivery=await rr.json().catch(()=>({}));
    const sent=rr.ok && delivery?.ok===true;
    if (sent) await rpc("kc_traffic_guard_ack",{p_sample_id:sample.sample_id,p_level:sample.level});
    return json({ok:sent,level:sample.level,notified:sent,delivery_status:rr.status,
      sample:sample.sample_id},sent?200:502);
  } catch(e) { return json({ok:false,error:"sample_or_delivery_failed",detail:String((e as Error)?.message||e).slice(0,140)},503); }
});