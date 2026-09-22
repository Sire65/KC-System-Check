import express from "express";
import crypto from "node:crypto";
import pg from "pg";
const {Pool}=pg;
const app=express(); app.disable("x-powered-by"); app.use(express.json({limit:"2mb"}));
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,max:3}):null;
const token=process.env.KC_GATEWAY_TOKEN||"";
const auth=(req,res,next)=>{const h=req.get("authorization")||"";const got=h.startsWith("Bearer ")?h.slice(7):"";if(!token||got.length!==token.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(token)))return res.status(401).json({ok:false});next()};
async function init(){if(!pool)return;await pool.query(`create schema if not exists kc_archive; create table if not exists kc_archive.packages(id uuid primary key, source text not null, kind text not null, captured_at timestamptz not null, sha256 text not null, payload jsonb not null, created_at timestamptz not null default now()); create index if not exists packages_captured_idx on kc_archive.packages(captured_at desc)`)}
app.get("/health",async(_q,r)=>{try{if(!pool)throw Error("db not configured");const x=await pool.query("select current_database() db, now() at");r.json({ok:true,db:true,at:x.rows[0].at})}catch(e){r.status(503).json({ok:false,db:false})}});
app.get("/v1/stats",auth,async(_q,r)=>{try{const x=await pool.query("select count(*)::bigint packages, coalesce(pg_total_relation_size('kc_archive.packages'),0)::bigint bytes, max(captured_at) newest from kc_archive.packages");r.json({ok:true,...x.rows[0]})}catch{r.status(500).json({ok:false})}});
app.post("/v1/archive",auth,async(q,r)=>{try{const {id,source,kind,capturedAt,sha256,payload}=q.body||{};if(!id||!source||!kind||!capturedAt||!sha256||payload==null)return r.status(400).json({ok:false,error:"invalid envelope"});const canonical=JSON.stringify(payload),calc=crypto.createHash("sha256").update(canonical).digest("hex");if(calc!==sha256)return r.status(422).json({ok:false,error:"checksum mismatch"});await pool.query("insert into kc_archive.packages(id,source,kind,captured_at,sha256,payload) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing",[id,source,kind,capturedAt,sha256,payload]);r.status(201).json({ok:true,id,sha256})}catch{r.status(500).json({ok:false})}});
app.get("/v1/archive/:id",auth,async(q,r)=>{try{const x=await pool.query("select id,source,kind,captured_at,sha256,payload from kc_archive.packages where id=$1",[q.params.id]);if(!x.rowCount)return r.status(404).json({ok:false});r.json({ok:true,...x.rows[0]})}catch{r.status(500).json({ok:false})}});
const port=Number(process.env.PORT||8080);init().then(()=>app.listen(port,"0.0.0.0")).catch(e=>{console.error("database init failed");process.exit(1)});
