import{state,subscribe,latestResult}from"./state.js";

const MARKET_START=new Date(2026,11,4);
const MARKET_END=new Date(2026,11,14);
const MARKET_LABEL="04.–13.12.2026";
const WARN_MS=90000,FRESH_MS=180000;
const ageMs=v=>{const t=Date.parse(v||"");return Number.isFinite(t)?Math.max(0,Date.now()-t):null};
const ageText=ms=>ms===null?"Zeit unbekannt":ms<60000?`vor ${Math.max(1,Math.round(ms/1000))} s`:ms<3600000?`vor ${Math.round(ms/60000)} min`:ms<86400000?`vor ${Math.round(ms/3600000)} h`:`vor ${Math.round(ms/86400000)} T`;
const norm=v=>{const s=String(v||"").toLowerCase();if(["healthy","ok"].includes(s))return"healthy";if(["warning","warn"].includes(s))return"warning";if(["critical","bad"].includes(s))return"critical";if(s==="not_configured")return"not_configured";return"unknown"};
const num=(...values)=>{for(const value of values){const n=Number(value);if(Number.isFinite(n))return n}return null};
function liveData(){const x=state.live||{};return x.live&&typeof x.live==="object"?x.live:x}
function heartbeats(){return Array.isArray(liveData()?.heartbeats)?liveData().heartbeats:[]}
function resultById(id){return latestResult(id)}
function resultState(row){const s=norm(row?.status);if(s==="healthy")return{state:"ok",text:"OK"};if(s==="warning")return{state:"warn",text:"PRÜFEN"};if(s==="critical")return{state:"bad",text:"STÖRUNG"};if(s==="not_configured")return{state:"prepared",text:"VORBEREITET"};return{state:"unknown",text:"UNBEKANNT"}}
function heartbeatState(h){
  if(!h)return{state:"prepared",text:"TELEMETRIE VORBEREITET"};
  const age=ageMs(h?.measured_at||h?.received_at),raw=String(h?.status||"").toUpperCase();
  if(age===null||age>FRESH_MS)return{state:"idle",text:`NICHT AKTIV · ${ageText(age)}`};
  if(["ERROR","FAILED","CRITICAL","BAD","OFFLINE","DISCONNECTED"].includes(raw))return{state:"bad",text:`STÖRUNG · ${ageText(age)}`};
  if(age>WARN_MS||["DEGRADED","WARNING","WARN"].includes(raw))return{state:"warn",text:`PRÜFEN · ${ageText(age)}`};
  return{state:"ok",text:`OK · ${ageText(age)}`};
}
function routerState(h){
  const base=heartbeatState(h);if(!h||base.state==="bad"||base.state==="idle")return base;
  const latency=num(h.latency_ms),signal=num(h.signal_percent,h.wifi_signal_percent,h.wifi_percent);
  if(latency!==null&&latency>=3000)return{state:"bad",text:`STÖRUNG · ${Math.round(latency)} ms · ${ageText(ageMs(h.measured_at||h.received_at))}`};
  if(signal!==null&&signal<15)return{state:"bad",text:`STÖRUNG · Signal ${Math.round(signal)} % · ${ageText(ageMs(h.measured_at||h.received_at))}`};
  if(base.state==="warn"||(latency!==null&&latency>=1000)||(signal!==null&&signal<30)){
    const bits=["PRÜFEN"];if(latency!==null)bits.push(`${Math.round(latency)} ms`);if(signal!==null)bits.push(`Signal ${Math.round(signal)} %`);bits.push(ageText(ageMs(h.measured_at||h.received_at)));return{state:"warn",text:bits.join(" · ")};
  }
  const bits=["OK"];if(latency!==null)bits.push(`${Math.round(latency)} ms`);if(signal!==null)bits.push(`Signal ${Math.round(signal)} %`);bits.push(ageText(ageMs(h.measured_at||h.received_at)));return{state:"ok",text:bits.join(" · ")};
}
function printerState(h){
  const base=heartbeatState(h);if(!h||base.state==="bad"||base.state==="idle")return base;
  const paper=String(h.paper_status||h.paper||"").toUpperCase();
  const transport=String(h.connection_type||h.transport||h.interface||"").toUpperCase();
  const errors=num(h.print_error_count,h.printer_error_count,h.error_count);
  const age=ageText(ageMs(h.measured_at||h.received_at));
  if(["EMPTY","OUT","NO_PAPER","PAPER_OUT"].includes(paper))return{state:"bad",text:`STÖRUNG · Papier leer · ${age}`};
  if(errors!==null&&errors>0)return{state:"warn",text:`PRÜFEN · ${Math.round(errors)} Druckfehler · ${transport||"Verbindung unbekannt"} · ${age}`};
  if(base.state==="warn"||["LOW","NEAR_END","PAPER_LOW"].includes(paper))return{state:"warn",text:`PRÜFEN · ${paper?"Papier niedrig":"Heartbeat"} · ${transport||"Verbindung unbekannt"} · ${age}`};
  const bits=["OK"];if(transport)bits.push(transport);if(paper)bits.push(`Papier ${paper}`);bits.push(age);return{state:"ok",text:bits.join(" · ")};
}
function moneyButlerState(h){
  const base=heartbeatState(h);if(!h||base.state==="bad"||base.state==="idle")return base;
  const transfer=String(h.transfer_status||h.handover_status||h.cash_transfer_status||"").toUpperCase();
  const fill=String(h.fill_status||h.load_status||h.stock_status||"").toUpperCase();
  const fillPercent=num(h.fill_percent,h.load_percent,h.stock_percent);
  const errors=num(h.transfer_error_count,h.cash_error_count,h.error_count);
  const age=ageText(ageMs(h.measured_at||h.received_at));
  if(["FAILED","ERROR","BLOCKED","JAMMED"].includes(transfer)||["FAILED","ERROR","EMPTY","BLOCKED"].includes(fill))return{state:"bad",text:`STÖRUNG · ${transfer||fill} · ${age}`};
  if(errors!==null&&errors>0)return{state:"warn",text:`PRÜFEN · ${Math.round(errors)} Fehler · ${age}`};
  if(base.state==="warn"||["PENDING","WAITING","DEGRADED"].includes(transfer)||(fillPercent!==null&&fillPercent<20)){
    const bits=["PRÜFEN"];if(transfer)bits.push(`Übergabe ${transfer}`);if(fillPercent!==null)bits.push(`Füllstand ${Math.round(fillPercent)} %`);else if(fill)bits.push(`Füllung ${fill}`);bits.push(age);return{state:"warn",text:bits.join(" · ")};
  }
  const bits=["OK"];if(transfer)bits.push(`Übergabe ${transfer}`);if(fillPercent!==null)bits.push(`Füllstand ${Math.round(fillPercent)} %`);else if(fill)bits.push(`Füllung ${fill}`);bits.push(age);return{state:"ok",text:bits.join(" · ")};
}
function latestMatches(rx){
  const map=new Map();
  for(const h of heartbeats()){
    if(!rx.test(String(h?.program_id||"")))continue;
    const key=String(h?.instance_id||h?.source_id||h?.program_id||"");
    const old=map.get(key);
    const nt=Date.parse(h?.measured_at||h?.received_at||0),ot=Date.parse(old?.measured_at||old?.received_at||0);
    if(!old||nt>ot)map.set(key,h);
  }
  return[...map.values()].sort((a,b)=>Date.parse(b?.measured_at||b?.received_at||0)-Date.parse(a?.measured_at||a?.received_at||0));
}
function readiness(components,active){
  const measured=components.filter(c=>!["prepared","unknown"].includes(c.state));
  const missing=components.length-measured.length;
  const bad=measured.filter(c=>c.state==="bad").length;
  const warn=measured.filter(c=>c.state==="warn").length;
  const idle=measured.filter(c=>c.state==="idle").length;
  let text;
  if(bad>0)text=`NICHT BEREIT · ${bad} Störung(en)`;
  else if(active&&idle>0)text=`NICHT BEREIT · ${idle} Komponente(n) nicht aktiv`;
  else if(warn>0)text=`EINGESCHRÄNKT · ${warn} zu prüfen`;
  else if(!active&&idle>0)text=`VORBEREITUNG · ${idle} Komponente(n) derzeit nicht aktiv`;
  else if(missing>0)text=`NOCH NICHT VOLLSTÄNDIG BEWERTBAR · ${measured.length}/${components.length} messbar`;
  else text=`BEREIT · ${components.length}/${components.length} messbar`;
  return{text,measured:measured.length,total:components.length,missing,bad,warn,idle};
}
function row(label,value,strong=false){const d=document.createElement("div");d.className="kc-ops-fact";const a=document.createElement("span");a.className="muted";a.textContent=label;const b=document.createElement("span");if(strong)b.className="kc-ops-ready";b.textContent=value;d.append(a,b);return d}
function ensureBox(host){let box=host.querySelector("#marketModeInfo");if(box)return box;box=document.createElement("div");box.id="marketModeInfo";box.className="kc-ops-facts";box.style.marginTop="10px";host.appendChild(box);return box}
function render(){
  if(typeof document==="undefined")return;
  const host=document.querySelector("#operationsOverviewCard");if(!host)return;
  const box=ensureBox(host),now=new Date();box.innerHTML="";
  const active=now>=MARKET_START&&now<MARKET_END;
  const phase=now<MARKET_START?"Vorbereitung":active?"AKTIV":"Abgeschlossen";
  box.append(row("Marktbetrieb",`${phase} · ${MARKET_LABEL}`));
  if(now>=MARKET_END){const note=document.createElement("div");note.className="muted small";note.textContent="Die Marktkomponenten werden außerhalb des Marktzeitraums nicht als Pflichtbetrieb bewertet.";box.append(note);return}

  const supabase=resultState(resultById("kc_core"));
  const neon=resultState(resultById("neon"));
  const mirror=resultState(resultById("mirror"));
  const managers=latestMatches(/manager/i),manager=heartbeatState(managers[0]||null);
  const kassen=latestMatches(/kasse|markt|pos/i),kasse1=heartbeatState(kassen[0]||null),kasse2=heartbeatState(kassen[1]||null);
  const routers=latestMatches(/router|gateway|internet|network|netz/i),router=routerState(routers[0]||null);
  const printers=latestMatches(/printer|bondruck|receipt|tm[-_]?t88/i),printer=printerState(printers[0]||null);
  const butlers=latestMatches(/money[-_ ]?butler|cash[-_ ]?butler/i),butler=moneyButlerState(butlers[0]||null);
  const components=[supabase,neon,mirror,manager,kasse1,kasse2,router,printer,butler];
  const ready=readiness(components,active);
  box.append(row("Marktbereitschaft",ready.text,true));

  box.append(row("Supabase",supabase.text));
  box.append(row("Neon",neon.text));
  box.append(row("Spiegelung",mirror.text));
  box.append(row("PC Manager",manager.text));
  box.append(row("Kasse 1",kasse1.text));
  box.append(row("Kasse 2",kasse2.text));
  if(kassen.length>2)box.append(row("Weitere Kassen",`${kassen.length-2} zusätzliche Instanz(en) erkannt`));
  box.append(row("Router / Internet",router.text));
  box.append(row("Bondrucker",printer.text));
  if(printers.length>1)box.append(row("Weitere Bondrucker",`${printers.length-1} zusätzliche Instanz(en) erkannt`));
  box.append(row("Money Butler",butler.text));

  const note=document.createElement("div");note.className="muted small";
  note.textContent=active
    ?"Im aktiven Marktzeitraum zählen echte Störungen, Warnungen und bereits angebundene aber nicht aktive Komponenten in die Marktbereitschaft. Fehlende, noch nicht angebundene Telemetrie bleibt neutral, verhindert aber ein vollständiges BEREIT."
    :"In der Vorbereitung werden nur vorhandene Messwerte bewertet. Fehlende Telemetrie bleibt neutral; bereits bekannte, aber derzeit inaktive Komponenten werden nicht als BEREIT gewertet.";
  box.append(note);
}
if(typeof document!=="undefined")subscribe(render);
