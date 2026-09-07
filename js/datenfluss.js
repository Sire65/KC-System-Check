// Datenfluss-Karte und Überwachungsläufe im LIVE-Leitstand.
//
// Woher die Zahlen kommen - und was sie NICHT kosten:
// 1. Kanten aus dem Leitstand-Schnappschuss (data.flows, data.heartbeats,
//    data.backup): der wird beim LIVE-Tab ohnehin alle 30 s geladen, hier
//    kommt keine Abfrage dazu.
// 2. Live-Meldungen der Programme über Supabase Realtime Broadcast, Kanal
//    "kc-datenfluss". Broadcast geht am Postgres vorbei (kein Insert, kein
//    Egress aus der Datenbank), nur ein Websocket. Der Client hier ist
//    absichtlich ein eigener Minimal-Client (Phoenix-Protokoll, ~40 Zeilen),
//    weil die PWA keine Fremdbibliothek laden soll (Manifest-Hashes, Offline).
// 3. Die Zeile "Überwachungsläufe" liest den letzten Prüflauf, der schon im
//    Speicher liegt (state.lastRun / Verlauf) - ebenfalls null Traffic.
//
// Alle IDs und Klassen tragen das Präfix kcdf, damit nichts mit Alt-Code kollidiert.
import{state}from"./state.js";

const NS="http://www.w3.org/2000/svg";
const FENSTER_MS=60000;      // "gerade" = letzte 60 s
const VERALTET_MS=150000;    // danach gestrichelt
const KANAL="kc-datenfluss";

// Knoten in drei Spalten: Programme vor Ort · Cloud-Kern · Sicherung
const STANDARD_KNOTEN=[
  {id:"kasse-01",name:"Kasse 01",typ:"geraet",spalte:0},
  {id:"kasse-02",name:"Kasse 02",typ:"geraet",spalte:0},
  {id:"pc-manager",name:"PC-Manager",typ:"geraet",spalte:0},
  {id:"money-butler",name:"Money Butler",typ:"geraet",spalte:0},
  {id:"dp-app",name:"Dienstplan-App",typ:"geraet",spalte:0},
  {id:"pc-backup",name:"PC Backup Vault",typ:"geraet",spalte:0},
  {id:"supabase",name:"Supabase\nKC Core",typ:"db",spalte:1},
  {id:"neon-mirror",name:"Neon\nKC Core Mirror",typ:"db",spalte:2},
  {id:"neon-vault",name:"Neon\nBackup Vault",typ:"db",spalte:2},
  {id:"b2",name:"Backblaze B2",typ:"speicher",spalte:2}
];
const RAND={geraet:"#5aa7ff",db:"#2ecc71",speicher:"#f3c34d"};

// Programm-IDs aus Heartbeats/Flows auf Knoten abbilden
export function knotenId(raw){
  const id=String(raw||"").toLowerCase();
  if(!id)return null;
  if(/kasse|markt|pos/.test(id)){const n=id.match(/(\d{1,2})/);return n?`kasse-${n[1].padStart(2,"0")}`:"kasse-01"}
  if(/manager/.test(id))return"pc-manager";
  if(/money|butler|bargeld/.test(id))return"money-butler";
  if(/dp|dienstplan/.test(id))return"dp-app";
  if(/backup|vault|pbv/.test(id))return"pc-backup";
  if(/supabase|kc[-_]?core|kicc|communication|system-check/.test(id))return"supabase";
  if(/mirror|spiegel/.test(id))return"neon-mirror";
  if(/neon/.test(id))return"neon-vault";
  if(/b2|backblaze/.test(id))return"b2";
  return id.replace(/[^a-z0-9-]/g,"-");
}

function el(name,attrs,parent){const e=document.createElementNS(NS,name);for(const k in attrs||{})e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e}
const bytesText=b=>b<1024?`${b} B`:b<1048576?`${(b/1024).toFixed(1)} KB`:`${(b/1048576).toFixed(2)} MB`;
const vorText=ms=>ms<1000?"gerade eben":ms<60000?`vor ${Math.round(ms/1000)} s`:ms<3600000?`vor ${Math.round(ms/60000)} min`:ms<86400000?`vor ${(ms/3600000).toFixed(1)} h`:`vor ${Math.round(ms/86400000)} T`;
const alter=t=>{const n=Date.parse(t||"");return Number.isFinite(n)?Math.max(0,Date.now()-n):null};

