import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';const root=path.resolve(import.meta.dirname,'..');const c=fs.readFileSync(path.join(root,'js/updater.js'),'utf8');
assert.match(c,/raw\.githubusercontent\.com\/Sire65\/KC-System-Check\/main\/version\.json/);
assert.match(c,/LOCAL_REPO_HOST/);
assert.match(c,/GitHub Desktop öffnen, KC-System-Check auswählen/);
console.log('KC System Check: lokale Installation prüft GitHub main und verhindert Schein-Update.');
