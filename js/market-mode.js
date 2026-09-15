import{subscribe}from"./state.js";
function render(){
  const host=document.querySelector("#operationsOverviewCard");
  if(!host)return;
  let box=host.querySelector("#marketModeInfo");
  if(!box){box=document.createElement("div");box.id="marketModeInfo";box.className="muted small";box.style.marginTop="10px";host.appendChild(box)}
  const now=new Date();
  const start=new Date(2026,11,4);
  const end=new Date(2026,11,14);
  box.textContent=now<start?"Marktbetrieb: Vorbereitung · 04.–13.12.2026":now<end?"Marktbetrieb: aktiv · 04.–13.12.2026":"Marktbetrieb 2026 abgeschlossen";
}
if(typeof document!=="undefined")subscribe(render);
