import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";

const jsonHeaders={"Content-Type":"application/json"};
const fail=(s:number,e:string)=>new Response(JSON.stringify({error:e}),{status:s,headers:jsonHeaders});
const qi=(n:string)=>{if(!/^[a-z0-9_]+$/.test(n))throw new Error(`unsafe identifier: ${n}`);return `"${n}"`;};
const personRefTables=new Set(["kc_core_club_memberships","kc_core_operational_directory","kc_core_pos_aliases","kc_core_app_access","kc_core_user_links","kc_dp_daily_push_preview"]);
const userRefTables=new Set(["kc_core_user_links","kc_dp_memberships","kc_manager_memberships"]);
const redactedTables=new Set(["kc_core_people","kc_dp_memberships","kc_manager_memberships","kc_dp_pilot_testers","kc_dp_push_deliveries","kng_keys","kng_key_assignments","kng_key_movements"]);
const stableHashTables=new Set(["kc_communication_templates","kc_dp_entity_versions","kc_manager_serving_materials","kc_manager_recipe_serving_materials"]);

Deno.serve(async(req)=>{
  if(req.method!=="POST")return fail(405,"POST required");
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const tok=req.headers.get("x-kc-mirror-token")??"";
  const {data:expectedToken,error:te}=await sb.rpc("kc_db_mirror_worker_token");
  if(te||!expectedToken||tok.length<32||tok!==expectedToken)return fail(401,"mirror worker authentication failed");
  let body:any; try{body=await req.json()}catch{return fail(400,"invalid JSON body")}
  const requested=[...new Set<string>(Array.isArray(body.tables)?body.tables:[])];
  if(!requested.length||requested.length>25)return fail(400,"tables must contain 1..25 names");
  for(const t of requested) if(!/^[a-z0-9_]+$/.test(t)) return fail(400,`invalid table name: ${t}`);
  const {data:conn,error:ce}=await sb.rpc("kc_db_mirror_neon_connection");
  if(ce||!conn)return fail(500,"mirror target unavailable");
  let neon:any=null;
  const getNeon=()=>neon??=postgres(conn as string,{max:1,prepare:false,connect_timeout:15,idle_timeout:20,ssl:{rejectUnauthorized:true}});
  const results:any[]=[]; let prs=false,urs=false;
  const batchId=crypto.randomUUID(); const batchTotal=requested.length;
  const syncP=async()=>{const {data,error}=await sb.from("kc_core_people").select("org_id,person_id,active,updated_at");if(error)throw new Error("person refs unavailable");for(const r of data??[])await getNeon().unsafe('insert into public.kc_mirror_person_refs(org_id,person_id,active,source_updated_at,mirrored_at) values ($1,$2,$3,$4::timestamptz,now()) on conflict (org_id,person_id) do update set active=excluded.active,source_updated_at=excluded.source_updated_at,mirrored_at=now()',[r.org_id,r.person_id,r.active,r.updated_at]);};
  const syncU=async()=>{for(const s of ["kc_core_user_links","kc_dp_memberships","kc_manager_memberships"]){const {data,error}=await sb.from(s).select("org_id,user_id,active");if(error)throw new Error("user refs unavailable");for(const r of data??[])await getNeon().unsafe('insert into public.kc_mirror_user_refs(org_id,user_id,active,mirrored_at) values ($1,$2::uuid,$3,now()) on conflict (org_id,user_id) do update set active=excluded.active,mirrored_at=now()',[r.org_id,r.user_id,r.active]);}};
  try{
    for(let i=0;i<requested.length;i++){
      const table=requested[i];if(personRefTables.has(table)&&!prs){await syncP();prs=true}if(userRefTables.has(table)&&!urs){await syncU();urs=true}
      const startMs=Date.now(),started=new Date(startMs).toISOString();
      const {data:snap,error:se}=await sb.rpc("kc_db_mirror_snapshot",{p_table_name:table});if(se||!snap){results.push({table,status:"error",stage:"source_snapshot"});continue}
      const sc=String(snap.row_count??"0"),payload=String(snap.payload_text??"[]");let sh=String(snap.content_hash??"");
      if(stableHashTables.has(table)){const {data:stableHash,error:stableErr}=await sb.rpc("kc_db_mirror_stable_hash",{p_table_name:table});if(stableErr||!stableHash){results.push({table,status:"error",stage:"source_stable_hash"});continue}sh=String(stableHash)}
      const {data:lastOk,error:lastErr}=await sb.from("kc_db_mirror_runs").select("source_rows,metrics,finished_at").eq("run_type","snapshot").eq("status","ok").eq("metrics->>table",table).order("started_at",{ascending:false}).limit(1).maybeSingle();
      if(!lastErr&&lastOk&&String(lastOk.source_rows??"")===sc&&String((lastOk.metrics as any)?.source_hash??"")===sh){
        results.push({table,status:"skipped",reason:"source_unchanged",source_rows:sc,source_hash:sh,last_verified_at:lastOk.finished_at,batch_id:batchId,batch_index:i+1,batch_total:batchTotal});
        continue;
      }
      const bytes=new TextEncoder().encode(payload).byteLength,q=`"public".${qi(table)}`;
      const runningMetrics={table,batch_id:batchId,batch_index:i+1,batch_total:batchTotal,payload_bytes:bytes,privacy_redacted:redactedTables.has(table),write_mode:table==="kc_core_organizations"?"upsert":"replace",hash_mode:stableHashTables.has(table)?"stable_row_hash_v1":"legacy_row_json_v1"};
      const {data:runRow,error:runErr}=await sb.from("kc_db_mirror_runs").insert({run_type:"snapshot",status:"running",started_at:started,source_rows:Number(sc),mismatch_count:0,message:`${table}: transfer running`,metrics:runningMetrics}).select("id").single();const runId=runErr?null:runRow?.id;
      try{
        await getNeon().begin(async tx=>{if(table==="kc_core_organizations"){if(sc!=="0")await tx.unsafe(`insert into ${q}(org_id,name,active,created_at,updated_at) select x.org_id,x.name,x.active,x.created_at,x.updated_at from jsonb_populate_recordset(null::${q},(($1::jsonb #>> '{}')::jsonb)) x on conflict(org_id) do update set name=excluded.name,active=excluded.active,created_at=excluded.created_at,updated_at=excluded.updated_at`,[payload])}else{await tx.unsafe(`delete from ${q}`);if(sc!=="0")await tx.unsafe(`insert into ${q} overriding system value select x.* from jsonb_populate_recordset(null::${q},(($1::jsonb #>> '{}')::jsonb)) x`,[payload])}});
        const verifySql=stableHashTables.has(table)?`select count(*)::bigint row_count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text) collate "C"),'')) content_hash from ${q} t`:`select count(*)::bigint row_count,md5(coalesce(string_agg(row_to_json(t)::text,'' order by row_to_json(t)::text),'')) content_hash from ${q} t`;
        const v=await getNeon().unsafe(verifySql);const tc=String(v[0]?.row_count??"0"),th=String(v[0]?.content_hash??""),ok=sc===tc&&sh===th,endMs=Date.now(),durationMs=Math.max(1,endMs-startMs),bps=Math.round(bytes/(durationMs/1000));
        const metrics={...runningMetrics,source_hash:sh,target_hash:th,duration_ms:durationMs,bytes_per_second:bps,kilobytes_per_second:Number((bps/1024).toFixed(2)),megabytes_per_second:Number((bps/1048576).toFixed(4))};
        const finalRow={status:ok?"ok":"warning",finished_at:new Date(endMs).toISOString(),target_rows:Number(tc),mismatch_count:ok?0:1,message:ok?`${table}: source and target identical`:`${table}: verification mismatch`,metrics};
        if(runId)await sb.from("kc_db_mirror_runs").update(finalRow).eq("id",runId);else await sb.from("kc_db_mirror_runs").insert({run_type:"snapshot",started_at:started,source_rows:Number(sc),...finalRow});results.push({table,status:ok?"ok":"warning",source_rows:sc,target_rows:tc,hash_match:sh===th,payload_bytes:bytes,duration_ms:durationMs,bytes_per_second:bps,batch_id:batchId,batch_index:i+1,batch_total:batchTotal});
      }catch(e){const m=e instanceof Error?e.message:String(e),finalRow={status:"error",finished_at:new Date().toISOString(),mismatch_count:1,message:`${table}: mirror failed`,metrics:{...runningMetrics,error:m.slice(0,1000)}};if(runId)await sb.from("kc_db_mirror_runs").update(finalRow).eq("id",runId);else await sb.from("kc_db_mirror_runs").insert({run_type:"snapshot",started_at:started,source_rows:Number(sc),...finalRow});results.push({table,status:"error",stage:"target_write",message:m,batch_id:batchId,batch_index:i+1,batch_total:batchTotal})}
    }
  }finally{if(neon)await neon.end({timeout:5})}
  const failed=results.some(r=>r.status==="error");return new Response(JSON.stringify({ok:!failed,batch_id:batchId,batch_total:batchTotal,results}),{status:failed?500:200,headers:jsonHeaders});
});