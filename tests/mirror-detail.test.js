// Ein Warnhinweis muss sagen, worueber er warnt.
//
// Anlass: am 2026-09-06 meldete die Spiegelung "Spiegelung mit Warnhinweis"
// und sonst nichts. Der Grund - kc_core_app_registry: verification mismatch,
// weil dem Spiegel drei neu hinzugefuegte Spalten fehlten - stand in den Daten
// und kam nur nicht in der Kachel an.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = readFileSync("supabase/functions/kc-system-check/index.ts", "utf8");
const abschnitt = quelle
  .slice(quelle.indexOf("function mirrorDetail"), quelle.indexOf("// --- Lebenszeichen der Programme"))
  .replace(/:\s*string\[\]/g, "").replace(/:\s*boolean/g, "").replace(/:\s*any/g, "");
const mirrorDetail = new Function(`${abschnitt}; return mirrorDetail;`)();
const gesundAbschnitt = quelle
  .slice(quelle.indexOf("function mirrorHealth"), quelle.indexOf("const worst="))
  .replace(/:\s*any/g, "");
const mirrorHealth = new Function(`${gesundAbschnitt}; return mirrorHealth;`)();

const vorMinuten = m => new Date(Date.now() - m * 60000).toISOString();

test("Eine Warnung nennt Tabelle und Meldung", () => {
  const text = mirrorDetail(
    { status: "warning", age_min: 2 },
    { mirror: { mismatch_count: 0 },
      last_issue: { tabelle: "kc_core_app_registry", message: "kc_core_app_registry: verification mismatch",
                    status: "warning", started_at: vorMinuten(12) } },
    false);
  assert.match(text, /kc_core_app_registry: verification mismatch/);
  assert.match(text, /vor 12 min/);
  assert.match(text, /letzter Lauf danach vor 2 min/, "der Verlauf seit dem Befund gehoert dazu");
});

test("Ein Lauf ohne Tabelle erfindet keine", () => {
  // Laeufe ueber den Gesamtzustand ("47/48 Tabellen frisch") tragen keine
  // Tabelle. Die Kachel schrieb dafuer "unbenannte Tabelle: ..." - ein Name,
  // den es nicht gibt, vor einer Meldung, die fuer sich steht.
  const text = mirrorDetail(
    { status: "warning", age_min: 4 },
    { mirror: { mismatch_count: 0 },
      last_issue: { tabelle: null, status: "warning", started_at: vorMinuten(4),
                    veraltete_tabellen: [{ tabelle: "kc_core_app_registry", status: "warning" }],
                    message: "Privacy-Spiegelung unvollständig/frisch: 47/48 Tabellen innerhalb 65 Minuten fehlerfrei gespiegelt." } },
    false);
  assert.doesNotMatch(text, /unbenannte Tabelle/);
  assert.match(text, /^Privacy-Spiegelung unvollständig\/frisch: 47\/48 Tabellen/);
  assert.match(text, /betroffen: kc_core_app_registry/, "welche der 48 fehlt, ist die eigentliche Frage");
});

test("Ohne Namensliste bleibt der Text ohne leeres 'betroffen:'", () => {
  const text = mirrorDetail(
    { status: "warning", age_min: 4 },
    { mirror: {}, last_issue: { tabelle: null, status: "warning", message: "Sammelbefund", veraltete_tabellen: [] } },
    false);
  assert.doesNotMatch(text, /betroffen/);
});

test("Die Momentaufnahme nennt die veralteten Tabellen", () => {
  const sql = readFileSync("supabase/migrations/202609060021_kc_spiegel_welche_tabelle.sql", "utf8");
  assert.match(sql, /'veraltete_tabellen'/);
  assert.match(sql, /interval '65 minutes'/);
  const ohneKommentar = sql.split("\n").filter(z => !z.trimStart().startsWith("--")).join("\n");
  assert.doesNotMatch(ohneKommentar, /kc_db_mirror_table_rules/, "die Liste darf keine fremde Nebentabelle voraussetzen");
});

