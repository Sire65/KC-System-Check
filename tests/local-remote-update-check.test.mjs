import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';const root=path.resolve(import.meta.dirname,'..');const c=fs.readFileSync(path.join(root,'js/updater.js'),'utf8');
assert.match(c,/raw\.githubusercontent\.com\/Sire65\/KC-System-Check\/main\/version\.json/);
// seit 0.9.8 (einheitlicher Update-Button): lokale Installation (localhost/127.0.0.1 oder Datei) vergleicht mit GitHub main, nicht mit der eigenen version.json → kein Schein-Update
assert.match(c,/LOCAL_HTTP_HOST=\/\^\(\?:127\\\.0\\\.0\\\.1\|localhost\)\$\/i\.test\(location\.hostname\)/);
assert.match(c,/FILE_MODE=location\.protocol==="file:"/);
assert.match(c,/const source=\(LOCAL_HTTP_HOST\|\|FILE_MODE\)\?REMOTE_VERSION_URL:VERSION_URL/);
// lokal installiert: Update über den KC-Start-Endpunkt; als Datei geöffnet: klarer Hinweis statt stillem Fehlschlag
assert.match(c,/if\(LOCAL_HTTP_HOST\)\{[\s\S]{0,120}fetch\("\/__kc_update",\{method:"POST"/);
assert.match(c,/if\(FILE_MODE\)throw new Error\("Bitte KC System Check über den KC-Start öffnen\."\)/);
console.log('KC System Check: lokale Installation prüft GitHub main und verhindert Schein-Update.');