// ---------------------------------------------------------------- Karte
export function karteErzeugen(container,optionen={}){
  const knotenListe=(optionen.knoten||STANDARD_KNOTEN).map(k=>({...k})),knoten={},kanten={};
  const reduziert=globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const B=740,H=420,SPALTE_X=[150,400,640],KB=150,KH=46;
  const css=getComputedStyle(document.documentElement),farbe={
    aktiv:css.getPropertyValue("--ok").trim()||"#2ecc71",fehler:css.getPropertyValue("--bad").trim()||"#ef5a5a",
    warn:css.getPropertyValue("--warn").trim()||"#f3c34d",ruhe:css.getPropertyValue("--idle").trim()||"#64748b",
    text:css.getPropertyValue("--text").trim()||"#f5f7fb",karte:"#0e1728"};

  container.innerHTML=`<div class="kcdf"><style>
    .kcdf svg{display:block;width:100%;height:auto;max-width:900px;margin:0 auto}
    .kcdf-treffer{cursor:pointer}.kcdf-knoten text{pointer-events:none}
    .kcdf-fuss{display:flex;gap:14px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;margin-top:8px}
    .kcdf-legende{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px}
    .kcdf-legende span::before{content:"";display:inline-block;width:18px;height:3px;vertical-align:middle;margin-right:5px;border-radius:2px;background:var(--ok)}
    .kcdf-legende .ruhe::before{background:var(--idle)}.kcdf-legende .fehler::before{background:var(--bad)}
    .kcdf-legende .veraltet::before{background:repeating-linear-gradient(90deg,var(--idle) 0 4px,transparent 4px 7px)}
    .kcdf-detail{min-width:240px;background:#0e1728;border:1px solid var(--line);border-radius:12px;padding:9px 12px;font-size:13px}
    .kcdf-detail:empty{display:none}
    @media(max-width:620px){.kcdf-fuss{flex-direction:column}}
  </style></div>`;
  const wurzel=container.firstElementChild;
  const svg=el("svg",{viewBox:`0 0 ${B} ${H}`,role:"img","aria-label":"Datenfluss zwischen KC-Programmen und Datenbanken"},wurzel);
  const fuss=document.createElement("div");fuss.className="kcdf-fuss";
  fuss.innerHTML=`<div class="kcdf-legende"><span>Verkehr in den letzten 60 s</span><span class="ruhe">kein Verkehr</span><span class="veraltet">keine Meldung seit über 2 min</span><span class="fehler">Fehler dabei</span></div><div class="kcdf-detail"></div>`;
  wurzel.appendChild(fuss);
  const detail=fuss.querySelector(".kcdf-detail");
  const gKanten=el("g",{},svg),gPunkte=el("g",{},svg),gKnoten=el("g",{},svg);

  function anordnen(){const sp=[[],[],[]];knotenListe.forEach(k=>sp[k.spalte||0].push(k));sp.forEach((l,s)=>{const d=H/(l.length+1);l.forEach((k,i)=>{k.x=SPALTE_X[s];k.y=Math.round(d*(i+1))})});knotenListe.forEach(k=>knoten[k.id]=k)}
  function knotenZeichnen(){gKnoten.innerHTML="";for(const k of knotenListe){
    const g=el("g",{class:"kcdf-knoten",transform:`translate(${k.x-KB/2},${k.y-KH/2})`},gKnoten);
    el("rect",{width:KB,height:KH,rx:10,fill:farbe.karte,stroke:RAND[k.typ]||RAND.geraet,"stroke-width":1.5},g);
    el("rect",{width:6,height:KH,rx:3,fill:RAND[k.typ]||RAND.geraet},g);
    const zeilen=k.name.split("\n"),t=el("text",{x:16,y:zeilen.length>1?19:28,fill:farbe.text,"font-size":13,"font-weight":700},g);
    zeilen.forEach((z,i)=>{const ts=el("tspan",{x:16,dy:i?15:0},t);if(i){ts.setAttribute("font-weight",400);ts.setAttribute("fill","#9ba7bd")}ts.textContent=z});
    k.lampe=el("circle",{cx:KB-12,cy:KH/2,r:4.5,fill:farbe.ruhe},g);
  }}
  function pfad(a,b){
    if(a.x===b.x){const x0=a.x-KB/2,bx=x0-55;return`M${x0},${a.y} C${bx},${a.y} ${bx},${b.y} ${x0},${b.y}`}
    const l=a.x<b.x?a:b,r=a.x<b.x?b:a,x1=l.x+KB/2,x2=r.x-KB/2,mx=(x1+x2)/2;
    return`M${x1},${l.y} C${mx},${l.y} ${mx},${r.y} ${x2},${r.y}`;
  }
  function knotenNach(id){
    const spalte=/supabase/.test(id)?1:/neon|b2|vault/.test(id)?2:0;
    knotenListe.push({id,name:id,typ:spalte===0?"geraet":spalte===1?"db":"speicher",spalte});
    anordnen();knotenZeichnen();
    for(const k of Object.values(kanten)){k.pfad.setAttribute("d",pfad(knoten[k.von],knoten[k.nach]));k.treffer.setAttribute("d",k.pfad.getAttribute("d"));k.laenge=k.pfad.getTotalLength()}
  }
  function kante(von,nach){
    if(!knoten[von])knotenNach(von);if(!knoten[nach])knotenNach(nach);
    const id=`${von}>${nach}`;let k=kanten[id];
    if(!k){
      k=kanten[id]={von,nach,req:0,bytes:0,fehler:0,letzte:0,quelle:"",verlauf:[],punkte:[],geschwindigkeit:0};
      k.pfad=el("path",{class:"kcdf-kante",d:pfad(knoten[von],knoten[nach]),fill:"none",stroke:farbe.ruhe,"stroke-width":1.5,"stroke-linecap":"round"},gKanten);
      // breiter, unsichtbarer Treffbereich - dünne Linien sind auf dem Handy sonst nicht zu treffen
      k.treffer=el("path",{class:"kcdf-treffer",d:k.pfad.getAttribute("d"),fill:"none",stroke:"transparent","stroke-width":18,"pointer-events":"stroke"},gKanten);
      k.treffer.addEventListener("click",()=>zeige(k));
      k.laenge=k.pfad.getTotalLength();k.vorwaerts=knoten[von].x<=knoten[nach].x;
    }
    return k;
  }
  function eintragen(k,req,bytes,fehler,quelle,zeit){k.verlauf.push({t:zeit||Date.now(),req,bytes,fehler});k.quelle=quelle;k.letzte=Math.max(k.letzte,zeit||Date.now());summieren(k)}
  function summieren(k){const g=Date.now()-FENSTER_MS;k.verlauf=k.verlauf.filter(v=>v.t>=g);k.req=0;k.bytes=0;k.fehler=0;for(const v of k.verlauf){k.req+=v.req;k.bytes+=v.bytes;k.fehler+=v.fehler}}

  function darstellen(){
    const jetzt=Date.now(),lampen={};
    for(const k of Object.values(kanten)){
      summieren(k);
      const rate=k.req/(FENSTER_MS/1000),aktiv=k.req>0,veraltet=k.letzte&&jetzt-k.letzte>VERALTET_MS,f=k.fehler>0?farbe.fehler:aktiv?farbe.aktiv:farbe.ruhe;
      k.pfad.setAttribute("stroke",f);k.pfad.setAttribute("stroke-width",aktiv?Math.min(1.5+Math.log10(1+k.req)*2.2,7).toFixed(1):1.5);
      k.pfad.setAttribute("stroke-dasharray",veraltet?"5 6":"none");k.pfad.setAttribute("opacity",aktiv?1:.55);
      if(aktiv)lampen[k.von]=lampen[k.nach]=f;
      const soll=aktiv&&!reduziert?Math.min(6,Math.max(1,Math.round(1+rate*4))):0;
      while(k.punkte.length<soll)k.punkte.push({el:el("circle",{r:3.2,fill:f},gPunkte)});
      while(k.punkte.length>soll)gPunkte.removeChild(k.punkte.pop().el);
      k.geschwindigkeit=.12+Math.min(rate,5)*.16;k.punkte.forEach(p=>p.el.setAttribute("fill",f));
    }
    for(const k of knotenListe)k.lampe.setAttribute("fill",lampen[k.id]||k.eigeneLampe||farbe.ruhe);
    if(detail._kante)zeige(detail._kante);
  }
  const start=performance.now();
  function animation(t){const s=(t-start)/1000;for(const k of Object.values(kanten))k.punkte.forEach((p,i)=>{let a=(s*k.geschwindigkeit+i/k.punkte.length)%1;if(!k.vorwaerts)a=1-a;const pt=k.pfad.getPointAtLength(a*k.laenge);p.el.setAttribute("cx",pt.x.toFixed(1));p.el.setAttribute("cy",pt.y.toFixed(1))});if(!wurzel.isConnected)return;requestAnimationFrame(animation)}
  function zeige(k){
    detail._kante=k;const von=knoten[k.von].name.replace("\n"," "),nach=knoten[k.nach].name.replace("\n"," ");
    detail.innerHTML=`<strong>${von} → ${nach}</strong><br>${k.req?`${k.req} Ereignisse, ${bytesText(k.bytes)} in 60 s`:"kein Verkehr in den letzten 60 s"}${k.fehler?`<br><span style="color:var(--bad)">${k.fehler} fehlgeschlagen</span>`:""}<br><span class="muted small">Letzte Aktivität: ${k.letzte?vorText(Date.now()-k.letzte):"nie"} · Quelle: ${k.quelle||"–"}</span>`;
  }

  anordnen();knotenZeichnen();
  const timer=setInterval(()=>{if(!wurzel.isConnected){clearInterval(timer);return}darstellen()},2000);
  if(!reduziert)requestAnimationFrame(animation);

  return{
    // Broadcast-Payload eines Programms: {von, geraet, fenster_ms, kanten:[{nach,req,bytes,fehler}]}
    meldung(p){if(!p?.kanten)return;const von=knotenId(p.von);for(const e of p.kanten){const nach=knotenId(e.nach);if(!von||!nach||von===nach)continue; // PC-Manager-Fenster -> Manager-Dienst ist derselbe Kasten
      eintragen(kante(von,nach),e.req||0,e.bytes||0,e.fehler||0,`Meldung ${p.geraet||p.von}`)}},
    // Kante aus Schnappschuss/Log
    kante(von,nach,daten,quelle,zeit){eintragen(kante(knotenId(von),knotenId(nach)),daten.req||0,daten.bytes||0,daten.fehler||0,quelle||"Log",zeit)},
    // Lampe eines Knotens direkt setzen (z.B. aus Heartbeats), ohne Kante
    lampe(id,zustand){const k=knoten[knotenId(id)];if(k)k.eigeneLampe=zustand==="ok"?farbe.aktiv:zustand==="warn"?farbe.warn:zustand==="bad"?farbe.fehler:null},
    darstellen,
    zerstoeren(){clearInterval(timer);container.innerHTML=""}
  };
}

