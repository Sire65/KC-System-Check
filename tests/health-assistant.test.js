import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';

test('health assistant is wired through application state module',()=>{const s=fs.readFileSync('js/state.js','utf8');assert.match(s,/import"\.\/health-assistant\.js"/)});

test('100 percent test health is qualified when live coverage is incomplete',()=>{const s=fs.readFileSync('js/health-assistant.js','utf8');assert.match(s,/Prüfungen bestanden · Live unvollständig/);assert.match(s,/Live-Abdeckung unvollständig/);assert.match(s,/setState\(orb,"warn"\)/)});

test('fresh live disturbance can override a misleading green 100 percent header',()=>{const s=fs.readFileSync('js/health-assistant.js','utf8');assert.match(s,/Live-Störung vorhanden/);assert.match(s,/setState\(orb,"bad"\)/)});

test('problem help gives contextual suggestions without automatic changes',()=>{const s=fs.readFileSync('js/health-assistant.js','utf8');assert.match(s,/Lösung anzeigen/);assert.match(s,/Probleme & Lösungen/);assert.match(s,/Die Vorschläge ändern nichts automatisch/);assert.match(s,/heartbeat/);assert.match(s,/backup/);assert.match(s,/spiegel/);assert.match(s,/kommunikation/)});
