import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
const read=p=>fs.readFileSync(p,'utf8');

test('healthy dashboard hides non-actionable watch trends',()=>{const s=read('js/early-warning.js');assert.match(s,/filter\(v=>v\.t\.level==='warn'\)/);assert.match(s,/actionable:w\.length/)});
test('mobile compact module is wired into startup',()=>{assert.match(read('js/state.js'),/import"\.\/mobile-compact\.js"/)});
test('verification profile module is wired into startup',()=>{assert.match(read('js/state.js'),/import"\.\/verification-profile\.js"/)});
test('public runtime contains no service role or secret key labels',()=>{const s=read('config/runtime.public.json');assert.doesNotMatch(s,/service[_-]?role|secret[_-]?key|private[_-]?key/i)});
test('service worker uses network first and purges old caches',()=>{const s=read('sw.js');assert.match(s,/networkFirst/);assert.match(s,/purgeOldCaches/);assert.match(s,/cache:"no-store"/)});
test('pages bundle copies all startup safety modules',()=>{const s=read('.github/workflows/pages.yml');for(const f of['health-assistant.js','early-warning.js','self-check.js','kicc-heartbeat.js','quality-tools.js','mobile-compact.js','verification-profile.js'])assert.match(s,new RegExp(f.replace('.','\\.')))});
test('one touch executes enabled systems only',()=>{const s=read('js/app.js');assert.match(s,/state\.systems\.filter\(s=>s\.enabled\)\.map\(s=>s\.id\)/)});
test('live requests disable browser caching',()=>{const s=read('js/adapters/live.js');assert.match(s,/cache:"no-store"/)});
test('mirror health is based on mismatch and freshness',()=>{const s=read('supabase/functions/kc-system-check/index.ts');assert.match(s,/mismatch_count/);assert.match(s,/age_min/);assert.match(s,/Spiegelung · Supabase → Neon/)});
test('verification contract documents limits of 100 percent',()=>{const s=read('docs/VERIFICATION_PROFILE.md');assert.match(s,/100 %/);assert.match(s,/keine absolute Fehlerfreiheitsgarantie/i);assert.match(s,/OWASP ASVS 5\.0/i)});
test('CI includes external lint bundle and browser smoke checks',()=>{const s=read('.github/workflows/test.yml');assert.match(s,/ESLint/);assert.match(s,/esbuild/);assert.match(s,/Playwright/)});
test('release contract keeps version updater heartbeat and cache aligned',()=>{const v=JSON.parse(read('version.json')).version;assert.match(read('js/updater.js'),new RegExp(`CURRENT_VERSION="${v.replaceAll('.','\\.')}"`));assert.match(read('js/kicc-heartbeat.js'),new RegExp(`VERSION='${v.replaceAll('.','\\.')}'`));assert.match(read('sw.js'),new RegExp(`kc-system-check-v${v.replaceAll('.','\\.')}`))});
