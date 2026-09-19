import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker=fs.readFileSync(new URL("../supabase/functions/kc-db-mirror-worker/index.ts",import.meta.url),"utf8");

test("unchanged mirror defaults to 24h verification window",()=>{
  assert.match(worker,/KC_MIRROR_VERIFY_INTERVAL_HOURS/);
  assert.match(worker,/\|\|"24"/);
  assert.match(worker,/verifyIntervalHours\*60\*60\*1000/);
});

test("unchanged source skips Neon while verification is fresh",()=>{
  assert.match(worker,/if\(unchanged&&verificationFresh\)/);
  const skip=worker.indexOf("if(unchanged&&verificationFresh)");
  const refs=worker.indexOf("if(personRefTables.has(table)",skip);
  assert.ok(skip>=0&&refs>skip,"skip must happen before any Neon-backed reference sync");
  assert.match(worker,/transfer_mode:"unchanged_source_skip"/);
});

test("changed source still reaches Neon write and verification",()=>{
  assert.match(worker,/await getNeon\(\)\.begin/);
  assert.match(worker,/const v=await getNeon\(\)\.unsafe\(verifySql\)/);
});
