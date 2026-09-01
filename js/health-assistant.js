const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

const UNKNOWN_WORDS=["veraltet","historisch","unbekannt","noch keine telemetrie","anbindung vorbereitet","telemetrie vorbereitet","heartbeat-anbindung vorbereitet","nicht aktiv","statusdaten veraltet"];
const SEVERE_WORDS=["störung","fehler aktuell","critical","handlungsbedarf"];

function textOf(el){return(el?.textContent||"").replace(/\s+/g," ").trim().toLowerCase()}
function hasAny(text,words){return words.some(w=>text.includes(w))}

export function classifyCoverage(root=document){
  const live=textOf(root.querySelector?.("#live"));
  const findings=textOf(root.querySelector?.("#findings"));
  const severe=hasAny(live,SEVERE_WORDS)||hasAny(findings,SEVERE_WORDS);
  const incomplete=hasAny(live,UNKNOWN_WORDS);
  return{severe,incomplete};
}

export function solutionFor(text=""){
  const t=String(text).toLowerCase();
  if(t.includes("veraltet")||t.includes("historisch"))return["Status zuerst neu laden und den Zeitstempel prüfen.","Bleibt der Status alt: Verbindung, Zugangsdaten und letzten erfolgreichen Heartbeat des betroffenen Systems prüfen.","Alte Fehlerhistorie nicht als aktuelle Störung werten; erst nach frischer Gegenprobe eskalieren."];
  if(t.includes("heartbeat")||t.includes("telemetrie")||t.includes("nicht aktiv")||t.includes("anbindung vorbereitet"))return["Betroffenes Programm starten und dessen Leitstand-/Heartbeat-Anbindung prüfen.","Programm-ID, Version und letzten Heartbeat kontrollieren.","Wenn weiterhin keine Daten eintreffen: Netzwerkweg und Backend-Empfang prüfen."];
  if(t.includes("spiegel")||t.includes("mirror")||t.includes("abweich"))return["Zuerst KC Core und Future Academy prüfen.","Danach die Spiegelung erneut ausführen und Abweichungszahl vergleichen.","Bei verbleibenden Abweichungen Fremdschlüssel-/Reihenfolgefehler im Spiegelungsprotokoll prüfen."];
  if(t.includes("backup")||t.includes("wiederher"))return["Zeitpunkt des letzten erfolgreichen Backups prüfen.","Integritätsprüfung ausführen, ohne produktive Daten zu verändern.","Falls vorgesehen, Wiederherstellungstest auf Testziel durchführen; erst danach Backup als gesund markieren."];
  if(t.includes("kommunikation")||t.includes("e-mail")||t.includes("brevo")||t.includes("push"))return["Provider-Status und letzten aktuellen Prüfzeitpunkt prüfen.","Zugang/Token serverseitig prüfen; keine Schlüssel im Browser eintragen.","Danach gezielten Kommunikationstest erneut ausführen."];
  if(t.includes("kapaz")||t.includes("mb")||t.includes("%"))return["Aktuelle Belegung mit dem jeweiligen Free-Tier-Limit vergleichen.","Wachstum der letzten 7/30 Tage prüfen, bevor Speicher bereinigt wird.","Bei Annäherung an die Warnschwelle zuerst große Tabellen/Logs identifizieren; nichts pauschal löschen."];
  return["Betroffenen Check einzeln erneut ausführen.","Zeitstempel und letzte erfolgreiche Prüfung vergleichen.","Wenn der Fehler reproduzierbar bleibt, Detailtext sichern und die technische Ursache im zugehörigen System prüfen."];
}

