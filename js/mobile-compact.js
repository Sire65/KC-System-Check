const $=s=>document.querySelector(s);
function installStyles(){if($("#kcMobileCompactStyles"))return;const s=document.createElement("style");s.id="kcMobileCompactStyles";s.textContent=`
@media(max-width:620px){
  main{padding:8px 10px}
  .topbar{padding:9px 10px}.topbar .eyebrow{font-size:8px}.topbar h1{font-size:18px;margin-bottom:0}.header-meta{gap:5px}.badge{padding:4px 7px;font-size:10px}.icon-btn{padding:8px 10px;border-radius:11px}
  .hero{grid-template-columns:46px minmax(0,1fr) auto;gap:8px;padding:10px 11px;border-radius:14px;align-items:center}
  .hero>.status-orb{width:44px;height:44px;grid-column:1;grid-row:1/3;box-shadow:0 0 18px currentColor,inset 0 0 12px rgba(255,255,255,.2)}
  .hero>div:nth-child(2){grid-column:2;grid-row:1/3;min-width:0;display:grid;grid-template-columns:auto 1fr;column-gap:7px;align-items:end}
  .hero>div:nth-child(2)>.muted:first-child{display:none}
  .health-value{font-size:28px;line-height:1}.health-text{font-size:15px;margin:0;align-self:center;white-space:normal}.coverage{grid-column:1/-1;margin-top:3px;font-size:10px}
  .hero>#oneTouchBtn{grid-column:3;grid-row:1/3;min-width:74px;min-height:44px;padding:8px 10px;border-radius:11px;font-size:12px}
  .tabs{margin:8px 0;gap:5px}.tab{padding:7px 10px;border-radius:9px;font-size:13px}
  .view{gap:8px}.grid{gap:8px}.gauges{gap:8px}.gauge-card{padding:9px 7px;border-radius:14px}.gauge-card h3{font-size:15px;margin-bottom:2px}.metric{font-size:18px;margin-top:-9px}.card{border-radius:14px}
  footer{margin-top:8px}
  body.kc-has-alerts .hero{grid-template-columns:54px 1fr;padding:12px;align-items:center}
  body.kc-has-alerts .hero>.status-orb{width:52px;height:52px;grid-column:1;grid-row:1}
  body.kc-has-alerts .hero>div:nth-child(2){grid-column:2;grid-row:1;display:block}
  body.kc-has-alerts .hero>div:nth-child(2)>.muted:first-child{display:block;font-size:10px}
  body.kc-has-alerts .health-value{font-size:34px}.body.kc-has-alerts .health-text{font-size:15px}
  body.kc-has-alerts .hero>#oneTouchBtn{grid-column:1/-1;grid-row:auto;width:100%;font-size:14px}
  body.kc-has-alerts .hero>#kcGlobalHelpBtn,body.kc-has-alerts .hero>#kcSelfCheck,body.kc-has-alerts .hero>#kcQualityStrip{grid-column:1/-1;width:100%}
}
`;document.head.appendChild(s)}
function buttonLabel(){const b=$("#oneTouchBtn");if(!b)return;const mobile=matchMedia('(max-width:620px)').matches&&!document.body.classList.contains('kc-has-alerts');const label=mobile?'Prüfen':'ONE TOUCH · Alles prüfen';if(b.textContent!==label&&!b.disabled)b.textContent=label}
function refresh(){installStyles();buttonLabel()}
refresh();addEventListener('resize',refresh);new MutationObserver(()=>requestAnimationFrame(buttonLabel)).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