test("Ein zu alter Lauf sagt, dass er zu alt ist", () => {
  const text = mirrorDetail({ status: "warning", age_min: 200 }, { mirror: {}, last_issue: null }, false);
  assert.equal(text, "Seit 200 min kein Spiegellauf");
});

test("Gruen nennt Abweichungen und Alter", () => {
  const text = mirrorDetail({ status: "healthy", age_min: 1 }, { mirror: { mismatch_count: 0 } }, false);
  assert.match(text, /0 Abweichungen · letzter Lauf vor 1 min/);
});

test("Ohne Momentaufnahme wird nichts behauptet", () => {
  assert.match(mirrorDetail({ status: "unknown" }, null, true), /nicht abrufbar/);
  assert.match(mirrorDetail({ status: "not_configured" }, null, false), /Keine Spiegelung eingerichtet/);
});

test("Die Momentaufnahme liefert den Grund mit", () => {
  const sql = readFileSync("supabase/migrations/202609060020_kc_spiegel_befund_benennen.sql", "utf8");
  assert.match(sql, /'last_issue'/);
  assert.match(sql, /metrics ->> 'table' as tabelle/);
  assert.match(quelle, /last_issue:snap\?\.last_issue\?\?null/, "der Befund gehoert auch in die Kennzahlen");
});

test("Die Diagnose nennt die Schemaaenderung als erste Spur", () => {
  // Der haeufigste Grund fuer eine Pruefsummen-Abweichung ist eine Spalte, die
  // in der Quelle dazukam und im Spiegel fehlt. Genau das ist am 2026-09-06
  // passiert - und die Diagnose schickte einen vorher zum Mirror-Worker.
  const d = readFileSync("js/diagnostics.js", "utf8");
  assert.match(d, /Der Spiegel zieht Schemaänderungen NICHT automatisch nach/);
  assert.match(d, /ALTER TABLE nachziehen/);
  assert.match(d, /befund\?\.tabelle/);
});

test("Die Diagnose nennt die betroffenen Tabellen statt 'Status unbekannt'", () => {
  const d = readFileSync("js/diagnostics.js", "utf8");
  assert.match(d, /veraltete_tabellen/);
  assert.match(d, /Betroffen: \$\{namen\.join\(", "\)\}/);
});


// Eine Kachel, die aus Gewohnheit gelb steht, verdeckt den Tag darauf einen
// echten Befund. Anlass: am 2026-09-06 war die Abweichung um 11:30 behoben -
// die Kachel waere trotzdem bis zum naechsten Vormittag gelb geblieben.
test("Ein behobener Befund faerbt nicht mehr", () => {
  const frisch = new Date(Date.now() - 60000).toISOString();
  const mh = mirrorHealth({ mirror: { status: "ok", mismatch_count: 0, finished_at: frisch },
                            non_ok_24h: 3, last_issue: { veraltete_tabellen: [] } });
  assert.equal(mh.status, "healthy", "der jetzige Zustand entscheidet, nicht die Vorgeschichte");
  assert.equal(mh.open_tables, 0);
  const text = mirrorDetail(mh, { mirror: { mismatch_count: 0 }, non_ok_24h: 3 }, false);
  assert.match(text, /3 behobene\(r\) Befund\(e\) in 24 h/, "verschwinden darf die Zahl nicht");
});

test("Eine offene Tabelle faerbt sehr wohl", () => {
  const frisch = new Date(Date.now() - 60000).toISOString();
  const mh = mirrorHealth({ mirror: { status: "ok", mismatch_count: 0, finished_at: frisch },
                            non_ok_24h: 1,
                            last_issue: { veraltete_tabellen: [{ tabelle: "kc_core_app_registry", status: "warning" }] } });
  assert.equal(mh.status, "warning");
  assert.equal(mh.open_tables, 1);
});

test("Der jüngste Lauf selbst bleibt ausschlaggebend", () => {
  const frisch = new Date(Date.now() - 60000).toISOString();
  const mh = mirrorHealth({ mirror: { status: "warning", mismatch_count: 1, finished_at: frisch }, non_ok_24h: 1 });
  assert.equal(mh.status, "critical");
});
