// Prueft die Bewertung der Programm-Kachel.
//
// Der Kern der Sache: ein ausbleibendes Lebenszeichen ist KEIN Ausfall. Die
// Lebenszeichen kommen aus dem Browser - hat niemand die Anwendung offen,
// kommt nichts. Erst wenn jemand ausdruecklich entschieden hat, dass sich ein
// Programm melden MUSS, wird ein Ausbleiben zum Befund.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = readFileSync("supabase/functions/kc-system-check/index.ts", "utf8");
const abschnitt = quelle
  .slice(quelle.indexOf("function seit("), quelle.indexOf("// --- Neon-Spiegeldatenbank"))
  .replace(/:\s*string\[\]/g, "").replace(/:\s*any/g, "").replace(/:\s*string/g, "");
const notDeployed = (id, name, kind, status) => ({ id, name, kind, status: "not_configured", health: null, metrics: { deployed: false, status } });
const programResult = new Function("notDeployed", `${abschnitt}; return programResult;`)(notDeployed);

const basis = {
  anwendungen_gesamt: 13, angebunden: 1, ueberwacht: 0, gemeldet_24h: 1,
  ohne_anbindung: ["KC Backup Vault", "KC Communicator", "KC Inventar"],
  ueberfaellig: [], meldet_stoerung: [], zuletzt: [], nicht_registriert: ["kc-system-check", "kicc"],
};
const mit = (a = {}) => programResult({ ok: true, ms: 90, data: { ...basis, ...a } });

test("Solange nichts scharfgestellt ist, ist die Kachel nicht eingerichtet", () => {
  // Nicht gruen: gruen hiesse "alles geprueft", und zwoelf Anwendungen sind es
  // nicht. Nicht rot: es ist nichts kaputt. not_configured faellt aus der
  // Abdeckung heraus und beschoenigt die Zahl damit nicht.
  const r = mit();
  assert.equal(r.status, "not_configured");
  assert.equal(r.health, null);
  assert.equal(r.capacityLabel, "1/13 angebunden");
  assert.match(r.detail, /keine davon ist als Pflicht scharfgestellt/);
  assert.match(r.detail, /ohne Anbindung: KC Backup Vault/);
});

test("Ein scharfgestelltes, puenktliches Programm ist gruen", () => {
  const r = mit({ ueberwacht: 2, angebunden: 2 });
  assert.equal(r.status, "healthy");
  assert.match(r.detail, /2 überwachte Anwendung\(en\) melden sich pünktlich/);
  assert.match(r.detail, /3 noch ohne Anbindung/, "die Luecke bleibt sichtbar");
});

test("Ein ueberfaelliges Programm warnt, meldet aber keinen Ausfall", () => {
  const r = mit({ ueberwacht: 1, ueberfaellig: [{ name: "KC Bilderkasse", alter_minuten: 320, fenster: 60 }] });
  assert.equal(r.status, "warning");
  assert.match(r.detail, /1 überfällig: KC Bilderkasse \(320 min\)/);
});

test("Ein selbst gemeldeter Fehler zaehlt auch ohne Scharfstellung", () => {
  // Der Fall aus der Produktion: KC Dienstplan meldete 3 Fehler, waehrend
  // ueberhaupt kein Programm scharfgestellt war. Die erste Fassung der Kachel
  // haette das verschluckt, weil sie bei ueberwacht===0 sofort
  // "nicht eingerichtet" zurueckgab. Die Scharfstellung regelt, ob SCHWEIGEN
  // ein Befund ist - wer von sich aus Fehler meldet, hat gesprochen.
  const r = mit({ ueberwacht: 0, meldet_stoerung: [{ name: "KC Dienstplan", status: "ONLINE", fehler: 3, alter_minuten: 397 }] });
  assert.equal(r.status, "warning");
  assert.match(r.detail, /meldet Fehler: KC Dienstplan \(3, zuletzt vor 7 h\)/);
});

test("Ein gemeldeter Fehler ist eine Warnung, kein Ausfall", () => {
  // Der Zaehler ist selbst gemeldet und heisst in jedem Programm etwas
  // anderes - daraus einen Ausfall zu machen waere angemasst.
  const r = mit({ ueberwacht: 2, meldet_stoerung: [{ name: "KC Dienstplan", status: "ONLINE", fehler: 3 }] });
  assert.equal(r.status, "warning");
});

test("Ein Fenster im Hintergrund ist keine Stoerung", () => {
  // Die Melder setzen DEGRADED, sobald der Tab in den Hintergrund geht. Wuerde
  // das als Stoerung gelten, meldete jeder Tabwechsel einen Befund - deshalb
  // filtert die Serverfunktion allein nach error_count.
  const sql = readFileSync("supabase/migrations/202609060017_kc_lebenszeichen_anbindung.sql", "utf8");
  const block = sql.slice(sql.indexOf("'meldet_stoerung'"), sql.indexOf("'zuletzt'"));
  assert.match(block, /coalesce\(error_count,0\) > 0/);
  assert.doesNotMatch(block, /status is distinct from 'ONLINE'/,
    "DEGRADED heisst Hintergrund, nicht Stoerung");
});

test("Nie gemeldet zaehlt als ueberfaellig, wenn scharfgestellt", () => {
  const r = mit({ ueberwacht: 1, ueberfaellig: [{ name: "KC Inventar", alter_minuten: null, fenster: 60 }] });
  assert.equal(r.status, "warning");
  assert.match(r.detail, /KC Inventar \(nie min\)|KC Inventar \(nie\)/);
});

test("Fremde Melder gehen nicht verloren", () => {
  const r = mit();
  assert.deepEqual(r.metrics.unregistered, ["kc-system-check", "kicc"],
    "was sich meldet, ohne registriert zu sein, gehoert gesehen");
});

test("Ohne eingespielte Serverfunktion wird nichts behauptet", () => {
  const r = programResult({ ok: false, status: 404 });
  assert.equal(r.status, "not_configured");
});

// Anlass: am 2026-09-06 stand "KC Dienstplan (3)" in der Kachel. Der Satz liest
// sich als Gegenwart; gezaehlt hatte das eine Browser-Sitzung, die sechs
// Stunden vorher aufgehoert hatte zu senden.
test("Ein selbst gemeldeter Fehler nennt sein Alter", () => {
  const r = mit({ meldet_stoerung: [{ name: "KC Dienstplan", fehler: 3, status: "ONLINE", alter_minuten: 397 }] });
  assert.equal(r.status, "warning");
  assert.match(r.detail, /KC Dienstplan \(3, zuletzt vor 7 h\)/);
});

test("Frische Meldungen stehen in Minuten, alte in Tagen", () => {
  const min = mit({ meldet_stoerung: [{ name: "A", fehler: 1, alter_minuten: 12 }] });
  assert.match(min.detail, /A \(1, zuletzt vor 12 min\)/);
  const tage = mit({ meldet_stoerung: [{ name: "B", fehler: 1, alter_minuten: 4400 }] });
  assert.match(tage.detail, /B \(1, zuletzt vor 3 Tagen\)/);
});

test("Ohne Altersangabe wird keines erfunden", () => {
  const r = mit({ meldet_stoerung: [{ name: "C", fehler: 2 }] });
  assert.match(r.detail, /C \(2, Alter unbekannt\)/);
});
