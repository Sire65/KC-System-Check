// 0.10.6 KC-CHECK-FRA-LAEUFT-PLANMAESSIG: Die nächtliche Komplett-Sicherung nach Neon Frankfurt darf während
// ihres planmäßigen Laufs (01:00–03:58 UTC) nicht gelb melden. Gelb/Rot nur bei echtem Problem.
// Die Funktion wird aus der Edge Function geladen statt nachgebaut - eine zweite Fassung waere ein zweiter Kern.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = readFileSync("supabase/functions/kc-system-check/index.ts", "utf8");
const abschnitt = quelle
  .slice(quelle.indexOf("function frankfurtBackupResult"), quelle.indexOf("// PC Backup Vault"))
  .replace(/:\s*any/g, "").replace(/:\s*number/g, "");
const laden = jetzt => {
  const T = Date.parse(jetzt);
  class FesterTag extends Date { constructor(...a) { super(...(a.length ? a : [T])); } static now() { return T; } }
  return new Function("Date", `${abschnitt}; return frankfurtBackupResult;`)(FesterTag);
};
const zeile = (status, zeit, extra = {}) => ({ lauf: "2026-10-12", status, zeit, text: "läuft: 316 von 316 Teilen gesichert, 259 zurückgelesen", metrics: { teile: 316, geprueft: 259, bytes: 12e6, ...extra } });

test("Heute Nacht (01:46 UTC, Lauf meldet sich) ist grün statt gelb", () => {
  const r = laden("2026-10-12T01:46:00Z")(zeile("laeuft", "2026-10-12T01:44:01Z"));
  assert.equal(r.status, "healthy");
  assert.match(r.detail, /planmäßig/);
  assert.equal(r.metrics.scheduled_run, true);
});

test("Lauf meldet sich über 15 Min. nicht mehr → gelb", () => {
  const r = laden("2026-10-12T02:30:00Z")(zeile("laeuft", "2026-10-12T02:10:00Z"));
  assert.equal(r.status, "warning");
  assert.match(r.detail, /seit über 15 Min/);
});

test("Zeitfenster vorbei, aber noch „läuft“ → gelb", () => {
  const r = laden("2026-10-12T04:05:00Z")(zeile("laeuft", "2026-10-12T03:56:00Z"));
  assert.equal(r.status, "warning");
  assert.match(r.detail, /Zeitfenster vorbei/);
});

test("Fertig und ok → grün; Fehler bleibt rot, Warnung gelb", () => {
  const f = laden("2026-10-12T08:00:00Z");
  assert.equal(f(zeile("ok", "2026-10-12T02:00:07Z")).status, "healthy");
  assert.equal(f(zeile("fehler", "2026-10-12T03:50:00Z")).status, "critical");
  assert.equal(f(zeile("warnung", "2026-10-12T02:00:00Z")).status, "warning");
});

test("Veraltet bleibt gelb/rot, nie gemeldet bleibt UNKNOWN", () => {
  const f = laden("2026-10-14T08:00:00Z");
  assert.equal(f(zeile("ok", "2026-10-13T02:00:00Z")).status, "warning"); // 30 h
  assert.equal(f(zeile("ok", "2026-10-11T02:00:00Z")).status, "critical"); // 78 h
  assert.equal(f(null).status, "unknown");
  assert.equal(f({ ...zeile("laeuft", null) }).status, "unknown");
});
