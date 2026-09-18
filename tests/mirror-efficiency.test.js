const fs=require("fs");
const assert=require("assert");
const src=fs.readFileSync("supabase/functions/kc-db-mirror-worker/index.ts","utf8");

assert(src.includes("let neon:any=null"),"Neon client must be lazy");
assert(src.includes("const getNeon=()=>neon??=postgres"),"lazy Neon factory missing");
assert(src.includes('status:"skipped",reason:"source_unchanged"'),"unchanged skip contract missing");

const snapPos=src.indexOf('sb.rpc("kc_db_mirror_snapshot"');
const historyPos=src.indexOf('sb.from("kc_db_mirror_runs").select("source_rows,metrics,finished_at")');
const neonWritePos=src.indexOf("await getNeon().begin");
assert(snapPos>=0 && historyPos>snapPos && neonWritePos>historyPos,"comparison must happen before Neon write");

assert(src.includes('String(lastOk.source_rows??"")===sc'),"row count must match before skip");
assert(src.includes('String((lastOk.metrics as any)?.source_hash??"")===sh'),"source hash must match before skip");
assert(src.includes("if(!lastErr&&lastOk&&"),"history lookup error/missing history must fail open to normal mirror, never false-skip");
assert(src.includes("if(neon)await neon.end"),"unused Neon client must not be created merely for cleanup");

const unchangedBlock=src.slice(src.indexOf("if(!lastErr&&lastOk&&"),src.indexOf("const bytes=",src.indexOf("if(!lastErr&&lastOk&&")));
assert(!unchangedBlock.includes("getNeon()"),"unchanged path must not touch Neon");

console.log("mirror efficiency regression: OK");

assert(src.includes("verificationFresh"),"skip requires a fresh target verification");
assert(src.includes("30*60*1000"),"target verification must respect the 30 minute production freshness window");
assert(src.includes('transfer_mode:"unchanged_source_skip"'),"unchanged skips must be persisted/auditable");
assert(src.includes("target_verified:false"),"skip must not masquerade as target verification");
assert(src.indexOf("if(personRefTables.has(table)")>src.indexOf("if(unchanged&&verificationFresh)"),"reference sync must happen only after skip decision");
assert(src.indexOf("if(userRefTables.has(table)")>src.indexOf("if(unchanged&&verificationFresh)"),"user reference sync must happen only after skip decision");
