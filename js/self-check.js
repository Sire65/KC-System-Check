// Selbstkontrolle des Leitstands. Liest ausschliesslich den Zustand, nicht die
// gerenderte Oberflaeche: frueher wurde der Zeitpunkt des letzten Laufs per
// Regex aus dem Fusszeilentext geparst.
import{state,subscribe,latestRun}from"./state.js";
const $=s=>document.querySelector(s);
const STORE='kc-self-check-v1';
const MAX_RUN_AGE=36*60*60*1000;
const LONG_RUNNING=5*60*1000;

function lastRunAt(){
  const run=latestRun();
  const value=Date.parse(run?.at||run?.checked_at||'');
  return Number.isFinite(value)?value:null;
}

function liveDisruption(){
  const live=state.live;
  if(!live)return false;
  const stale=t=>{const v=Date.parse(t||'');return Number.isFinite(v)?Date.now()-v>180000:true};
  const heartbeats=Array.isArray(live.heartbeats)?live.heartbeats:[];
  return heartbeats.some(h=>/(kasse|markt|pos|manager)/i.test(h?.program_id||'')&&stale(h?.measured_at||h?.received_at));
}

function contradiction(){
  const run=latestRun();
  const health=Number(run?.health);
  if(!Number.isFinite(health)||health<100)return null;
  return liveDisruption()?'100 % trotz gemeldeter LIVE-Stoerung':null;
}

export function evaluate(now=Date.now()){
  const issues=[],last=lastRunAt(),started=Number(state.runStartedAt)||0;
  if(last===null)issues.push({level:'warn',text:'Noch kein ausgewerteter Prüflauf vorhanden'});
  else if(now-last>MAX_RUN_AGE)issues.push({level:'warn',text:'Letzter Prüflauf ist älter als 36 Stunden'});
  if(started&&now-started>LONG_RUNNING)issues.push({level:'bad',text:'Prüfung läuft ungewöhnlich lange'});
  if(!state.systems.some(s=>s.enabled))issues.push({level:'warn',text:'Kein aktives Prüfsystem ausgewählt'});
  const conflict=contradiction();
  if(conflict)issues.push({level:'bad',text:`Widersprüchlicher Status: ${conflict}`});
  return issues;
}

function ensureStyle(){
  if($('#kcSelfStyle'))return;
  const s=document.createElement('style');
  s.id='kcSelfStyle';
  s.textContent='.kc-self{margin-top:8px;padding:9px 10px;border:1px solid var(--line);border-radius:10px;background:#0e1728;font-size:12px}.kc-self.ok{display:none}.kc-self.warn{border-color:var(--warn)}.kc-self.bad{border-color:var(--bad)}';
  document.head.appendChild(s);
}

function render(){
  ensureStyle();
  const hero=$('.hero');
  if(!hero)return;
  const issues=evaluate();
  try{localStorage.setItem(STORE,JSON.stringify({checkedAt:Date.now(),issues}))}catch{}
  let box=$('#kcSelfCheck');
  if(!box){box=document.createElement('div');box.id='kcSelfCheck';box.className='kc-self';hero.appendChild(box)}
  const level=issues.some(x=>x.level==='bad')?'bad':issues.length?'warn':'ok';
  box.className=`kc-self ${level}`;
  box.textContent='';
  if(!issues.length)return;
  const title=document.createElement('strong');
  title.textContent=`Leitstand-Selbstkontrolle: ${issues.length} Hinweis${issues.length===1?'':'e'}`;
  const detail=document.createElement('div');
  detail.className='muted';
  detail.textContent=issues.map(x=>x.text).join(' · ');
  box.append(title,detail);
}

subscribe(render);
setInterval(render,30000);
