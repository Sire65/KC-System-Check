import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server=fs.readFileSync(new URL("../archive-gateway/src/server.js",import.meta.url),"utf8");
const pkg=JSON.parse(fs.readFileSync(new URL("../archive-gateway/package.json",import.meta.url),"utf8"));

test("archive gateway has authenticated archive, restore and selftest routes",()=>{
  assert.ok(server.includes('app.post("/v1/archive",auth'));
  assert.ok(server.includes('app.get("/v1/archive/:id",auth'));
  assert.ok(server.includes('app.post("/v1/selftest",auth'));
});
test("restore verifies stored SHA-256",()=>{
  assert.match(server,/stored checksum mismatch/);
  assert.match(server,/verified:true/);
});
test("selftest rolls back and leaves no probe row",()=>{
  assert.ok(server.includes('query("rollback")'));
  assert.match(server,/rolledBack:true/);
});
test("gateway does not embed provider credentials",()=>{
  assert.equal(["supabase.co","neon.tech","backblaze","blitz.cloud"].some(x=>server.toLowerCase().includes(x)),false);
  assert.ok(server.includes("process.env.DATABASE_URL"));
  assert.ok(server.includes("process.env.KC_GATEWAY_TOKEN"));
});
test("gateway release version is 0.1.1",()=>assert.equal(pkg.version,"0.1.1"));
