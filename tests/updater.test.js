import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';

test('update notice asks on start instead of on a six hour window',()=>{const s=fs.readFileSync('js/updater.js','utf8');assert.match(s,/checkForAppUpdate\(\{silent:true\}\)/);assert.doesNotMatch(s,/kc-last-update-check/);assert.doesNotMatch(s,/6\*60\*60\*1000/)});

test('later is remembered for twelve hours per version',()=>{const s=fs.readFileSync('js/updater.js','utf8');assert.match(s,/kc-update-spaeter/);assert.match(s,/SPAETER_STUNDEN=12/);assert.match(s,/s\.version===version/);assert.match(s,/if\(angekuendigt\)spaeterMerken\(angekuendigt\)/);assert.match(s,/silent&&!info\.verbindlich&&spaeterGemerkt\(info\.version\)/)});

test('a mandatory version has no later button',()=>{const s=fs.readFileSync('js/updater.js','utf8');assert.match(s,/spaeter\.classList\.toggle\("hidden",!!verbindlich\)/)});

test('the bar counts real seconds and then really reloads',()=>{const s=fs.readFileSync('js/updater.js','utf8');
  assert.match(s,/Math\.ceil\(\(dauer-\(Date\.now\(\)-start\)\)\/1000\)/);
  assert.match(s,/if\(anteil>=1\)\{clearInterval\(uhr\);fertig\(\)\}/);
  assert.match(s,/balkenLaufenLassen\(installSekunden,uebernehmen\)/);
  assert.match(s,/location\.reload\(\)/);
  // Bleibt controllerchange aus, darf die Seite nicht auf "Neustart" stehen.
  assert.match(s,/setTimeout\(\(\)=>location\.reload\(\),3000\)/)});

test('an unreachable version file is never reported as up to date',()=>{const s=fs.readFileSync('js/updater.js','utf8');const fang=s.slice(s.indexOf('}catch(e){',s.indexOf('checkForAppUpdate')));assert.doesNotMatch(fang.slice(0,300),/ist aktuell/)});

test('the banner carries the bar and it moves only with the clock',()=>{const h=fs.readFileSync('index.html','utf8');
  for(const id of['updateProgress','updateBar','updateRemaining'])assert.match(h,new RegExp(`id="${id}"`));
  assert.match(h,/\.update-progress\{grid-column:1\/-1;display:none\}/);
  assert.doesNotMatch(h,/#updateBar\{[^}]*animation:/)});

test('version file names the countdown length',()=>{const v=JSON.parse(fs.readFileSync('version.json','utf8'));assert.equal(typeof v.installSekunden,'number');assert.ok(v.installSekunden>=2&&v.installSekunden<=30)});