function ensureStyles(){
  if($("#kcProblemHelpStyles"))return;
  const s=document.createElement("style");s.id="kcProblemHelpStyles";s.textContent=`
  .kc-help-btn{margin-top:8px;border:1px solid var(--line);background:var(--card2);color:#fff;border-radius:10px;padding:8px 10px;font-weight:700;min-height:42px}
  .kc-help-summary{margin-top:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#0d1728;font-size:12px;color:var(--muted)}
  .kc-help-modal{position:fixed;inset:0;z-index:50;background:rgba(2,6,14,.82);display:grid;place-items:center;padding:16px}
  .kc-help-panel{width:min(620px,100%);max-height:88vh;overflow:auto;background:#0f1829;border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  .kc-help-panel ol{padding-left:22px}.kc-help-panel li{margin:10px 0;line-height:1.4}.kc-help-head{display:flex;justify-content:space-between;gap:10px;align-items:center}.kc-help-close{min-width:44px;min-height:44px}
  @media(max-width:620px){.kc-help-btn{width:100%}.kc-help-panel{border-radius:15px}}
  `;document.head.appendChild(s);
}

function closeHelp(){$("#kcProblemHelpModal")?.remove()}
function openHelp(title,detail){
  closeHelp();const steps=solutionFor(`${title} ${detail}`);const modal=document.createElement("div");modal.id="kcProblemHelpModal";modal.className="kc-help-modal";modal.innerHTML=`<div class="kc-help-panel" role="dialog" aria-modal="true" aria-label="Lösungsvorschläge"><div class="kc-help-head"><div><div class="eyebrow">Problemhilfe</div><h2>Lösungsvorschläge</h2></div><button class="secondary kc-help-close" type="button">✕</button></div><h3>${escapeHtml(title||"Auffälligkeit")}</h3><div class="muted small">${escapeHtml(detail||"Kein weiterer Detailtext vorhanden.")}</div><ol>${steps.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ol><div class="kc-help-summary">Die Vorschläge ändern nichts automatisch. Erst prüfen, dann gezielt handeln.</div></div>`;document.body.appendChild(modal);modal.querySelector(".kc-help-close").onclick=closeHelp;modal.addEventListener("click",e=>{if(e.target===modal)closeHelp()});
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]))}

function decorateFindings(){
  $$("#findings .finding").forEach(f=>{if(f.querySelector(".kc-help-btn"))return;const title=f.querySelector("strong")?.textContent||"Auffälligkeit";const detail=f.querySelector(".muted")?.textContent||"";const b=document.createElement("button");b.type="button";b.className="kc-help-btn";b.textContent="Lösung anzeigen";b.onclick=()=>openHelp(title,detail);f.appendChild(b)});
}

function ensureGlobalHelp(){
  const hero=$(".hero");if(!hero||$("#kcGlobalHelpBtn"))return;const b=document.createElement("button");b.id="kcGlobalHelpBtn";b.type="button";b.className="secondary kc-help-btn";b.textContent="Probleme & Lösungen";b.onclick=()=>{const candidates=$$("#live .live-device,#live .live-kpi,#findings .finding");const hit=candidates.find(x=>hasAny(textOf(x),[...UNKNOWN_WORDS,...SEVERE_WORDS]))||$("#live");openHelp("Aktueller Leitstand",hit?hit.textContent:"Keine Detaildaten verfügbar")};hero.appendChild(b);
}

function guardOverall(){
  const value=Number($("#healthValue")?.textContent);const text=$("#healthText"),coverage=$("#coverageText"),orb=$("#statusOrb");if(!text||!coverage||!orb)return;const state=classifyCoverage(document);
  if(state.severe){orb.dataset.state="bad";if(value===100)text.textContent="Prüfungen bestanden · Live-Störung vorhanden";return}
  if(state.incomplete&&value===100){orb.dataset.state="warn";text.textContent="Prüfungen bestanden · Live unvollständig";const base=(coverage.textContent||"Prüfabdeckung 100%").split(" · ")[0];coverage.textContent=`${base} · Live-Abdeckung unvollständig`}
}

function refresh(){ensureStyles();ensureGlobalHelp();decorateFindings();guardOverall()}
let queued=false;function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh()})}
const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
refresh();
