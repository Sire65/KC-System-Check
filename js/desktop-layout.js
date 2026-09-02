const $=s=>document.querySelector(s);
function installStyles(){if($('#kcDesktopLayoutStyles'))return;const s=document.createElement('style');s.id='kcDesktopLayoutStyles';s.textContent=`
@media(min-width:1000px){
  body{min-width:1000px}
  .topbar{padding-left:max(24px,calc((100vw - 1400px)/2 + 24px));padding-right:max(24px,calc((100vw - 1400px)/2 + 24px))}
  .topbar h1{font-size:26px}.topbar .eyebrow{font-size:11px}.header-meta{gap:9px}.badge{font-size:12px;padding:6px 10px}.icon-btn{padding:10px 13px}
  main{max-width:1400px;padding:16px 22px 24px}
  footer{max-width:1400px;padding:0 22px;margin-top:12px}
  .hero{grid-template-columns:86px minmax(280px,1fr) 320px 230px;gap:18px;padding:18px 22px}
  .hero>.status-orb{width:78px;height:78px}
  .health-value{font-size:46px}.health-text{font-size:18px}.coverage{font-size:12px}
  .hero>#oneTouchBtn{grid-column:4;min-width:210px;padding:14px 20px;font-size:14px}
  .kc-evidence{font-size:11px!important}
  .desktop-hero-extra{grid-column:3;grid-row:1;display:grid;gap:7px;align-self:stretch;min-width:0}
  .desktop-hero-extra-row{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;align-items:center;padding:7px 11px;border:1px solid var(--line);border-radius:10px;background:#0e1728;min-width:0}
  .desktop-hero-extra-row .k{font-size:11px;color:var(--muted)}.desktop-hero-extra-row .v{font-size:13px;font-weight:800;text-align:right;white-space:nowrap;overflow:visible;text-overflow:clip;min-width:0}
  .tabs{grid-template-columns:repeat(6,minmax(120px,1fr));gap:10px;margin:14px 0}.tab{padding:11px 8px;font-size:13px}
  #dashboard.view.active{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);gap:14px;align-items:start}
  #dashboard>.gauges{grid-column:1/-1;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
  #dashboard>.card{min-width:0}
  .gauge-card{padding:14px 12px}.gauge-card h3{font-size:16px}.metric{font-size:24px}
  #dashboard>.gauges+.card{grid-column:1;grid-row:2}
  #dashboard>.gauges+.card+.card{grid-column:2;grid-row:2}
  #dashboard>.gauges+.card+.card canvas{min-height:310px}
  .system-card{padding:13px 14px}.system-list{gap:10px}
  .desktop-overview{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:0 0 14px}
  .desktop-overview-card{background:#0e1728;border:1px solid var(--line);border-radius:13px;padding:11px 13px;min-width:0}
  .desktop-overview-card .label{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
  .desktop-overview-card .value{font-size:18px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .desktop-overview-card .sub{font-size:11px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .live-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
  #live.view.active{grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
  #live.view.active>article:first-child{grid-column:1/-1}
  #history.view.active{grid-template-columns:1.15fr .85fr;align-items:start}
}
@media(min-width:1450px){
  main,footer{max-width:1480px}
  .topbar{padding-left:max(28px,calc((100vw - 1480px)/2 + 28px));padding-right:max(28px,calc((100vw - 1480px)/2 + 28px))}
  .hero{grid-template-columns:86px minmax(320px,1fr) 350px 230px}
  .gauge-card canvas{max-height:250px}
}
`;document.head.appendChild(s)}
function text(sel,fallback='—'){const el=$(sel);return(el?.textContent||'').trim()||fallback}
function setHtmlIfChanged(el,html){if(el&&el.innerHTML!==html)el.innerHTML=html}
function ensureOverview(){let host=$('#kcDesktopOverview');const tabs=$('.tabs');if(!tabs)return;if(!host){host=document.createElement('section');host.id='kcDesktopOverview';host.className='desktop-overview';tabs.after(host)}return host}
function findSystemCard(needle){return[...document.querySelectorAll('#systemCards .system-card')].find(card=>(card.querySelector('strong')?.textContent||'').includes(needle))||null}
function cardValue(card){const values=card?[...card.querySelectorAll(':scope > strong')]:[];return(values.at(-1)?.textContent||'—').trim()}
function cardDetail(card){return(card?.querySelector('.muted.small')?.textContent||'').trim()}
function ensureHeroExtra(){const hero=$('.hero');if(!hero)return null;let host=$('#kcDesktopHeroExtra');if(!host){host=document.createElement('div');host.id='kcDesktopHeroExtra';host.className='desktop-hero-extra';const btn=$('#oneTouchBtn');btn?hero.insertBefore(host,btn):hero.appendChild(host)}return host}
function renderHeroExtra(){const host=ensureHeroExtra();if(!host)return;const gh=findSystemCard('GitHub'),mir=findSystemCard('Spiegelung');const mirrorDetail=cardDetail(mir).replace(/^0 Abweichungen\s*·\s*/i,'');const html=`<div class="desktop-hero-extra-row"><span class="k">GitHub</span><span class="v">${cardValue(gh)}</span></div><div class="desktop-hero-extra-row"><span class="k">Spiegelung</span><span class="v">${cardValue(mir)}${mirrorDetail?` · ${mirrorDetail}`:''}</span></div>`;setHtmlIfChanged(host,html)}
function renderOverview(){if(!matchMedia('(min-width:1000px)').matches)return;const host=ensureOverview();if(!host)return;const mode=text('#runtimeMode','—'),last=text('#lastRunLabel','Noch kein Lauf'),coverage=text('#coverageText','—'),core=text('#metricCore','—'),future=text('#metricFuture','—'),mirror=text('#metricMirror','—');const html=`
<div class="desktop-overview-card"><div class="label">Betrieb</div><div class="value">${mode}</div><div class="sub">aktueller Datenweg</div></div>
<div class="desktop-overview-card"><div class="label">Letzter Prüflauf</div><div class="value">${last}</div><div class="sub">zuletzt bestätigter Lauf</div></div>
<div class="desktop-overview-card"><div class="label">Prüfabdeckung</div><div class="value">${coverage}</div><div class="sub">definierte Kernprüfungen</div></div>
<div class="desktop-overview-card"><div class="label">KC Core</div><div class="value">${core}</div><div class="sub">aktuelle Antwortzeit</div></div>
<div class="desktop-overview-card"><div class="label">Academy / Mirror</div><div class="value">${future}</div><div class="sub">Spiegelung ${mirror}</div></div>`;setHtmlIfChanged(host,html);renderHeroExtra()}
function refresh(){installStyles();if(matchMedia('(min-width:1000px)').matches)renderOverview();else{$('#kcDesktopOverview')?.remove();$('#kcDesktopHeroExtra')?.remove()}}
refresh();addEventListener('resize',refresh);let q=false;new MutationObserver(()=>{if(q)return;q=true;requestAnimationFrame(()=>{q=false;if(matchMedia('(min-width:1000px)').matches)renderOverview()})}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
