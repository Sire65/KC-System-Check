import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};

const okJson=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:CORS});

async function callerRole(req:Request,own:string,service:string){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
  if(!token)return{role:null,reason:"kein_zugangstoken"};
  if(anon&&token===anon)return{role:null,reason:"nur_oeffentlicher_schluessel"};
  if(token.startsWith("sb_publishable_"))return{role:null,reason:"nur_oeffentlicher_schluessel"};
  let user:any=null;
  try{
    const r=await fetch(`${own}/auth/v1/user`,{headers:{apikey:anon||service,Authorization:`Bearer ${token}`}});
    if(r.ok)user=await r.json();
  }catch{}
  if(!user?.id)return{role:null,reason:"anmeldung_ungueltig"};
  try{
    const r=await fetch(`${own}/rest/v1/rpc/kc_system_check_operator_role`,{
      method:"POST",
      headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},
      body:JSON.stringify({p_user:user.id})
    });
    if(r.ok){const role=await r.json();if(typeof role==="string"&&role)return{role,userId:user.id}}
  }catch{}
  return{role:null,reason:"kein_leitstand_zugang",userId:user.id};
}

async function rpc(own:string,service:string,name:string,body:any={}){
  try{
    const started=Date.now();
    const r=await fetch(`${own}/rest/v1/rpc/${name}`,{
      method:"POST",cache:"no-store",
      headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    if(!r.ok)return{ok:false,status:r.status,ms:Date.now()-started,data:null};
    return{ok:true,status:200,ms:Date.now()-started,data:await r.json()};
  }catch{return{ok:false,status:0,ms:null,data:null}}
}

async function credentials(own:string,service:string){
  const r=await rpc(own,service,"kc_external_credentials");
  return r.ok&&r.data&&typeof r.data==="object"?r.data:{};
}

function quoteLiteral(value:string){return `'${value.replaceAll("'","''")}'`}

function neonSignatureSql(tables:string[]){
  const list=tables.map(quoteLiteral).join(",");
  return `
with requested(table_name) as (
  select unnest(array[${list}]::text[])
), cols as (
  select c.table_name,c.ordinal_position,c.column_name,c.data_type,c.udt_name
  from information_schema.columns c
  join requested r on r.table_name=c.table_name
  where c.table_schema='public'
), canonical as (
  select table_name,ordinal_position,
         concat_ws('|',ordinal_position::text,column_name,data_type,udt_name) as line
  from cols
), per_table as (
  select table_name,count(*)::int as column_count,
         md5(string_agg(line,E'\\n' order by ordinal_position)) as signature
  from canonical group by table_name
)
select jsonb_build_object(
  'mode','mirror_compatible_v1',
  'table_count',(select count(*) from per_table),
  'tables',coalesce((select jsonb_agg(jsonb_build_object(
    'table',table_name,'column_count',column_count,'signature',signature
  ) order by table_name) from per_table),'[]'::jsonb)
) as signature`;
}

async function neonSql(cred:any,query:string){
  const host=String(cred?.endpoint||"");
  if(!host||!cred?.secret)return{ok:false,reason:"kein_zugang",ms:null,data:null};
  const started=Date.now();
  try{
    const r=await fetch(`https://${host}/sql`,{
      method:"POST",cache:"no-store",
      headers:{"Neon-Connection-String":String(cred.secret),"Content-Type":"application/json"},
      body:JSON.stringify({query,params:[]})
    });
    const ms=Date.now()-started;
    if(!r.ok)return{ok:false,reason:`http_${r.status}`,ms,data:null};
    const body=await r.json();
    let value=body?.rows?.[0]?.signature??null;
    if(typeof value==="string"){try{value=JSON.parse(value)}catch{value=null}}
    return value?{ok:true,reason:null,ms,data:value}:{ok:false,reason:"leere_antwort",ms,data:null};
  }catch(e){return{ok:false,reason:String((e as Error)?.message||e),ms:Date.now()-started,data:null}}
}

function compare(source:any,target:any,latencyMs:number|null){
  const sourceRows=Array.isArray(source?.tables)?source.tables:[];
  const targetRows=Array.isArray(target?.tables)?target.tables:[];
  const targetMap=new Map(targetRows.map((x:any)=>[String(x.table),x]));
  const missing:string[]=[],different:string[]=[];
  for(const s of sourceRows){
    const name=String(s?.table||"");if(!name)continue;
    const t:any=targetMap.get(name);
    if(!t){missing.push(name);continue}
    if(String(s.signature)!==String(t.signature)||Number(s.column_count)!==Number(t.column_count))different.push(name);
  }
  const status=missing.length||different.length?"critical":"healthy";
  const detail=status==="healthy"
    ?`${sourceRows.length} aktive Spiegel-Tabellen strukturell kompatibel`
    :`${missing.length} fehlen in Neon · ${different.length} mit abweichender Spaltenstruktur`;
  return{
    id:"schema_drift",name:"Schema-Drift Supabase ↔ Neon",kind:"database",
    status,health:status==="healthy"?100:35,latency:latencyMs,usage:null,
    capacityLabel:status==="healthy"?`${sourceRows.length}/${sourceRows.length} kompatibel`:`${missing.length+different.length} Abweichung(en)`,
    detail,
    metrics:{
      mode:"mirror_compatible_v1",
      tables_compared:sourceRows.length,
      tables_different:different.length+missing.length,
      different_tables:different,
      missing_in_neon:missing
    }
  };
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="GET")return okJson({error:"method_not_allowed"},405);
  const own=Deno.env.get("SUPABASE_URL")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const who=await callerRole(req,own,service);
  if(!who.role)return okJson({error:"leitstand_gesperrt",reason:who.reason},403);

  const source=await rpc(own,service,"kc_system_check_schema_signature",{p_schema:"public",p_tables:null});
  if(!source.ok)return okJson({
    result:{id:"schema_drift",name:"Schema-Drift Supabase ↔ Neon",kind:"database",status:"not_configured",health:null,latency:source.ms,usage:null,capacityLabel:"Signatur noch nicht eingespielt",detail:"Serververgleich vorbereitet; die Schema-Signatur ist noch nicht verfügbar",metrics:{mode:"mirror_compatible_v1"}}
  });

  const rows=Array.isArray(source.data?.tables)?source.data.tables:[];
  const names=rows.map((x:any)=>String(x?.table||"")).filter((x:string)=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(x)).slice(0,200);
  if(!names.length)return okJson({result:{id:"schema_drift",name:"Schema-Drift Supabase ↔ Neon",kind:"database",status:"unknown",health:null,latency:source.ms,usage:null,capacityLabel:"Keine Vergleichstabellen",detail:"Es sind keine aktiven Spiegel-Tabellen für den Vergleich vorhanden",metrics:{mode:"mirror_compatible_v1"}}});

  const creds=await credentials(own,service),neonCred=creds.neon_mirror||null;
  const target=await neonSql(neonCred,neonSignatureSql(names));
  if(!target.ok)return okJson({result:{id:"schema_drift",name:"Schema-Drift Supabase ↔ Neon",kind:"database",status:target.reason==="kein_zugang"?"not_configured":"unknown",health:null,latency:target.ms,usage:null,capacityLabel:"Vergleich nicht verfügbar",detail:target.reason==="kein_zugang"?"Neon-Zugang für den Schema-Vergleich ist nicht hinterlegt":"Neon-Schema konnte nicht gelesen werden",metrics:{mode:"mirror_compatible_v1",error:target.reason}}});

  return okJson({result:compare(source.data,target.data,target.ms)});
});
