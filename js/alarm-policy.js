// Alarmregelwerk: aus rohen Zustaenden werden erst dann Alarme, wenn sie
// bestaetigt, nicht abgeleitet und nicht stummgeschaltet sind.
// Reine Funktionen ohne DOM und ohne Netz - damit vollstaendig testbar.

export const DEFAULT_POLICY={
  // Wie oft ein Zustand hintereinander gemessen werden muss, bevor er gilt.
  // Entwarnung braucht mehr Bestaetigung als Alarm: lieber einmal zu lange rot
  // als ein Flattern zwischen gruen und rot.
  confirmAfter:{critical:2,warning:2,unknown:3,healthy:3},
  // Erneute Meldung eines weiterhin bestehenden Alarms.
  renotifyAfterMinutes:60,
  // Ab wann ein bestaetigter Alarm als eskaliert gilt.
  escalateAfterMinutes:15,
  // signalId -> Liste von Signalen, ohne die dieses Signal nicht bewertbar ist.
  dependencies:{}
};

const SEVERITY={critical:3,warning:2,unknown:1,healthy:0};

export function normalizeStatus(status){
  const value=String(status||"").toLowerCase();
  if(["critical","bad","down","error","failed"].includes(value))return"critical";
  if(["warning","warn","degraded"].includes(value))return"warning";
  if(["healthy","ok","success","passed"].includes(value))return"healthy";
  return"unknown";
}

function emptyEntry(now){return{confirmed:null,candidate:null,streak:0,since:now,lastNotifiedAt:0}}

// Schritt 1: Entprellung. Ein neuer Zustand gilt erst nach mehreren Messungen.
function debounce(signals,memory,policy,now){
  const next={},changed=new Set();
  for(const signal of signals){
    const status=normalizeStatus(signal.status);
    const previous={...emptyEntry(now),...(memory[signal.id]||{})};
    let{confirmed,candidate,streak,since,lastNotifiedAt}=previous;
    if(confirmed===null){confirmed=status;since=now;candidate=null;streak=0;changed.add(signal.id)}
    else if(status===confirmed){candidate=null;streak=0}
    else{
      streak=status===candidate?streak+1:1;
      candidate=status;
      const needed=Number(policy.confirmAfter?.[status]??2);
      if(streak>=needed){confirmed=status;since=now;candidate=null;streak=0;changed.add(signal.id)}
    }
    next[signal.id]={confirmed,candidate,streak,since,lastNotifiedAt};
  }
  return{next,changed};
}

// Schritt 2: Folgealarme unterdruecken. Faellt das Internet aus, ist nicht jedes
// dahinter liegende System eine eigene Stoerung.
function suppressor(state,policy){
  return signalId=>{
    const parents=policy.dependencies?.[signalId]||[];
    for(const parent of parents){
      if(state[parent]?.confirmed==="critical")return parent;
    }
    return null;
  };
}

function minutesSince(then,now){return (now-Number(then||0))/60000}

/**
 * @param signals  [{id,name,status}] - roher Messzustand
 * @param memory   Ergebnis von evaluateAlarms(...).memory des letzten Laufs
 * @param maintenance {signalId: bisZeitstempel} - Wartungsfenster
 * @returns {memory, alarms, suppressed, notify}
 */
export function evaluateAlarms({signals=[],memory={},policy=DEFAULT_POLICY,maintenance={},now=Date.now()}={}){
  const merged={...DEFAULT_POLICY,...policy,confirmAfter:{...DEFAULT_POLICY.confirmAfter,...(policy?.confirmAfter||{})}};
  const{next,changed}=debounce(signals,memory,merged,now);
  const suppressedBy=suppressor(next,merged);
  const alarms=[],suppressed=[],notify=[];

  for(const signal of signals){
    const entry=next[signal.id];
    const status=entry.confirmed;
    if(status==="healthy")continue;

    const silencedUntil=Number(maintenance[signal.id]||0);
    if(silencedUntil>now){suppressed.push({id:signal.id,name:signal.name,status,reason:"wartung",until:silencedUntil});continue}

    const parent=suppressedBy(signal.id);
    if(parent){suppressed.push({id:signal.id,name:signal.name,status,reason:"abhaengigkeit",causedBy:parent});continue}

    const openMinutes=minutesSince(entry.since,now);
    const alarm={
      id:signal.id,
      name:signal.name||signal.id,
      status,
      since:entry.since,
      openMinutes:Math.round(openMinutes),
      escalated:status==="critical"&&openMinutes>=Number(merged.escalateAfterMinutes),
      isNew:changed.has(signal.id)
    };
    alarms.push(alarm);

    const quietMinutes=minutesSince(entry.lastNotifiedAt,now);
    const dueAgain=entry.lastNotifiedAt>0&&quietMinutes>=Number(merged.renotifyAfterMinutes);
    if(alarm.isNew||dueAgain){notify.push(alarm);next[signal.id]={...entry,lastNotifiedAt:now}}
  }

  alarms.sort((a,b)=>SEVERITY[b.status]-SEVERITY[a.status]||b.openMinutes-a.openMinutes);
  return{memory:next,alarms,suppressed,notify};
}

// Nur die Signale, die in Gesamtwert und Alarm einfliessen duerfen.
export function signalsFromResults(results=[]){
  return results
    .filter(r=>r&&r.id&&!["not_configured","disabled"].includes(String(r.status)))
    .map(r=>({id:r.id,name:r.name||r.id,status:r.status}));
}
