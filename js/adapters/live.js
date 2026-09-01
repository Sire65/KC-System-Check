export async function loadRuntime(){
  try{const r=await fetch("./config/runtime.json",{cache:"no-store"});if(r.ok)return await r.json()}catch{}
  return{apiBaseUrl:"",apiToken:"",apiStyle:"generic",mode:"demo"}
}
export async function runLive(ids,runtime){
  if(!runtime?.apiBaseUrl)throw new Error("Prüf-API noch nicht konfiguriert");
  const selected=encodeURIComponent(ids.join(","));
  const direct=runtime.apiStyle==="supabase-edge";
  const url=direct?`${runtime.apiBaseUrl}${runtime.apiBaseUrl.includes("?")?"&":"?"}systems=${selected}`:`${runtime.apiBaseUrl.replace(/\/$/,"")}/api/check?systems=${selected}`;
  const headers={};
  if(runtime.apiToken){headers.Authorization=`Bearer ${runtime.apiToken}`;if(direct)headers.apikey=runtime.apiToken}
  const r=await fetch(url,{cache:"no-store",headers});
  if(!r.ok)throw new Error(`Prüf-API HTTP ${r.status}`);
  const data=await r.json();
  if(data?.error)throw new Error(data.error);
  return data
}
