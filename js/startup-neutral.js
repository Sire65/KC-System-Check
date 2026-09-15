import{latestRun}from"./state.js";

// Der statische HTML-Startwert ist nur ein Platzhalter. Ohne bekannten Lauf
// darf die Oberfläche beim Laden nicht kurz GRÜN/100 % anzeigen.
function neutralizeEmptyStart(){
  if(typeof document==="undefined"||latestRun())return;
  const orb=document.querySelector("#statusOrb");
  const health=document.querySelector("#healthValue");
  const text=document.querySelector("#healthText");
  const coverage=document.querySelector("#coverageText");
  const metric=document.querySelector("#metricHealth");
  if(orb)orb.dataset.state="idle";
  if(health)health.textContent="—";
  if(text)text.textContent="Noch nicht geprüft";
  if(coverage)coverage.textContent="Prüfabdeckung 0% · Daten werden geladen";
  if(metric)metric.textContent="—";
}

if(typeof document!=="undefined")neutralizeEmptyStart();
