const exitBtn=document.querySelector('#exitBtn');

function showClosedScreen(){
  document.body.innerHTML=`<main style="max-width:720px;margin:12vh auto;padding:24px;font-family:Inter,system-ui,Arial,sans-serif;color:#f5f7fb;background:#0f1829;border:1px solid #273552;border-radius:20px;text-align:center"><div style="font-size:48px">🚪</div><h1>KC System Check beendet</h1><p style="color:#9ba7bd">Der lokale KC-System-Check-Server wurde beendet. Dieses Browserfenster kann jetzt geschlossen werden.</p></main>`;
}

async function closeProgram(){
  const confirmed=window.confirm('KC System Check wirklich schließen?');
  if(!confirmed)return;
  exitBtn.disabled=true;
  try{
    const isLocal=['127.0.0.1','localhost'].includes(location.hostname);
    if(isLocal){
      await fetch('/__kc_shutdown',{method:'POST',cache:'no-store'}).catch(()=>{});
    }
  }finally{
    try{window.open('','_self');window.close()}catch{}
    setTimeout(showClosedScreen,250);
  }
}

exitBtn?.addEventListener('click',closeProgram);