// ---------------------------------------------- Realtime Broadcast (minimal)
// Phoenix-Protokoll v1.0.0 über Websocket. Kein Postgres beteiligt.
export function broadcastAbonnieren(runtime,aufMeldung,aufZustand=()=>{}){
  const base=String(runtime?.apiBaseUrl||""),m=base.match(/^https:\/\/([a-z0-9-]+\.supabase\.co)/i);
  if(!m||!runtime?.apiToken){aufZustand("nicht konfiguriert");return()=>{}}
  const url=`wss://${m[1]}/realtime/v1/websocket?apikey=${encodeURIComponent(runtime.apiToken)}&vsn=1.0.0`;
  let ws=null,ref=0,herz=null,wieder=null,zu=false;
  const senden=(topic,event,payload)=>{if(ws?.readyState===1)ws.send(JSON.stringify({topic,event,payload,ref:String(++ref)}))};
  function verbinden(){
    if(zu)return;
    try{ws=new WebSocket(url)}catch(e){aufZustand(`Fehler: ${e.message}`);return}
    ws.onopen=()=>{senden(`realtime:${KANAL}`,"phx_join",{config:{broadcast:{self:false},presence:{key:""},postgres_changes:[]},access_token:runtime.apiToken});herz=setInterval(()=>senden("phoenix","heartbeat",{}),30000)};
    ws.onmessage=ev=>{let msg;try{msg=JSON.parse(ev.data)}catch{return}
      if(msg.event==="phx_reply"&&msg.topic===`realtime:${KANAL}`)aufZustand(msg.payload?.status==="ok"?"verbunden":`abgelehnt: ${JSON.stringify(msg.payload?.response||{})}`);
      if(msg.event==="broadcast"&&msg.payload?.event==="fluss")aufMeldung(msg.payload.payload)};
    ws.onclose=()=>{clearInterval(herz);aufZustand("getrennt");if(!zu)wieder=setTimeout(verbinden,5000)};
    ws.onerror=()=>{};
  }
  verbinden();
  return()=>{zu=true;clearInterval(herz);clearTimeout(wieder);try{ws?.close()}catch{}};
}

