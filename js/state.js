// Einziger Zustandsspeicher der App. Bewusst ohne Importe von Feature-Modulen,
// damit diese sich auf einen fertig initialisierten Zustand verlassen koennen.
function safeJson(key,fallback){
  try{
    const raw=localStorage.getItem(key);
    if(raw==null||raw==="")return fallback;
    const parsed=JSON.parse(raw);
    return parsed??fallback;
  }catch(error){
    try{localStorage.removeItem(key)}catch{}
    console.warn(`[KC System Check] Ungültiger Browser-Speicher verworfen: ${key}`,error);
    return fallback;
  }
}

export const state={
  runtime:null,
  systems:[],
  history:safeJson("kc-system-history",[]),
  settings:{notifyYellow:true,notifyRed:true,warnUsage:70,critUsage:90,...safeJson("kc-system-settings",{})},
  lastRun:null,
  live:null,
  alarmMemory:safeJson("kc-alarm-memory",{}),
  maintenance:safeJson("kc-alarm-maintenance",{}),
  alarmView:null,
  runStartedAt:null,
  cancelRequested:false,
  currentController:null
};
export function saveSettings(){localStorage.setItem("kc-system-settings",JSON.stringify(state.settings))}
export function saveHistory(){localStorage.setItem("kc-system-history",JSON.stringify(state.history))}
export function saveAlarms(){try{localStorage.setItem("kc-alarm-memory",JSON.stringify(state.alarmMemory));localStorage.setItem("kc-alarm-maintenance",JSON.stringify(state.maintenance))}catch{}}

const listeners=new Set();
export function subscribe(listener){listeners.add(listener);try{listener(state)}catch(error){console.warn("[KC System Check] Zustands-Abonnent fehlgeschlagen",error)}return()=>listeners.delete(listener)}
export function publish(){for(const listener of listeners){try{listener(state)}catch(error){console.warn("[KC System Check] Zustands-Abonnent fehlgeschlagen",error)}}}
export function latestRun(){return state.lastRun||state.history[state.history.length-1]||null}
