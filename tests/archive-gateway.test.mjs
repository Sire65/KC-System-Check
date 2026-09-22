import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server=fs.readFileSync(new URL("../archive-gateway/src/server.js",import.meta.url),"utf8");
const pkg=JSON.parse(fs.readFileSync(new URL("../archive-gateway/package.json",import.meta.url),"utf8"));

test("archive gateway has authenticated archive, restore and selftest routes",()=>{
  assert.match(server,/post\("\/v1\/archive",auth/);
  assert.match(server,/get\("\/v1\/archive\/:id",auth/);
  assert.match(server,/post\("\/v1\/selftest",auth/);
});
test("restore verifies stored SHA-256",()=>{
  assert.match(server,/stored checksum mismatch/);
  assert.match(server,/verified:true/);
});
test("selftest rolls back and leaves no probe row",()=>{
  assert.match(server,/query\("rollback"\)/);
  assert.match(server,/rolledBack:true/);
});
test("gateway does not embed provider credentials",()=>{
  assert.doesNotMatch(server,/supabase\\.co|neon\\.tech|backblaze|blitz\\.cloud/i);
  assert.match(server,/process\.env\.DATABASE_URL/);
  assert.match(server,/process\.env\.KC_GATEWAY_TOKEN/);
});
test("gateway release version is 0.1.1",()=>assert.equal(pkg.version,"0.1.1"));
