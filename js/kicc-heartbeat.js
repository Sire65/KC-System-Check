const SCHEMA='kicc.program-heartbeat.v1';
const REMOTE_SCHEMA='kicc.remote-program-heartbeat.v1';
const CHANNEL='kicc-program-heartbeat-v1';
const INSTANCE_KEY='kc-system-check.instance.id.v1';
const VERSION='0.6.8';
let channel=null;try{if('BroadcastChannel'in globalThis)channel=new BroadcastChannel(CHANNEL)}catch{}
function instanceId(){try{let id=localStorage.getItem(INSTANCE_KEY);if(!id){id=`browser-${crypto.randomUUID?.()||Math.random().toString(36).slice(2)}`;localStorage.setItem(INSTANCE_KEY,id)}return id}catch{return'browser'}}
const INSTANCE_ID=instanceId();
const listeners=new Set();
function emit(msg){for(const fn of listeners)try{fn(msg)}catch{}}
export function onProgramHeartbeat(fn){listeners.add(fn);return()=>listeners.delete(fn)}
export function broadcastProgramHeartbeat(extra={}){const payload={schema:SCHEMA,programId:'kc-system-check',programName:'KC System Check',version:VERSION,instanceId:INSTANCE_ID,status:'online',timestamp:new Date().toISOString(),...extra};try{channel?.postMessage(payload)}catch{}emit(payload);return payload}
if(channel)channel.onmessage=e=>{const d=e.data;if(d?.schema===SCHEMA||d?.schema===REMOTE_SCHEMA)emit(d)};
let runtimePromise=null;
async function runtime(){if(runtimePromise)return runtimePromise;runtimePromise=(async()=>{for(const p of ['./config/runtime.json','./config/runtime.public.json'])try{const r=await fetch(p,{cache:'no-store'});if(r.ok)return await r.json()}catch{}return null})();return runtimePromise}
async function sendRemote(extra={}){try{const cfg=await runtime(),ep=cfg?.heartbeatEndpoint;if(!ep)return;const token=cfg.heartbeatUseApiToken?cfg.apiToken:null;const payload=broadcastProgramHeartbeat(extra);await fetch(ep,{method:'POST',headers:{'Content-Type':'application/json',...(token?{apikey:token,Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload),keepalive:true})}catch{}}
setTimeout(()=>sendRemote({event:'startup'}),1200);
setInterval(()=>sendRemote({event:'heartbeat'}),60000);
window.addEventListener('pagehide',()=>{try{broadcastProgramHeartbeat({event:'pagehide',status:'offline'})}catch{}});
