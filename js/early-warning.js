// Die Frühwarnung liest Zahlen aus der Oberfläche. Das ging mehrfach schief:
//
// 1. Der Sammler nahm '#usage .card' und '#capacity .card' - das sind die
//    UMSCHLIESSENDEN Tafeln, nicht die einzelnen Kacheln. Gelesen wurde damit
//    die erste Zahl mit Einheit irgendwo in der Tafel, beschriftet mit der
//    Überschrift der ersten Kachel. Zahl und Bezeichnung gehörten nicht
//    zusammen. Jetzt werden die Kacheln selbst gelesen.
//
// 2. Ändert sich, WIE eine Zahl gemessen wird, ist der Sprung kein Trend. Am
//    2026-09-06 wurde der Verbrauch von der gedeckelten Verlaufsliste auf eine
//    Zählung in der Datenbank umgestellt; die Frühwarnung meldete daraufhin
//    "steigend +1662 %". Ein Sprung um mehr als das Fünffache gilt jetzt als
//    Messumstellung: die Reihe beginnt neu, statt eine Entwicklung zu behaupten.
//
// 3. Prozentwerte allein sind bei Antwortzeiten irreführend. 120 -> 360 ms sind
//    +200 %, aber weiterhin eine schnelle Antwort. Für Millisekunden gilt daher
//    zusätzlich eine absolute Relevanzschwelle und ein Nachhaltigkeitsfilter:
//    niedrige Latenzen bleiben ruhig, ein einzelner Spike reicht nicht und eine
//    sichtbare Warnung braucht mehrere erhöhte Messungen.
//
// Der Speichername trägt deshalb eine neue Fassung - alte, anders bewertete
// Reihen werden verworfen statt weitergerechnet.
const STORE='kc-early-warning-v4',MAX=12,SPRUNG=5;
const LATENZ_BODEN_MS=600,LATENZ_WATCH_MS=700,LATENZ_WARN_MS=900,LATENZ_DELTA_WARN_MS=250;
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
function load(){try{return JSON.parse(localStorage.getItem(STORE)||'{}')||{}}catch{return{}}}
function save(v){try{localStorage.setItem(STORE,JSON.stringify(v))}catch{}}
// Ein Reihenname wie "metric-1" ist als Warnung wertlos, und er haengt am
// Platz im Baum: verschiebt sich die Reihenfolge, wandert die Messreihe auf ein
// anderes Feld. Ohne erkennbaren Namen wird deshalb gar nicht beobachtet.
function key(el){const n=el.dataset.system||el.dataset.id||el.querySelector('strong')?.textContent||el.querySelector('h3')?.textContent||'';const k=n.trim().toLowerCase().slice(0,80);return k||null}
// Die ausgezeichnete Zahl geht vor. Ohne sie wurde aus "210.4 / 500 MB" die
// 500 gelesen - die Freigrenze, nicht die Belegung. Eine Konstante kann keinen
// Trend zeigen; beobachtet wurde also nichts.
function metric(el){
  const av=Number(el.dataset.kcMetric);
  if(Number.isFinite(av))return{value:av,unit:(el.dataset.kcUnit||'').toLowerCase()||'?'};
  const t=(el.textContent||'').replace(/,/g,'.'),m=t.match(/(\d+(?:\.\d+)?)\s*(ms|%|mb|gb)\b/i);
  return m?{value:Number(m[1]),unit:m[2].toLowerCase()}:null;
}
function collect(){return $$('#live .live-kpi,#live .live-device,#capacity .capacity-card,#usage .usage-card,.gauge-card').filter(el=>el.dataset.kcTrend!=='off').map(el=>({el,k:key(el),m:metric(el)})).filter(x=>x.k&&x.m&&Number.isFinite(x.m.value))}
function sample(){const db=load(),now=Date.now();for(const x of collect()){let a=db[x.k]||[];const last=a[a.length-1];
  // Eine andere Einheit oder ein Sprung um mehr als das Fuenffache heisst:
  // hier wird etwas anderes gemessen als vorher. Dann ist die alte Reihe
  // wertlos - sie faengt neu an, statt eine Entwicklung zu erfinden.
  if(last&&(last.u!==x.m.unit||(last.v>0&&(x.m.value/last.v>=SPRUNG||last.v/Math.max(x.m.value,1e-9)>=SPRUNG))))a=[];
  const neu=a[a.length-1];
  if(!neu||now-neu.t>45000||neu.v!==x.m.value)a.push({t:now,v:x.m.value,u:x.m.unit});
  db[x.k]=a.slice(-MAX)}save(db);return db}
