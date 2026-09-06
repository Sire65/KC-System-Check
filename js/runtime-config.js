// Einzige Quelle fuer die Laufzeitkonfiguration. Frueher lud jedes Modul die
// Datei selbst - fuenf Kopien mit leicht abweichendem Verhalten und fuenf
// Netzabfragen bei jedem Start.
const SOURCES=["./config/runtime.json","./config/runtime.public.json"];
const EMPTY={apiBaseUrl:"",apiToken:"",apiStyle:"generic",mode:"demo"};
let pending=null,cached=null;

async function read(){
  for(const path of SOURCES){
    try{
      const response=await fetch(path,{cache:"no-store"});
      if(!response.ok)continue;
      const config=await response.json();
      if(config&&typeof config==="object")return config;
    }catch{}
  }
  return {...EMPTY};
}

export function loadRuntimeConfig(){
  if(cached)return Promise.resolve(cached);
  if(!pending)pending=read().then(config=>{cached=config;pending=null;return config});
  return pending;
}

// Nur eine Konfiguration mit Prüf-API gilt als betriebsbereit.
export async function loadLiveRuntime(){
  const config=await loadRuntimeConfig();
  return config?.apiBaseUrl?config:{...EMPTY};
}