// ---------------------------------------------- Überwachungsläufe (Zeile)
// Sollzeiten: wann ein Lauf spätestens wieder da sein muss. Überschreitung = gelb,
// doppelte Überschreitung = rot. Werte folgen den Cron-Zeitplänen in Supabase.
const LAEUFE=[
  {id:"system-check",name:"System-Check",soll_min:20,quelle:"kc_system_check_history"},
  {id:"mirror",name:"Spiegelung Supabase → Neon",soll_min:45,quelle:"Momentaufnahme"},
  {id:"backup",name:"Backup + Verify (Neon)",soll_min:26*60,quelle:"kc_backup_sets"},
  {id:"b2",name:"PC Backup Vault",soll_min:48*60,quelle:"Telemetrie"},
  {id:"programs",name:"Lebenszeichen der Programme",soll_min:null,quelle:"kicc_program_heartbeats"}
];
export function laeufeErmitteln(run,jetzt=Date.now()){
  const results=run?.results||[],byId=Object.fromEntries(results.map(r=>[r.id,r])),checked=Date.parse(run?.at||run?.checked_at||run?.checkedAt||"");
  return LAEUFE.map(l=>{
    const r=byId[l.id],st=String(r?.status||"");
    let letzte=null;
    if(l.id==="system-check")letzte=Number.isFinite(checked)?checked:null;
    else if(l.id==="mirror"&&Number.isFinite(r?.metrics?.age_min))letzte=jetzt-r.metrics.age_min*60000;
    else if(l.id==="backup"&&r?.metrics?.last_backup_at)letzte=Date.parse(r.metrics.last_backup_at);
    else if(l.id==="b2")letzte=r?.metrics?.last_backup_at?Date.parse(r.metrics.last_backup_at):r?.metrics?.machine_last_seen_at?Date.parse(r.metrics.machine_last_seen_at):null;
    const alterMin=Number.isFinite(letzte)?(jetzt-letzte)/60000:null;
    let cls=st==="critical"?"bad":st==="warning"?"warn":st==="healthy"?"ok":"idle";
    if(l.id==="system-check"&&letzte!=null)cls="ok"; // der Lauf selbst existiert - sein Ergebnis steht in den Kacheln
    let hinweis=r?.detail||(l.id==="system-check"?"":"nicht bewertet");
    if(l.soll_min!=null&&alterMin!=null){
      if(alterMin>2*l.soll_min&&cls!=="bad"){cls="bad";hinweis=`ausgeblieben · Sollzeit ${sollText(l.soll_min)} mehr als doppelt überschritten`}
      else if(alterMin>l.soll_min&&cls==="ok"){cls="warn";hinweis=`überfällig · Sollzeit ${sollText(l.soll_min)} überschritten`}
    }
    if(l.id==="system-check"&&!hinweis)hinweis=cls==="ok"?"planmäßig":hinweis;
    return{id:l.id,name:l.name,cls,letzte,alterMin,hinweis,quelle:l.quelle,soll:l.soll_min};
  });
}
const sollText=m=>m<60?`${m} min`:m<1440?`${Math.round(m/60)} h`:`${Math.round(m/1440)} T`;
export function laeufeHtml(liste){
  return liste.map(l=>`<div class="live-device ${l.cls==="bad"?"live-alert":""}"><span class="dot ${l.cls}"></span><div><strong>${l.name}</strong><div class="muted small">${l.letzte?`letzter Lauf ${vorText(Date.now()-l.letzte)}`:"kein Lauf bekannt"}${l.soll?` · Sollzeit ${sollText(l.soll)}`:""}${l.hinweis?` · ${l.hinweis}`:""}</div></div><span class="live-tag">${l.cls==="ok"?"OK":l.cls==="warn"?"ÜBERFÄLLIG":l.cls==="bad"?"AUSGEBLIEBEN":"OFFEN"}</span></div>`).join("");
}

