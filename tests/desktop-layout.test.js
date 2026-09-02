import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
test('desktop layout is wired into startup and Pages bundle',()=>{const state=read('js/state.js'),pages=read('.github/workflows/pages.yml');assert.match(state,/desktop-layout\.js/);assert.match(pages,/desktop-layout\.js/)});
test('desktop layout starts only at desktop breakpoint',()=>{const s=read('js/desktop-layout.js');assert.match(s,/@media\(min-width:1000px\)/);assert.match(s,/matchMedia\('\(min-width:1000px\)'\)/)});
test('desktop dashboard uses wide centered workspace',()=>{const s=read('js/desktop-layout.js');assert.match(s,/max-width:1400px/);assert.match(s,/grid-template-columns:minmax\(0,1\.12fr\) minmax\(0,\.88fr\)/)});
test('desktop keeps four gauges in one row',()=>{assert.match(read('js/desktop-layout.js'),/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/)});
test('desktop shows system list and response chart side by side',()=>{const s=read('js/desktop-layout.js');assert.match(s,/#dashboard>\.gauges\+\.card\{grid-column:1/);assert.match(s,/#dashboard>\.gauges\+\.card\+\.card\{grid-column:2/)});
test('desktop adds five compact operational KPI cards',()=>{const s=read('js/desktop-layout.js');assert.match(s,/repeat\(5,minmax\(0,1fr\)\)/);for(const label of['Betrieb','Letzter Prüflauf','Prüfabdeckung','KC Core','Academy / Mirror'])assert.match(s,new RegExp(label))});
test('mobile compact breakpoint remains unchanged',()=>{const s=read('js/mobile-compact.js');assert.match(s,/@media\(max-width:620px\)/);assert.doesNotMatch(s,/desktop-overview/)});
