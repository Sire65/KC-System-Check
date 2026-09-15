import{latestRun,subscribe}from"./state.js";

function norm(v){return String(v||"").toLowerCase()}
function yes(v){return ["ok","pass","passed","success","healthy"].includes(norm(v))}
function findCard(){return [...document.querySelectorAll("#operationsOverview .kc-ops-card")].find(c=>c.textContent?.includes("Backup & Sicherheit"))||null}
function row(label,value){const d=document.createElement("div");d.className="kc-ops-fact";const a=document.createElement("span");a.className="muted";a.textContent=label;const b=document.createElement("span");b.textContent=value;d.append(a,b);return d}
function render(){
  if(typeof document==="undefined")return;
  const card=findCard();if(!card)return;
  card.querySelector(".kc-recovery-facts")?.remove();
  const run=latestRun(),results=Array.isArray(run?.results)?run.results:[];
  const b2=results.find(r=>r?.id==="b2")||null;
  const backup=results.find(r=>r?.id==="backup")||null;
  const integrity=b2?.metrics?.integrity||b2?.metrics?.verification_status||null;
  const restore=b2?.metrics?.restore||b2?.metrics?.restore_status||null;
  const verify=backup?.metrics?.verification_status||integrity||null;
  const recoveryOk=(yes(verify)||yes(integrity))&&(!restore||yes(restore));
  const box=document.createElement("div");box.className="kc-ops-facts kc-recovery-facts";
  box.append(row("Recovery geprüft",recoveryOk?"JA":(verify||integrity||restore)?"PRÜFEN":"NOCH KEINE TELEMETRIE"));
  if(verify||integrity)box.append(row("Integrität / Verify",String(verify||integrity).toUpperCase()));
  if(restore)box.append(row("Restore-Test",String(restore).toUpperCase()));
  const age=b2?.metrics?.backup_age_hours;if(Number.isFinite(Number(age)))box.append(row("Letzter Backup-Lauf",`vor ${Math.round(Number(age))} h`));
  const note=document.createElement("div");note.className="muted small";note.textContent="Manuell gestartete Backups werden nur nach gemeldetem Ergebnis bewertet; fehlender täglicher Lauf ist kein Vorfall.";box.append(note);
  card.append(box);
}
if(typeof document!=="undefined")subscribe(render);
