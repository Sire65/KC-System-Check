// Aktualisierungshinweis. Drei Festlegungen, die frueher gefehlt haben:
//
//   1. Gefragt wird beim Start, nicht alle sechs Stunden. Wer die App oeffnet,
//      schaut hin; ein Zeitfenster im Hintergrund trifft niemanden.
//   2. "Spaeter" wird gemerkt - zwoelf Stunden fuer genau diesen Stand. Vorher
//      blendete es das Band nur aus und es kam sofort wieder.
//   3. Beim Installieren laeuft ein Zeitbalken. Er zaehlt die Sekunden herunter,
//      die im Versionsverzeichnis stehen, und danach wird wirklich neu geladen -
//      keine Fortschrittsanzeige ohne dahinterliegenden Vorgang.
import"./diagnostics-runtime.js";
const CURRENT_VERSION="0.7.15",VERSION_URL="./version.json";
const $=s=>document.querySelector(s);
const SPAETER='kc-update-spaeter';
const SPAETER_STUNDEN=12;
let waitingWorker=null,angekuendigt=null,installSekunden=5;

function parts(v){return String(v).replace(/^v/i,"").split(".").map(x=>parseInt(x,10)||0)}
function newer(a,b){const A=parts(a),B=parts(b);for(let i=0;i<Math.max(A.length,B.length);i++){const x=A[i]||0,y=B[i]||0;if(x!==y)return x>y}return false}

function spaeterGemerkt(version){
  try{
    const s=JSON.parse(localStorage.getItem(SPAETER)||'null');
    return !!s&&s.version===version&&Date.now()-Number(s.zeit||0)<SPAETER_STUNDEN*3600*1000;
  }catch{return false}
}
function spaeterMerken(version){try{localStorage.setItem(SPAETER,JSON.stringify({version,zeit:Date.now()}))}catch{/* privater Modus */}}
function spaeterVergessen(){try{localStorage.removeItem(SPAETER)}catch{/* egal */}}

function showUpdate(version,note="",verbindlich=false){
  const b=$("#updateBanner"),t=$("#updateText"),spaeter=$("#laterUpdateBtn"),install=$("#installUpdateBtn");
  if(!b)return;
  angekuendigt=version;
  t.textContent=`Version ${version} ist verfügbar${note?" · "+note:""}`;
  // Eine verbindliche Fassung kennt kein Spaeter: aufschieben waere dort keine
  // sinnvolle Wahl.
  if(spaeter)spaeter.classList.toggle("hidden",!!verbindlich);
  if(install){install.disabled=false;install.textContent="Jetzt aktualisieren"}
  $("#updateProgress")?.classList.remove("an");
  const bar=$("#updateBar");if(bar)bar.style.width="0%";
  b.classList.remove("hidden");
}

// Zaehlt echte Sekunden herunter und ruft danach auf, was angekuendigt war.
function balkenLaufenLassen(sekunden,fertig){
  const huelle=$("#updateProgress"),bar=$("#updateBar"),rest=$("#updateRemaining");
  if(!huelle||!bar||!rest){fertig();return}
  huelle.classList.add("an");
  const dauer=Math.max(2,Math.min(30,Number(sekunden)||5))*1000,start=Date.now();
  const uhr=setInterval(()=>{
    const anteil=Math.min(1,(Date.now()-start)/dauer),uebrig=Math.ceil((dauer-(Date.now()-start))/1000);
    bar.style.width=(anteil*100).toFixed(1)+"%";
    rest.textContent=uebrig>0?`Wird vorbereitet – Neustart in ${uebrig} Sekunde${uebrig===1?"":"n"} …`:"Neustart …";
    if(anteil>=1){clearInterval(uhr);fertig()}
  },100);
}

export async function checkForAppUpdate({silent=true}={}){
  try{
    const r=await fetch(`${VERSION_URL}?t=${Date.now()}`,{cache:"no-store"});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const info=await r.json();
    if(!newer(info.version,CURRENT_VERSION)){
      spaeterVergessen();
      if(!silent)alert(`KC System Check ist aktuell (Version ${CURRENT_VERSION}).`);
      return null;
    }
    // Von selbst darf der Hinweis nicht nerven. Wer ausdruecklich nachsieht,
    // bekommt ihn immer.
    if(silent&&!info.verbindlich&&spaeterGemerkt(info.version))return info;
    installSekunden=info.installSekunden;
    showUpdate(info.version,info.note||"",!!info.verbindlich);
    return info;
  }catch(e){
    // Ein nicht erreichbares Verzeichnis ist keine Aktualitaet und wird nie
    // als "aktuell" gemeldet.
    if(!silent)alert(`Update-Prüfung nicht möglich: ${e.message}`);
    return null;
  }
}

async function uebernehmen(){
  const install=$("#installUpdateBtn");
  try{
    if(waitingWorker){
      waitingWorker.postMessage({type:"SKIP_WAITING"});
      // controllerchange laedt neu. Bleibt es aus - alter Worker, kein
      // Controller - laedt der Rueckfall nach drei Sekunden selbst.
      setTimeout(()=>location.reload(),3000);
      return;
    }
    const reg=await navigator.serviceWorker?.getRegistration();
    if(reg)await reg.update();
    location.reload();
  }catch(e){
    if(install){install.disabled=false;install.textContent="Jetzt aktualisieren"}
    $("#updateProgress")?.classList.remove("an");
    alert(`Update konnte nicht gestartet werden: ${e.message}`);
  }
}

export function setupUpdater(){
  $("#laterUpdateBtn")?.addEventListener("click",()=>{
    if(angekuendigt)spaeterMerken(angekuendigt);
    $("#updateBanner")?.classList.add("hidden");
  });
  $("#installUpdateBtn")?.addEventListener("click",()=>{
    const install=$("#installUpdateBtn"),spaeter=$("#laterUpdateBtn");
    install.disabled=true;install.textContent="Wird vorbereitet …";
    if(spaeter)spaeter.disabled=true;
    spaeterVergessen();
    balkenLaufenLassen(installSekunden,uebernehmen);
  });
  if("serviceWorker"in navigator){
    let hadController=!!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(hadController)location.reload();hadController=true});
    navigator.serviceWorker.ready.then(reg=>{
      if(reg.waiting)waitingWorker=reg.waiting;
      reg.addEventListener("updatefound",()=>{
        const worker=reg.installing;
        worker?.addEventListener("statechange",()=>{
          if(worker.state==="installed"&&navigator.serviceWorker.controller){waitingWorker=worker;showUpdate("neu","App-Dateien sind bereit")}
        });
      });
    }).catch(()=>{});
  }
  // Bei jedem Start. Was zurueckgestellt wurde, schweigt trotzdem zwoelf Stunden.
  checkForAppUpdate({silent:true});
}
