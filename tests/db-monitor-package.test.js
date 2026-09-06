// Das tragbare Paket darf es nur einmal geben.
//
// share/db-monitor/install.sql ist die Quelle. Die Migration
// 202609060011_db_monitor_paket.sql traegt denselben Text, weil Supabase
// Migrationen einzeln einspielt und kein psql-\i kennt. Genau dafuer ist
// dieser Test da: waechst die eine Fassung und die andere nicht, faellt es
// hier auf und nicht erst im Betrieb.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const paket = readFileSync("share/db-monitor/install.sql", "utf8");
// Jede Aenderung am Paket braucht eine neue Migration - eine bereits
// eingespielte darf sich nicht mehr aendern. Geprueft wird deshalb die
// juengste Paketmigration.
const paketMigrationen = readdirSync("supabase/migrations").filter(f => f.includes("db_monitor_paket")).sort();
const migration = readFileSync(`supabase/migrations/${paketMigrationen.at(-1)}`, "utf8");
const anschlussMigration = readFileSync(`supabase/migrations/${paketMigrationen[0]}`, "utf8");

test("Die juengste Paketmigration traegt das Paket unveraendert", () => {
  assert.ok(migration.includes(paket),
    `share/db-monitor/install.sql und ${paketMigrationen.at(-1)} sind auseinandergelaufen - neue Migration noetig`);
});

test("Sichtbare Meldungen des Pakets verwenden echte Umlaute", () => {
  // Diese Texte stehen seit dem Anbinden der Neon-Kachel woertlich in der App.
  const sichtbar = [...paket.matchAll(/format\('([^']*)'/g)].map(m => m[1])
    .concat([...paket.matchAll(/hinweise := hinweise \|\| '([^']*)'/g)].map(m => m[1]))
    .concat([...paket.matchAll(/then '([^']*)' else '([^']*)' end as name/g)].flatMap(m => [m[1], m[2]]));
  const verdaechtig = sichtbar
    .filter(t => !t.includes("\n"))   // Kommentarzeilen, die der Ausdruck streift
    .filter(t => /(ueber|geprueft|moeglich|Rueckstand|ausgeschoepft|uneingeschraenkt|Eigentuemer|grosse|fuer|Kapazitaet)/.test(t));
  assert.deepEqual(verdaechtig, [], `Meldungen mit ASCII-Umlauten: ${verdaechtig.join(" | ")}`);
});

test("Paket nennt keine KC-Objekte - sonst ist es nicht tragbar", () => {
  const treffer = paket.match(/kc_[a-z_]+/g) || [];
  assert.deepEqual(treffer, [], `Paket enthaelt KC-spezifische Namen: ${treffer.join(", ")}`);
});

test("Paket setzt keine Supabase-Rollen voraus", () => {
  // Jede Erwaehnung von anon/authenticated/service_role muss entweder ein
  // Vorgabewert oder durch eine Existenzpruefung abgesichert sein.
  const zeilen = paket.split("\n");
  const ungesichert = zeilen.filter((z, i) => {
    if (!/\b(anon|authenticated|service_role)\b/.test(z)) return false;
    if (/default array\[/.test(z)) return false;                 // Vorgabewert
    if (/^\s*--/.test(z)) return false;                          // Kommentar
    const umfeld = zeilen.slice(Math.max(0, i - 1), i + 1).join("\n");
    return !/rolname = '/.test(umfeld);
  });
  assert.deepEqual(ungesichert, [], `Ungesicherter Rollenbezug: ${ungesichert.join(" | ")}`);
});

test("KC-Funktionen rufen das Paket auf, statt die Logik zu wiederholen", () => {
  const anschluss = anschlussMigration.slice(anschlussMigration.indexOf("KC-Anschluss"));
  assert.match(anschluss, /db_monitor\.security_audit\(/);
  assert.match(anschluss, /db_monitor\.capacity\(/);
  // Die alte, doppelte Logik darf im Anschluss nicht mehr auftauchen.
  assert.doesNotMatch(anschluss, /pg_stat_user_tables/);
  assert.doesNotMatch(anschluss, /information_schema\.role_table_grants/);
});
