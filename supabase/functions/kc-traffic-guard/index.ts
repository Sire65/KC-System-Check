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
      const [status, rows]=await Promise.all([
        rpc("kc_traffic_guard_status"),
        rpc("kc_traffic_guard_row_status").catch(()=>null)
      ]);
      const severity=(x:string)=>x==="critical"?2:x==="warning"?1:x==="normal"?0:-1;
      const loadLevel=String(status?.level||"unknown"), rowLevel=String(rows?.level||"unknown");
      const overall=severity(rowLevel)>severity(loadLevel)?rowLevel:loadLevel;
      const bothNormal=loadLevel==="normal"&&rowLevel==="normal";
      const level=severity(overall)>0?overall:bothNormal?"normal":"unknown";
      const detail=severity(rowLevel)>severity(loadLevel)?
        String(rows?.detail||"Auffaellige Ergebnismenge"):
        String(status?.detail||"Keine aktuelle Messung");
      // KC Traffic Guard v3: geplant = die auffaellige Messung hat eine bekannte, geplante Ursache (Notfall-Paket, neue Version, Datensicherung).
      const geplant=severity(level)>0 && (severity(loadLevel)<=0||status?.geplant===true) && (severity(rowLevel)<=0||rows?.geplant===true);
      // Alle Werte sind SQL-Lastindikatoren; offizielle GB bleiben absichtlich leer.
      return json({ok:true,level,load_level:loadLevel,row_level:rowLevel,
        measured_at:status?.measured_at||null,rows_measured_at:rows?.measured_at||null,
        calls_15m:status?.calls_15m??null,baseline_15m:status?.baseline_15m??null,
        rows_15m:rows?.rows_15m??null,rows_baseline_15m:rows?.baseline_15m??null,
        detail,geplant,rows_detail:rows?.detail||"Noch keine Zeilenmessung",
        billing_egress_gb:null,billing_meter:"not_configured",is_billing_egress:false});
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
    // Die zweite Messung ist unabhaengig: Ausfall dieses neuen Moduls darf
    // die vorhandenen SQL-Aufrufalarme nicht blockieren.
    const rowSample=await rpc("kc_traffic_guard_row_sample").catch(()=>null);
    const signals=[sample,rowSample].filter(x=>x?.notify && ["warning","critical"].includes(x?.level));
    const critical=signals.some(x=>x.level==="critical");
    const level=critical?"critical":signals.length?"warning":
      (sample?.level==="normal"&&rowSample?.level==="normal"?"normal":"unknown");
    if (!signals.length)
      return json({ok:true,sample:sample?.sample_id,row_sample:rowSample?.sample_id,
        level,load_level:sample?.level||"unknown",row_level:rowSample?.level||"unknown",
        notified:false,gebremst:sample?.gebremst===true||rowSample?.gebremst===true});
    const msg=(critical?"KRITISCHE Datenbanklast. ":"Auffaellige Datenbanklast. ")+
      signals.map(x=>String(x.detail||"Bitte KC Check pruefen.").slice(0,360)).join(" | ")+
      " KC Check: Lastwaechter. Messungen sind KEINE offiziellen Supabase-Egress-Werte.";
    // Wiederverwendung des bestehenden KC-System-Check -> KC Communicator Push/Email-Regelwerks.
    const rr=await fetch(BASE+"/functions/v1/kc-communication-router",{
      method:"POST",headers:H,
      body:JSON.stringify({
        sourceProgram:"kc-system-check",
        eventKey:critical?"system_error":"system_warning",
        recipients:[],
        priority:critical?"critical":"high",testOnly:false,
        correlationId:"kc-traffic-guard-v2-c"+sample.sample_id+"-r"+(rowSample?.sample_id||0),
        variables:{
          programName:"KC Traffic Guard",
          eventName:critical?"Supabase-Lastspitze":"Supabase-Fruehwarnung",
          title:critical?"🚨 KC: Datenbanklast kritisch":"⚠️ KC: Datenbanklast erhoeht",
          subject:"KC Supabase-Waechter",
          message:msg,body:msg,text:msg,short:msg,kurz:msg,
          status:level, timestamp:new Date().toISOString(),
          url:"https://sire65.github.io/KC-Clubapp/"
        }
      })
    });
    const delivery=await rr.json().catch(()=>({}));
    const sent=rr.ok && delivery?.ok===true;
    if (sent) {
      // Quittiere nur tatsaechlich gemeldete Warnungen, niemals einen Fehlversuch.
      if (sample?.notify) await rpc("kc_traffic_guard_ack",{p_sample_id:sample.sample_id,p_level:sample.level});
      if (rowSample?.notify) await rpc("kc_traffic_guard_row_ack",{p_sample_id:rowSample.sample_id,p_level:rowSample.level});
    }
    return json({ok:sent,level,notified:sent,delivery_status:rr.status,
      sample:sample.sample_id,row_sample:rowSample?.sample_id},sent?200:502);
  } catch(e) { return json({ok:false,error:"sample_or_delivery_failed",detail:String((e as Error)?.message||e).slice(0,140)},503); }
});