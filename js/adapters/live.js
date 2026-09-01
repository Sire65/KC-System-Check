export async function loadRuntime(){
  try{ const r=await fetch("./config/runtime.json",{cache:"no-store"}); if(r.ok)return await r.json(); }catch{}
  return {apiBaseUrl:"",apiToken:"",mode:"demo"};
}
export async function runLive(ids, runtime){
  if(!runtime?.apiBaseUrl) throw new Error("Prüf-API noch nicht konfiguriert");
  const url=`${runtime.apiBaseUrl.replace(/\/$/,"")}/api/check?systems=${encodeURIComponent(ids.join(","))}`;
  const r=await fetch(url,{cache:"no-store",headers:runtime.apiToken?{Authorization:`Bearer ${runtime.apiToken}`}:{}});
  if(!r.ok) throw new Error(`Prüf-API HTTP ${r.status}`);
  return r.json();
}