function latencyTrend(recent,first,last,pct){
  const delta=last-first;
  // Unterhalb des Bodens sind auch große Prozentzahlen normales Netzrauschen.
  if(last<LATENZ_BODEN_MS||delta<150)return null;
  // Ein einzelner hoher Messwert ist noch keine Entwicklung. Mindestens zwei
  // der letzten drei Werte müssen bereits im erhöhten Bereich liegen.
  const nachhaltig=recent.slice(-3).filter(x=>x.v>=LATENZ_BODEN_MS).length>=2;
  const steigendeSchritte=recent.slice(1).filter((x,i)=>x.v>=recent[i].v).length;
  if(!nachhaltig||steigendeSchritte<2)return null;
  if(last>=LATENZ_WARN_MS&&delta>=LATENZ_DELTA_WARN_MS&&pct>=35)
    return{level:'warn',text:`Antwortzeit ${Math.round(last)} ms · nachhaltig steigend +${Math.round(pct)} % in ${recent.length} Messungen`};
  if(last>=LATENZ_WATCH_MS&&delta>=200&&pct>=25)
    return{level:'watch',text:`Antwortzeit ${Math.round(last)} ms · Tendenz +${Math.round(pct)} %`};
  return null;
}
function trend(a){
  if(!a||a.length<4)return null;
  const recent=a.slice(-4),first=recent[0].v,last=recent.at(-1).v,unit=recent.at(-1).u;
  if(first===0||recent.some(x=>x.u!==unit))return null;
  const delta=last-first,pct=delta/Math.abs(first)*100;
  if(unit==='ms')return latencyTrend(recent,first,last,pct);
  // Auch Prozentwerte sollen bei niedriger Auslastung nicht wegen winziger
  // absoluter Änderungen Alarmoptik erzeugen. Relevant wird es ab 60 % oder
  // bei mindestens 10 Prozentpunkten Zuwachs.
  if(unit==='%'&&last<60&&delta<10)return null;
  if(unit==='mb'&&delta<25)return null;
  if(unit==='gb'&&delta<0.25)return null;
  const rising=recent.every((x,i)=>i===0||x.v>=recent[i-1].v);
  if(rising&&pct>=20)return{level:'warn',text:`steigend +${Math.round(pct)} % in ${recent.length} Messungen`};
  if(pct>=10)return{level:'watch',text:`Tendenz +${Math.round(pct)} %`};
  return null
}
function warnings(db){return collect().map(x=>({x,t:trend(db[x.k])})).filter(v=>v.t).sort((a,b)=>(a.t.level==='warn'?0:1)-(b.t.level==='warn'?0:1))}
function styles(){if($('#kcEarlyStyles'))return;const s=document.createElement('style');s.id='kcEarlyStyles';s.textContent='.kc-early{margin:8px 0;padding:8px 10px;border:1px solid #a77a25;border-radius:10px;background:#19170f}.kc-early-row{padding:4px 0}.kc-early-warn{color:#ffd166;font-weight:800}';document.head.appendChild(s)}
function render(){styles();const db=sample(),all=warnings(db),w=all.filter(v=>v.t.level==='warn'),old=$('#kcEarlyWarning');globalThis.KC_EARLY_WARNING_STATE={observed:all.length,actionable:w.length,at:new Date().toISOString()};if(!w.length){old?.remove();return}const host=old||document.createElement('div');host.id='kcEarlyWarning';host.className='kc-early';host.innerHTML=`<strong>Frühwarnung · ${w.length} relevante${w.length===1?'r':' Trends'}</strong><div class="muted small">Noch keine Störung · Entwicklung gezielt beobachten.</div>${w.slice(0,3).map(({x,t})=>`<div class="kc-early-row"><span class="kc-early-warn">BEOBACHTEN</span> · ${(x.el.querySelector('strong')?.textContent||x.k).trim()} · ${t.text}</div>`).join('')}`;if(!old)($('.tabs')||$('#kcQualityReport')||$('.hero'))?.before(host)}
let q=false;function schedule(){if(q)return;q=true;setTimeout(()=>{q=false;render()},500)}
render();new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
