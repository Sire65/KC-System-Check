// Wer nicht melden kann, kann das Nichtmelden erst recht nicht melden.
//
// Anlass: am 2026-09-06 wurde der Dienstplan geoeffnet, und in der Ueberwachung
// aenderte sich nichts. Grund war ein blockierter Meldeweg - fuer den
// Empfaenger nicht von "niemand hat das Programm offen" zu unterscheiden. Die
// einzige Stelle, an der der Grund bekannt ist, ist das Programm selbst.
// Also muss er dort auch sichtbar werden.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const speicher = new Map();
globalThis.localStorage = {
  getItem: k => (speicher.has(k) ? speicher.get(k) : null),
  setItem: (k, v) => speicher.set(k, String(v)),
};
// Kein Takt im Test: sonst laeuft der Prozess weiter.
globalThis.setTimeout = () => 0;
globalThis.setInterval = () => 0;

const { startHeartbeat } = await import(new URL("../share/heartbeat/kc-heartbeat.js", import.meta.url));

const aufbau = (antwort) => {
  const warnungen = [];
  const echt = console.warn;
  console.warn = (...a) => warnungen.push(a.join(" "));
  globalThis.fetch = async () => antwort();
  const h = startHeartbeat({ programId: "kc-test", name: "Test", version: "1.0",
                             endpoint: "https://example.invalid/heartbeat", token: "oeffentlich" });
  return { h, warnungen, zurueck: () => { console.warn = echt; } };
};

test("Ein blockierter Meldeweg nennt seinen Grund in der Konsole", async () => {
  const { h, warnungen, zurueck } = aufbau(() => ({ ok: false, status: 401 }));
  assert.equal(await h.send(), false);
  zurueck();
  assert.equal(warnungen.length, 1, "genau eine Meldung, nicht bei jedem Versuch");
  assert.match(warnungen[0], /HTTP 401/);
  assert.match(warnungen[0], /Programm nicht benutzt/, "der Satz nennt die Verwechslungsgefahr beim Namen");
});

test("Derselbe Grund wird nicht bei jedem Versuch wiederholt", async () => {
  const { h, warnungen, zurueck } = aufbau(() => ({ ok: false, status: 401 }));
  await h.send(); await h.send(); await h.send();
  zurueck();
  assert.equal(warnungen.length, 1, "sonst flutet ein dauerhaft blockierter Meldeweg die Konsole");
  assert.equal(h.state().failedInARow, 3, "gezaehlt wird trotzdem jeder Versuch");
});

test("Ein neuer Grund wird wieder gemeldet, ein Erfolg setzt zurueck", async () => {
  let status = 401;
  const { h, warnungen, zurueck } = aufbau(() => (status === 200 ? { ok: true } : { ok: false, status }));
  await h.send();
  status = 503; await h.send();
  status = 200; await h.send();
  assert.equal(h.state().failedInARow, 0);
  assert.equal(h.state().lastError, null);
  status = 401; await h.send();
  zurueck();
  assert.equal(warnungen.length, 3, "401, dann 503, dann nach dem Erfolg wieder 401");
});

test("Das Paket bleibt ohne KC-Bezug und ohne Geheimnis", () => {
  const js = readFileSync("share/heartbeat/kc-heartbeat.js", "utf8");
  assert.doesNotMatch(js, /supabase\.co|sb_secret_|service_role|eyJ/);
});

test("Die Grenze steht in der Anleitung, nicht nur im Quelltext", () => {
  const md = readFileSync("share/heartbeat/README.md", "utf8");
  assert.match(md, /Wenn das Melden selbst scheitert/);
  assert.match(md, /nicht zu unterscheiden/);
  assert.match(md, /Signal, das sich fälschen lässt, ist schlechter/,
    "der Endpunkt darf nicht fuer unangemeldete Aufrufe geoeffnet werden");
});
