import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';

test('stale non-operational ONLINE heartbeats are not shown as live',()=>{const s=fs.readFileSync('js/leitstand.js','utf8');assert.match(s,/Nicht aktiv · letzte Meldung/);assert.match(s,/st\.cls===?\"ok\"\?\"LIVE\"/)});

test('KC app registry is mapped into live program monitor',()=>{const s=fs.readFileSync('js/leitstand.js','utf8');assert.match(s,/renderRegisteredApps/);assert.match(s,/KC_DP/);assert.match(s,/KC_COMMUNICATION/);assert.match(s,/KC_MANAGER/);assert.match(s,/KC_MARKTKASSE/);assert.match(s,/Versionsabweichung/)});

test('manager and market cash register remain prepared until current versions are connected',()=>{const s=fs.readFileSync('js/leitstand.js','utf8');assert.match(s,/Anbindung vorbereitet · aktuelle Programmversion später anbinden/);assert.match(s,/Heartbeat-Anbindung vorbereitet/);assert.match(s,/Kasse \$\{i\+1\}/);assert.match(s,/PC Manager/)});

test('stale communication state becomes neutral but remains history',()=>{const s=fs.readFileSync('js/leitstand.js','utf8');assert.match(s,/Status veraltet/);assert.match(s,/tag:\"VERALTET\"/);assert.match(s,/Fehlerhistorie/);assert.match(s,/age>86400/)});

test('backup snapshot contains read-only backup and restore telemetry',()=>{const m=fs.readFileSync('supabase/migrations/202609010918_kc_live_leitstand_v2_backup_programs.sql','utf8');assert.match(m,/kc_backup_machine_telemetry/);assert.match(m,/kicc_backup_telemetry/);assert.match(m,/last_restore_test/);assert.match(m,/integrity/);assert.doesNotMatch(m,/insert into|update public\.kc_backup/i)});

test('live UI renders backup health without inventing green status',()=>{const s=fs.readFileSync('js/leitstand.js','utf8');assert.match(s,/renderBackup/);assert.match(s,/Noch keine Messwerte vorhanden/);assert.match(s,/B2\/Neon werden nicht künstlich grün angezeigt/);assert.match(s,/VERALTET/)});
