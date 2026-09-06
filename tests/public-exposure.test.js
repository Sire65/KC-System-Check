// Prueft die Geheimnis-Erkennung der GitHub-Kachel gegen echte Faelle.
//
// Hintergrund: "Repository ist oeffentlich" war eine Dauerwarnung fuer eine
// Eigenschaft, kein Mangel - dieselbe Sorte Fehlalarm wie die 244 vermeintlich
// ungedeckten Rechte. Geprueft wird jetzt, was wirklich schadet: liegt in der
// mitgelieferten Laufzeitkonfiguration etwas Geheimes?
//
// Die Funktion wird aus der Edge Function geladen statt nachgebaut. Eine
// zweite Fassung waere ein zweiter Kern und wuerde genau das verdecken, was
// hier abgesichert werden soll.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const quelle = readFileSync("supabase/functions/kc-system-check/index.ts", "utf8");
const abschnitt = quelle
  .slice(quelle.indexOf("function secretFindings"), quelle.indexOf("// Die Adresse wird aus der API-Antwort abgeleitet"))
  .replace(/:\s*string\[\]/g, "")
  .replace(/:\s*string/g, "");
const secretFindings = new Function(`${abschnitt}; return secretFindings;`)();

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = payload => `${b64({ alg: "HS256" })}.${b64(payload)}.xxxxxxxxxx`;

test("Die echte Laufzeitkonfiguration enthaelt nichts Geheimes", () => {
  const echt = readFileSync("config/runtime.public.json", "utf8");
  assert.deepEqual(secretFindings(echt), [],
    "Wenn das hier ausschlaegt, steht ein Geheimnis in einer weltweit lesbaren Datei");
});

test("Oeffentliche Adressen und der anon-Schluessel sind kein Fund", () => {
  assert.deepEqual(secretFindings('{"u":"https://x.supabase.co/functions/v1/a"}'), []);
  assert.deepEqual(secretFindings(`{"t":"${jwt({ role: "anon", iss: "supabase" })}"}`), []);
});

test("Ein Geheimschluessel wird in jeder Form gefunden", () => {
  assert.deepEqual(secretFindings('{"k":"sb_secret_abc123"}'), ["Supabase-Geheimschlüssel"]);
  assert.deepEqual(secretFindings('{"k":"service_role"}'), ["service_role-Schlüssel"]);
  // Im JWT steht service_role base64-kodiert und damit nicht im Klartext -
  // deshalb wird der Rumpf entschluesselt statt nur nach Text gesucht.
  assert.deepEqual(secretFindings(`{"t":"${jwt({ role: "service_role" })}"}`), ["JWT mit der Rolle service_role"]);
});

test("Verbindungszeichenketten und private Schluessel werden gefunden", () => {
  assert.deepEqual(secretFindings('{"db":"postgresql://nutzer:geheim@host.neon.tech/neondb"}'),
    ["Verbindungszeichenkette mit Passwort"]);
  assert.deepEqual(secretFindings("-----BEGIN RSA PRIVATE KEY-----\nMII..."), ["privater Schlüssel"]);
});

test("Der gefundene Wert taucht im Befund nie auf", () => {
  const befunde = secretFindings('{"k":"sb_secret_supergeheim","db":"postgresql://a:passwort123@h/d"}');
  assert.ok(befunde.length >= 2);
  for (const b of befunde) {
    assert.doesNotMatch(b, /supergeheim|passwort123/, `Der Befund verraet das Geheimnis: ${b}`);
  }
});

test("Ungeprueft ist nicht gruen", () => {
  // War die Datei nicht abrufbar, darf die Kachel nicht behaupten, es sei
  // nichts drin. AGENTS.md Regel 11: UNKNOWN wird nie als OK angezeigt.
  assert.match(quelle, /if\(cfg\.state==="unbekannt"\)return\{id,name,kind,status:"unknown"/);
  assert.match(quelle, /public_config:cfg\.state/);
});
