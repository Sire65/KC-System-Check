// Einzige Anmeldungsverwaltung der App. Teilt den Schluessel bewusst mit der
// bestehenden Alarm-Administration, damit es nicht zwei getrennte Anmeldungen
// gibt: wer sich am Leitstand anmeldet, ist auch dort entsperrt.
import{loadRuntimeConfig}from"./runtime-config.js";
const SESSION_KEY='kc-system-check-admin-jwt';
const listeners=new Set();

function read(){try{return sessionStorage.getItem(SESSION_KEY)||''}catch{return''}}
function write(token){try{token?sessionStorage.setItem(SESSION_KEY,token):sessionStorage.removeItem(SESSION_KEY)}catch{}}

export function sessionToken(){return read()}
export function hasSession(){return !!read()}

export function onSessionChange(listener){listeners.add(listener);return()=>listeners.delete(listener)}
function announce(){for(const listener of listeners){try{listener(read())}catch(error){console.warn('[KC System Check] Sitzungs-Abonnent fehlgeschlagen',error)}}}

export function clearSession(){write('');announce()}

export async function projectBaseUrl(){
  const config=await loadRuntimeConfig();
  const base=String(config?.apiBaseUrl||'');
  return base.includes('/functions/v1/')?base.split('/functions/v1/')[0]:'';
}

export async function login(email,password){
  const config=await loadRuntimeConfig();
  const base=await projectBaseUrl();
  if(!base||!config?.apiToken)throw new Error('Live-Konfiguration fehlt');
  const response=await fetch(`${base}/auth/v1/token?grant_type=password`,{
    method:'POST',
    headers:{apikey:config.apiToken,'Content-Type':'application/json'},
    body:JSON.stringify({email,password}),
    cache:'no-store'
  });
  const payload=await response.json().catch(()=>({}));
  if(!response.ok||!payload.access_token)throw new Error(payload.error_description||payload.msg||`Anmeldung fehlgeschlagen (HTTP ${response.status})`);
  write(payload.access_token);
  announce();
  return payload;
}
