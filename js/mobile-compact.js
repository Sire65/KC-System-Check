const $=s=>document.querySelector(s);
function installStyles(){if($("#kcMobileCompactStyles"))return;const s=document.createElement("style");s.id="kcMobileCompactStyles";s.textContent=`
@media(max-width:620px){
  main{padding:7px 9px}
  .topbar{padding:8px 9px}.topbar .eyebrow{font-size:8px}.topbar h1{font-size:18px;margin-bottom:0}.header-meta{gap:4px}.badge{padding:4px 7px;font-size:10px}.icon-btn{padding:7px 9px;border-radius:10px}
  .hero{grid-template-columns:40px minmax(0,1fr) auto;gap:7px;padding:8px 10px;border-radius:13px;align-items:center}
  .hero>.status-orb{width:38px;height:38px;grid-column:1;grid-row:1/3;box-shadow:0 0 15px currentColor,inset 0 0 10px rgba(255,255,255,.2)}
  .hero>div:nth-child(2){grid-column:2;grid-row:1/3;min-width:0;display:grid;grid-template-columns:auto 1fr;column-gap:6px;align-items:end}
  .hero>div:nth-child(2)>.muted:first-child{display:none}
  .health-value{font-size:26px;line-height:1}.health-text{font-size:14px;margin:0;align-self:center;white-space:normal}.coverage{grid-column:1/-1;margin-top:2px;font-size:9px}
  .hero>#oneTouchBtn{grid-column:3;grid-row:1/3;min-width:68px;min-height:40px;padding:7px 9px;border-radius:10px;font-size:11px}
  .kc-evidence{grid-column:1/-1!important;margin-top:0!important;line-height:1.2}
  .tabs{margin:7px 0;gap:4px;padding-right:16px;mask-image:linear-gradient(90deg,#000 0,#000 93%,transparent 100%)}.tab{padding:7px 9px;border-radius:9px;font-size:12px}
  .view{gap:7px}.grid{gap:7px}.gauges{gap:7px}.gauge-card{padding:7px 6px;border-radius:13px}.gauge-card h3{font-size:14px;margin-bottom:0}.gauge-card canvas{margin-top:-3px}.metric{font-size:17px;margin-top:-11px}.card{border-radius:13px}
  .system-card,.capacity-card,.usage-card{padding:9px}.system-list,.capacity-list,.usage-list{gap:7px}
  footer{margin-top:7px}
  body.kc-has-alerts .hero{grid-template-columns:50px 1fr;padding:11px;align-items:center}
  body.kc-has-alerts .hero>.status-orb{width:48px;height:48px;grid-column:1;grid-row:1}
  body.kc-has-alerts .hero>div:nth-child(2){grid-column:2;grid-row:1;display:block}
  body.kc-has-alerts .hero>div:nth-child(2)>.muted:first-child{display:block;font-size:10px}
  body.kc-has-alerts .health-value{font-size:32px}body.kc-has-alerts .health-text{font-size:15px}
  body.kc-has-alerts .hero>#oneTouchBtn{grid-column:1/-1;grid-row:auto;width:100%;font-size:13px}
  body.kc-has-alerts .hero>#kcGlobalHelpBtn,body.kc-has-alerts .hero>#kcSelfCheck,body.kc-has-alerts .hero>#kcQualityStrip{grid-column:1/-1;width:100%}
}
`;document.head.appendChild(s)}
function buttonLabel(){const b=$("#oneTouchBtn");if(!b)return;const mobile=matchMedia('(max-width:620px)').matches&&!document.body.classList.contains('kc-has-alerts');const label=mobile?'Prüfen':'ONE TOUCH · Alles prüfen';if(b.textContent!==label&&!b.disabled)b.textContent=label}
function refresh(){installStyles();buttonLabel()}
refresh();addEventListener('resize',refresh);new MutationObserver(()=>requestAnimationFrame(buttonLabel)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