// ---------------------------------------------- Einbau in den LIVE-Tab
let karte=null,abmelden=null,zustand="aus";
function panel(id,title,subtitle,vorSelector){
  let host=document.querySelector(id);if(host)return host;
  const anker=document.querySelector(vorSelector)?.closest("article");if(!anker)return null;
  const a=document.createElement("article");a.className="card";
  a.innerHTML=`<div class="row between"><div><h3>${title}</h3><div class="muted small">${subtitle}</div></div><span class="badge" id="${id.slice(1)}Badge">AUTO</span></div><div id="${id.slice(1)}" style="margin-top:8px"></div>`;
  anker.insertAdjacentElement("beforebegin",a);return document.querySelector(id);
}
export function renderDatenfluss(data,runtime){
  const host=panel("#kcdfKarte","Datenfluss","Wer spricht gerade mit wem · echte Zähler, keine Datenbankabfrage","#liveFlows");
  if(!host)return;
  if(!karte){karte=karteErzeugen(host);
    abmelden=broadcastAbonnieren(runtime,p=>{karte.meldung(p);karte.darstellen()},z=>{zustand=z;const b=document.querySelector("#kcdfKarteBadge");if(b){b.textContent=z==="verbunden"?"LIVE":z==="nicht konfiguriert"?"SCHNAPPSCHUSS":"GETRENNT";b.classList.toggle("live",z==="verbunden")}});
  }
  // Kanten aus dem Schnappschuss (Flow-Telemetrie der Programme, wie bisher)
  for(const f of data?.flows||[]){const zeit=Date.parse(f.measured_at||f.received_at||"");if(!Number.isFinite(zeit)||Date.now()-zeit>FENSTER_MS)continue;karte.kante(f.source_id||f.program_id,f.target_id,{req:Number(f.event_count||0),bytes:Number(f.byte_count||0),fehler:/error|fail/i.test(String(f.status||""))?1:0},`Flow-Telemetrie ${f.program_id||""}`.trim(),zeit)}
  // Lampen aus den Heartbeats: Programm lebt, auch wenn gerade nichts fließt
  const th=data?.thresholds||{},warn=Number(th.heartbeat_warn_seconds||90)*1000,crit=Number(th.heartbeat_critical_seconds||180)*1000;
  for(const h of data?.heartbeats||[]){const a=alter(h.measured_at||h.received_at);if(a==null)continue;karte.lampe(h.program_id,a<=warn?"ok":a<=crit?"warn":null)}
  // Backup-Kante aus der Telemetrie
  const b=data?.backup?.machine||data?.backup?.kicc;if(b?.last_backup_at){const zeit=Date.parse(b.last_backup_at);if(Number.isFinite(zeit)&&Date.now()-zeit<=FENSTER_MS)karte.kante("pc-backup",b.storage_target||b.backup_target||"b2",{req:1,bytes:Number(b.last_backup_stored_bytes||b.last_backup_bytes||0)},"Backup-Telemetrie",zeit)}
  karte.darstellen();

  const laufHost=panel("#kcdfLaeufe","Überwachungsläufe","Letzter Lauf, Ergebnis, Sollzeit · aus dem letzten Prüflauf","#liveFlows");
  if(laufHost){const run=state.lastRun||state.history?.at?.(-1)||null;laufHost.innerHTML=run?laeufeHtml(laeufeErmitteln(run)):`<div class="muted small">Noch kein Prüflauf im Speicher · ONE TOUCH ausführen.</div>`}
}
export function datenflussBeenden(){abmelden?.();abmelden=null;karte?.zerstoeren();karte=null}
