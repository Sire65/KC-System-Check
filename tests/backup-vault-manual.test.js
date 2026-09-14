import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = readFileSync("supabase/functions/kc-system-check/index.ts", "utf8");
const start = quelle.indexOf("function stunden(");
const end = quelle.indexOf("Deno.serve(", start);
const abschnitt = quelle.slice(start, end)
  .replace(/:\s*number/g, "")
  .replace(/:\s*any/g, "")
  .replace(/:\s*string\[\]/g, "");
const backupAgeRules = new Function(`${abschnitt}; return backupAgeRules;`)();

const alt = new Date(Date.now() - 10 * 24 * 3600_000).toISOString();

test("altes erfolgreiches manuelles Backup bleibt gruen", () => {
  const basis = { status: "healthy", health: 100, detail: "B2 SUCCESS", metrics: {} };
  const r = backupAgeRules(basis, { last_backup_at: alt, measured_at: alt }, { last_seen_at: alt });
  assert.equal(r.status, "healthy");
  assert.equal(r.health, 100);
  assert.match(r.detail, /kein täglicher Lauf erwartet/);
  assert.equal(r.metrics.backup_schedule, "manual");
});

test("ein gemeldeter Fehler wird durch manuell nicht verharmlost", () => {
  const basis = { status: "critical", health: 35, detail: "B2 FAILED", metrics: {} };
  const r = backupAgeRules(basis, { last_backup_at: alt, measured_at: alt }, { last_seen_at: alt });
  assert.equal(r.status, "critical");
  assert.equal(r.health, 35);
});

test("gekoppelt aber nie gestartet ist kein Alarm", () => {
  const basis = { status: "not_configured", health: null, detail: "", metrics: {} };
  const r = backupAgeRules(basis, null, { device_name: "PC Backup Vault", last_seen_at: alt });
  assert.equal(r.status, "not_configured");
  assert.equal(r.health, null);
  assert.match(r.detail, /kein täglicher Lauf erwartet/);
});
