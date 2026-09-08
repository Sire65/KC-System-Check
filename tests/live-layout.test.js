import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const layout=fs.readFileSync('js/live-layout-v2.js','utf8');
const startup=fs.readFileSync('js/startup-modules.js','utf8');

test('LIVE layout is loaded and exposes the three requested work areas',()=>{
  assert.match(startup,/import["']\.\/live-layout-v2\.js["']/);
  assert.match(layout,/Leitstand/);
  assert.match(layout,/Datenflüsse/);
  assert.match(layout,/Technik & Tests/);
  assert.match(layout,/kcLiveBetrieb/);
  assert.match(layout,/kcLiveFlowsView/);
  assert.match(layout,/kcLiveTechView/);
});

test('locked LIVE view also hides the new subnavigation and subviews',()=>{
  assert.match(layout,/#live\[data-locked=["']1["']\]>\.kc-live-subtabs/);
  assert.match(layout,/#live\[data-locked=["']1["']\]>\.kc-live-subview/);
});

test('daily view is deliberately reduced to five operational checks',()=>{
  for(const label of ['Systemprüfung','Spiegelung → Neon','Sicherung → Neon','PC Backup Vault','Kommunikation'])
    assert.match(layout,new RegExp(label));
  assert.match(layout,/Fünf Punkte für den täglichen Blick/);
  assert.match(layout,/data-kc-go-tech/);
});

test('flow view uses real snapshot flows and never invents a green empty state',()=>{
  assert.match(layout,/snapshot\?\.live\?\.flows/);
  assert.match(layout,/LIVE_MS=60_000/);
  assert.match(layout,/moving=!bad/);
  assert.match(layout,/Noch keine Leitflüsse messbar/);
  assert.match(layout,/Die Ansicht bleibt neutral/);
});

test('old noisy detail cards are moved out of the daily view',()=>{
  assert.match(layout,/#livePrograms,#liveSales,#liveFlows,#liveApps,#liveBackup,#kcdfLaeufe/);
  assert.match(layout,/#kcdfKarte/);
  assert.match(layout,/kc-live-head-card #liveKpis\{display:none!important\}/);
});
