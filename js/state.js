import"./health-assistant.js";
import"./early-warning.js";
import"./self-check.js";
import"./kicc-heartbeat.js";
import"./mobile-compact.js";
import"./desktop-layout.js";
import"./verification-profile.js";
import"./alert-settings.js";
import"./delivery-proof.js";
import"./health-empty-guard.js";
import"./action-progress.js";
import"./remote-operations.js";

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
  cancelRequested:false,
  currentController:null
};
export function saveSettings(){localStorage.setItem("kc-system-settings",JSON.stringify(state.settings))}
export function saveHistory(){localStorage.setItem("kc-system-history",JSON.stringify(state.history))}
