import { normalizeResult } from "../health-model.js";
export async function checkB2(cfg){
  // Kein Test-Upload im normalen Check: spart Zugriffe und Kosten.
  if(!cfg.enabled) return normalizeResult({id:"b2",name:"Backblaze B2",kind:"storage",health:100,detail:"Nicht geprüft – B2-Check deaktiviert"});
  return normalizeResult({id:"b2",name:"Backblaze B2",kind:"storage",health:75,detail:"Adapter vorbereitet; Zugangsdaten serverseitig ergänzen"});
}
