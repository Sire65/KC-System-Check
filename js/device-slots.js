// Stabile Zuordnung betriebsrelevanter Geräte. Die Anzeige darf Kasse 1/2
// nicht danach benennen, welche Instanz zuletzt gesendet hat: sonst tauschen
// die Bezeichnungen bei jedem unterschiedlichen Heartbeat-Zeitpunkt.
const stamp=h=>{const t=Date.parse(h?.measured_at||h?.received_at||0);return Number.isFinite(t)?t:0};

export function heartbeatKey(h){
  return String(h?.instance_id||h?.source_id||h?.device_id||h?.program_id||"");
}

export function latestInstances(list=[]){
  const byKey=new Map();
  for(const h of Array.isArray(list)?list:[]){
    const key=heartbeatKey(h);if(!key)continue;
    const old=byKey.get(key);if(!old||stamp(h)>stamp(old))byKey.set(key,h);
  }
  return [...byKey.values()];
}

function numericSlot(value){
  if(value===1||value==="1")return 1;
  if(value===2||value==="2")return 2;
  return null;
}

export function cashRegisterSlot(h){
  if(!h)return null;
  const direct=[h.kasse_no,h.kasse_number,h.cash_register_no,h.cash_register_number,h.register_no,h.register_number,h.terminal_no,h.terminal_number,h.station_no,h.station_number,h.device_no,h.device_number];
  for(const value of direct){const n=numericSlot(value);if(n)return n}
  const identifiers=[h.cash_register_id,h.register_id,h.terminal_id,h.station_id,h.device_id,h.instance_id,h.source_id,h.program_id,h.name].filter(Boolean);
  for(const value of identifiers){
    const m=String(value).match(/(?:kasse|register|pos|terminal|station)[-_ ]*0?([12])(?:\D|$)/i);
    if(m)return Number(m[1]);
  }
  return null;
}

export function stableCashRegisterSlots(list=[]){
  const instances=latestInstances(list);
  const ordered=[...instances].sort((a,b)=>stamp(b)-stamp(a));
  const slots=[null,null],used=new Set();
  for(const h of ordered){
    const slot=cashRegisterSlot(h);if(!slot||slots[slot-1])continue;
    slots[slot-1]=h;used.add(heartbeatKey(h));
  }
  const unassigned=instances
    .filter(h=>!used.has(heartbeatKey(h)))
    .sort((a,b)=>heartbeatKey(a).localeCompare(heartbeatKey(b),"de"));
  for(let i=0;i<2;i++)if(!slots[i]&&unassigned.length)slots[i]=unassigned.shift();
  return{slots,extras:unassigned,instances};
}
