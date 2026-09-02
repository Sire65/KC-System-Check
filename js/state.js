import"./health-assistant.js";
import"./early-warning.js";
import"./self-check.js";
import"./kicc-heartbeat.js";

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
  systems:[],
  history:Array.isArray(safeJson("kc-history",[]))?safeJson("kc-history",[]):[],
  lastRun:null,
  settings:{
    autoEnabled:false,
    autoTime:"06:30",
    autoProfile:"standard",
    notifyYellow:true,
    notifyRed:true,
    warnUsage:70,
    critUsage:90,
    ...safeJson("kc-settings",{})
  },
  abortController:null,
  runtime:null
};

export function saveSettings(){
  try{localStorage.setItem("kc-settings",JSON.stringify(state.settings))}catch(error){console.warn("[KC System Check] Einstellungen konnten nicht gespeichert werden",error)}
}

export function saveHistory(){
  try{localStorage.setItem("kc-history",JSON.stringify(state.history.slice(-100)))}catch(error){console.warn("[KC System Check] Verlauf konnte nicht gespeichert werden",error)}
}
