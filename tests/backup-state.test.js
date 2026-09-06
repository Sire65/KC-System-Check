// Prueft die Bewertung der Sicherungs-Kachel gegen echte und gedachte Faelle.
//
// Eine Sicherung ist erst dann eine Sicherung, wenn sie frisch ist UND
// geprueft. Beides wird getrennt bewertet: ein frischer, aber ungepruefter
// Satz ist kein Ausfall, aber auch keine Zusage.
//
// Die Funktion wird aus der Edge Function geladen statt nachgebaut - eine
// zweite Fassung waere ein zweiter Kern.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = readFileSync("supabase/functions/kc-system-check/index.ts", "utf8");
const abschnitt = quelle
  .slice(quelle.indexOf("function backupResult"), quelle.indexOf("function telemetryState"))
  .replace(/:\s*string\[\]/g, "").replace(/:\s*any/g, "").replace(/:\s*string/g, "");
const mb = n => Math.round(n / 1024 / 1024 * 10) / 10;
const backupResult = new Function("mb", `${abschnitt}; return backupResult;`)(mb);

const gut = {
  letzter_ok_am: "2026-09-06T03:30:08Z", letzter_ok_alter_stunden: 6.9,
  tabellen: 36, tabellen_ok: 36, zeilen: 613, bytes: 759808,
  neuester_status: "ok", pruefung_status: "ok", pruefung_alter_stunden: 6.4,
  pruefung_tabellen: 36, pruefung_fehler: 0, haengende_saetze: 0, altlasten: 2, saetze_8_tage: 8,
};
const mit = (aenderung = {}) => backupResult({ ok: true, ms: 300, data: { ...gut, ...aenderung } });

test("Der echte Zustand von heute ist gruen", () => {
  const r = mit();
  assert.equal(r.status, "healthy");
  assert.match(r.detail, /gesichert und geprüft/);
  assert.match(r.capacityLabel, /vor 6\.9 h/);
});

test("Alte, nie abgeschlossene Saetze faerben die Ampel nicht", () => {
  // In der Produktion liegen ein 'running' von vor neun Tagen und ein 'error'
  // von vor neunzehn. Beides sind Ueberbleibsel aus der Einrichtung. Wuerden
  // sie warnen, stuende die Kachel fuer immer gelb - genau der Fehler, der
  // schon bei den 244 Rechten und beim Vacuum-Rueckstand gemacht wurde.
  const r = mit({ altlasten: 2 });
  assert.equal(r.status, "healthy", "Datenrest ist kein Vorfall");
  assert.match(r.detail, /2 alte\(r\) Satz\/Sätze ohne Abschluss/, "sichtbar bleibt er trotzdem");
});

test("Ein frisch haengender Lauf warnt sehr wohl", () => {
  const r = mit({ haengende_saetze: 1 });
  assert.equal(r.status, "warning");
  assert.match(r.detail, /hängen seit über zwei Stunden/);
});

test("Ohne jede erfolgreiche Sicherung ist es rot", () => {
  const r = mit({ letzter_ok_alter_stunden: null, letzter_ok_am: null });
  assert.equal(r.status, "critical");
  assert.match(r.detail, /keine erfolgreiche Sicherung/);
  assert.equal(r.capacityLabel, "Keine Sicherung");
});

test("Eine zu alte Sicherung: erst gelb, dann rot", () => {
  assert.equal(mit({ letzter_ok_alter_stunden: 20 }).status, "healthy", "innerhalb des Tagesrhythmus");
  assert.equal(mit({ letzter_ok_alter_stunden: 30 }).status, "warning", "ein Tag ausgefallen");
  assert.equal(mit({ letzter_ok_alter_stunden: 60 }).status, "critical", "zwei Tage ausgefallen");
});

test("Eine fehlgeschlagene Pruefung ist rot, auch wenn die Sicherung frisch ist", () => {
  const r = mit({ pruefung_status: "error" });
  assert.equal(r.status, "critical");
  const f = mit({ pruefung_fehler: 3 });
  assert.equal(f.status, "critical");
  assert.match(f.detail, /3 Tabelle\(n\) haben die Prüfung nicht bestanden/);
});

test("Frisch, aber nie geprueft: gelb, nicht gruen", () => {
  // Eine ungepruefte Sicherung ist eine Vermutung, keine Zusage.
  const r = mit({ pruefung_status: null, pruefung_alter_stunden: null });
  assert.equal(r.status, "warning");
  assert.match(r.detail, /noch nie geprüft/);
});

test("Ein fehlgeschlagener juengster Versuch wird gemeldet", () => {
  const e = mit({ neuester_status: "error" });
  assert.equal(e.status, "warning");
  assert.match(e.detail, /jüngste Versuch ist fehlgeschlagen/);
});

test("Nicht abrufbar ist nicht gruen und nicht rot", () => {
  // Regel 11: UNKNOWN wird nie als OK angezeigt - aber eine gescheiterte
  // Abfrage ist auch kein Beweis fuer eine kaputte Sicherung.
  const r = backupResult({ ok: false, reason: "http_500", ms: 120 });
  assert.equal(r.status, "unknown");
  assert.equal(r.health, null);
  const ohne = backupResult({ ok: false, reason: "kein_zugang" });
  assert.equal(ohne.status, "not_configured");
});
