const fs=require("fs");const assert=require("assert");
const app=fs.readFileSync("js/app.js","utf8"),live=fs.readFileSync("js/adapters/live.js","utf8"),html=fs.readFileSync("index.html","utf8"),edge=fs.readFileSync("supabase/functions/kc-system-check/index.ts","utf8");
assert(html.includes('id="oneTouchBtn"')&&html.includes('OT · One Touch'));
assert(html.includes('id="deepTouchBtn"')&&html.includes('TOT · Tiefen One Touch'));
assert(app.includes('"manual",false')&&app.includes('"manual",true'));
assert(live.includes('deep_neon=1'));
assert(edge.includes('const deepNeonCheck=u.searchParams.get("deep_neon")==="1";'));
assert(!edge.includes('||u.searchParams.get("trigger")==="manual"'));
console.log("OT/TOT wake-up contract: OK");
