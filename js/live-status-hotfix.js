// Korrektur fuer LIVE-Gesamtstatus: manuelles PC Backup Vault und Marktgeraete ausserhalb des Marktzeitraums.
// Echte Fehlerstatus bleiben unveraendert alarmwirksam.
import{state,subscribe}from"./state.js";

const MARKET_START=new Date(2026,11,4);
const MARKET_END=new Date(2026,11,14);
const BAD=/error|fail|critical|down|corrupt|bad/i;
const WARN=/warn|degrad|partial/i;
let queued=false;

function marketActive(now=new Date()){return now>=MARKET_START&&now<MARKET_END}
function backupTelemetry(){
  const live=state.live?.live&&typeof state.live.live==='object'?state.live.live:state.live||{};
  const m=live?.backup?.machine,k=live?.backup?.kicc;
  return m&&Object.keys(m).length?m:k&&Object.keys(k).length?k:null;
}
function backupSeverity(b){
  if(!b)return'idle';
  const values=[b.status,b.last_backup_status,b.integrity_result,b.restore_result,b.b2_status].filter(Boolean);
  if(values.some(v=>BAD.test(String(v))))return'bad';
  if(values.some(v=>WARN.test(String(v))))return'warn';
  const ok=values.some(v=>/healthy|ok|success|pass|verified/i.test(String(v)));
  return ok?'ok':'idle';
}
function setRow(row,cls,tag){
  const dot=row.querySelector('.dot');
  if(dot){dot.classList.remove('bad','warn','ok','idle');dot.classList.add(cls)}
  const badge=row.querySelector('.kc-core-tag');
  if(badge)badge.textContent=tag;
}
function fixBackup(){
  const host=document.querySelector('#kcLiveCoreList');if(!host)return;
  const row=[...host.querySelectorAll('.kc-core-row')].find(r=>/PC Backup Vault/i.test(r.textContent||''));
  if(!row)return;
  const sev=backupSeverity(backupTelemetry());
  // Das Alter eines manuell gestarteten Backups ist nur Information.
  // Nur echte Status-/Integritaets-/Restorefehler bestimmen die Farbe.
  setRow(row,sev,sev==='bad'?'STÖRUNG':sev==='warn'?'PRÜFEN':sev==='ok'?'OK':'OFFEN');
  const rows=[...host.querySelectorAll('.kc-core-row')];
  const states=rows.map(r=>r.querySelector('.dot')?.classList.contains('bad')?'bad':r.querySelector('.dot')?.classList.contains('warn')?'warn':r.querySelector('.dot')?.classList.contains('ok')?'ok':'idle');
  const overall=states.includes('bad')?'bad':states.includes('warn')?'warn':states.every(s=>s==='ok')?'ok':'idle';
  const badge=document.querySelector('#kcLiveCoreState');
  if(badge){badge.className=`kc-core-state ${overall}`;badge.textContent=overall==='ok'?'ALLES OK':overall==='warn'?'PRÜFEN':overall==='bad'?'STÖRUNG':'TEILWEISE OFFEN'}
}
function fixInactiveMarketDevices(){
  if(marketActive())return;
  document.querySelectorAll('#live .live-device').forEach(el=>{
    const text=String(el.textContent||'');
    if(!/(kasse|markt|pos|manager)/i.test(text))return;
    if(!/(nicht aktiv|vorbereitet|heartbeat|telemetrie)/i.test(text))return;
    el.classList.remove('bad','warn');
    const dot=el.querySelector('.dot');if(dot){dot.classList.remove('bad','warn');dot.classList.add('idle')}
  });
}
function run(){fixBackup();fixInactiveMarketDevices()}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;run()})}
if(typeof document!=='undefined'){
  subscribe(schedule);
  new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','data-state']});
  schedule();
}