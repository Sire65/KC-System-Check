import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("public runtime is live and contains no privileged secret",()=>{
  const cfg=JSON.parse(fs.readFileSync("config/runtime.public.json","utf8"));
  assert.equal(cfg.mode,"live");
  assert.equal(cfg.apiStyle,"supabase-edge");
  assert.match(cfg.apiBaseUrl,/supabase\.co\/functions\/v1\/kc-system-check$/);
  const raw=JSON.stringify(cfg).toLowerCase();
  assert.equal(raw.includes("service_role"),false);
  assert.equal(raw.includes("service-role"),false);
});
