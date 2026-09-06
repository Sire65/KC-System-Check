import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlarms, normalizeStatus, signalsFromResults, DEFAULT_POLICY } from '../js/alarm-policy.js';

const MIN = 60000;
const sig = (status, id = 'kc_core') => [{ id, name: 'KC Core', status }];

function run(steps, { policy, maintenance, start = 1_000_000 } = {}) {
  let memory = {}, out = null, now = start;
  for (const status of steps) {
    out = evaluateAlarms({ signals: sig(status), memory, policy, maintenance, now });
    memory = out.memory;
    now += MIN;
  }
  return out;
}

test('der erste gemessene Zustand gilt sofort, gemeldet wird er noch nicht', () => {
  // Der Zustand gilt ab der ersten Messung - daran aendert sich nichts.
  // Gemeldet wird er aber nicht: eine einzelne Messung ist genau das, was
  // confirmAfter ausschliessen soll.
  //
  // Aus dem Betrieb gelernt am 2026-09-06: beim ersten scharfen Lauf war die
  // Neon-Kachel brandneu und stand fuer genau eine Messung auf "1 Tabelle mit
  // Vacuum-Rueckstand". Beim naechsten Lauf war sie wieder gruen - die Meldung
  // war da schon raus, weil ein neues Signal die Entprellung uebersprang.
  const out = run(['critical']);
  assert.equal(out.alarms.length, 1, 'der Zustand gilt');
  assert.equal(out.alarms[0].status, 'critical');
  assert.equal(out.notify.length, 0, 'nach einer einzigen Messung wird nicht gemeldet');
});

test('ein von Anfang an gestoertes System meldet - nur eine Messung spaeter', () => {
  // Die Gegenprobe zum Test darueber: wer beim Start schon kaputt ist, darf
  // nicht dauerhaft stumm bleiben.
  const out = run(['critical', 'critical']);
  assert.equal(out.notify.length, 1, 'zweimal bestaetigt wird gemeldet');
  const drei = run(['critical', 'critical', 'critical']);
  assert.equal(drei.notify.length, 0, 'danach nicht bei jeder weiteren Messung');
});

test('ein einzelner Ausreißer löst keinen Alarm aus', () => {
  const out = run(['healthy', 'critical']);
  assert.equal(out.alarms.length, 0, 'eine einzelne Messung reicht nicht');
  assert.equal(out.notify.length, 0);
});

test('zwei aufeinanderfolgende Störungen lösen aus', () => {
  const out = run(['healthy', 'critical', 'critical']);
  assert.equal(out.alarms.length, 1);
  assert.equal(out.alarms[0].status, 'critical');
});

test('Flattern zwischen grün und rot erzeugt keinen Alarmsturm', () => {
  const out = run(['healthy', 'critical', 'healthy', 'critical', 'healthy', 'critical']);
  assert.equal(out.alarms.length, 0, 'kein Zustand wird je bestätigt');
  assert.equal(out.notify.length, 0);
});

test('Entwarnung braucht mehr Bestätigung als Alarm', () => {
  let memory = {}, now = 1_000_000, out;
  for (const status of ['critical', 'critical']) {
    out = evaluateAlarms({ signals: sig(status), memory, now }); memory = out.memory; now += MIN;
  }
  out = evaluateAlarms({ signals: sig('healthy'), memory, now }); memory = out.memory; now += MIN;
  assert.equal(out.alarms.length, 1, 'nach einer guten Messung bleibt der Alarm stehen');
  for (let i = 0; i < DEFAULT_POLICY.confirmAfter.healthy - 1; i++) {
    out = evaluateAlarms({ signals: sig('healthy'), memory, now }); memory = out.memory; now += MIN;
  }
  assert.equal(out.alarms.length, 0, 'erst nach genug guten Messungen ist der Alarm weg');
});

test('ein bestehender Alarm wird nicht bei jeder Messung erneut gemeldet', () => {
  let memory = {}, now = 1_000_000;
  // Zwei Messungen, damit der Alarm bestaetigt und einmal gemeldet ist.
  let out = evaluateAlarms({ signals: sig('critical'), memory, now }); memory = out.memory;
  assert.equal(out.notify.length, 0, 'die erste Messung meldet noch nicht');
  now += MIN;
  out = evaluateAlarms({ signals: sig('critical'), memory, now }); memory = out.memory;
  assert.equal(out.notify.length, 1, 'die zweite meldet');
  for (let i = 0; i < 10; i++) {
    now += MIN;
    out = evaluateAlarms({ signals: sig('critical'), memory, now });
    memory = out.memory;
  }
  assert.equal(out.alarms.length, 1, 'der Alarm besteht weiter');
  assert.equal(out.notify.length, 0, 'aber es wird nicht zehnmal gemeldet');
});

test('nach der Wiedervorlagefrist wird erneut gemeldet', () => {
  let memory = {}, now = 1_000_000;
  let out = evaluateAlarms({ signals: sig('critical'), memory, now }); memory = out.memory;
  now += DEFAULT_POLICY.renotifyAfterMinutes * MIN + MIN;
  out = evaluateAlarms({ signals: sig('critical'), memory, now });
  assert.equal(out.notify.length, 1);
});

test('Folgealarme hinter einer Störung werden unterdrückt', () => {
  const policy = { dependencies: { kc_core: ['internet'], mirror: ['kc_core'] } };
  const signals = [
    { id: 'internet', name: 'Internet', status: 'critical' },
    { id: 'kc_core', name: 'KC Core', status: 'critical' },
    { id: 'mirror', name: 'Spiegelung', status: 'critical' }
  ];
  const out = evaluateAlarms({ signals, policy, now: 1_000_000 });
  assert.deepEqual(out.alarms.map(a => a.id), ['internet'], 'nur die Ursache alarmiert');
  assert.equal(out.suppressed.length, 2);
  assert.equal(out.suppressed[0].reason, 'abhaengigkeit');
  assert.equal(out.suppressed[0].causedBy, 'internet');
});

test('ein Wartungsfenster schaltet stumm, aber nur bis zum Ablauf', () => {
  const now = 1_000_000;
  const silenced = evaluateAlarms({ signals: sig('critical'), maintenance: { kc_core: now + 10 * MIN }, now });
  assert.equal(silenced.alarms.length, 0);
  assert.equal(silenced.suppressed[0].reason, 'wartung');
  const expired = evaluateAlarms({ signals: sig('critical'), maintenance: { kc_core: now - MIN }, now });
  assert.equal(expired.alarms.length, 1, 'abgelaufene Wartung schaltet nicht mehr stumm');
});

test('ein lang offener Alarm eskaliert', () => {
  let memory = {}, now = 1_000_000;
  let out = evaluateAlarms({ signals: sig('critical'), memory, now }); memory = out.memory;
  assert.equal(out.alarms[0].escalated, false);
  now += (DEFAULT_POLICY.escalateAfterMinutes + 1) * MIN;
  out = evaluateAlarms({ signals: sig('critical'), memory, now });
  assert.equal(out.alarms[0].escalated, true);
});

test('Alarme sind nach Schwere sortiert', () => {
  const signals = [
    { id: 'a', name: 'A', status: 'warning' },
    { id: 'b', name: 'B', status: 'critical' },
    { id: 'c', name: 'C', status: 'unknown' }
  ];
  const out = evaluateAlarms({ signals, now: 1_000_000 });
  assert.deepEqual(out.alarms.map(a => a.status), ['critical', 'warning', 'unknown']);
});

test('unbekannt ist ein Alarmzustand, nicht Stille', () => {
  const out = run(['unknown', 'unknown', 'unknown']);
  assert.equal(out.alarms[0].status, 'unknown');
});

test('nicht konfigurierte Prüfungen erzeugen keine Signale', () => {
  const signals = signalsFromResults([
    { id: 'kc_core', name: 'KC Core', status: 'healthy' },
    { id: 'r2', name: 'R2', status: 'not_configured' },
    { id: 'oci', name: 'OCI', status: 'disabled' },
    null
  ]);
  assert.deepEqual(signals.map(s => s.id), ['kc_core']);
});

test('Statusnamen aus verschiedenen Quellen werden vereinheitlicht', () => {
  assert.equal(normalizeStatus('bad'), 'critical');
  assert.equal(normalizeStatus('warn'), 'warning');
  assert.equal(normalizeStatus('ok'), 'healthy');
  assert.equal(normalizeStatus('not_configured'), 'unknown');
  assert.equal(normalizeStatus(undefined), 'unknown');
});

test("Eine offene Warnung wird nicht stuendlich wiederholt, eine Stoerung schon",()=>{
  const jetzt=Date.now(),vorZweiStunden=jetzt-2*60*60*1000;
  const speicher={
    gelb:{confirmed:"warning",candidate:null,streak:0,since:vorZweiStunden,lastNotifiedAt:vorZweiStunden},
    rot:{confirmed:"critical",candidate:null,streak:0,since:vorZweiStunden,lastNotifiedAt:vorZweiStunden}
  };
  const ergebnis=evaluateAlarms({
    signals:[{id:"gelb",name:"Gelb",status:"warning"},{id:"rot",name:"Rot",status:"critical"}],
    memory:speicher,policy:DEFAULT_POLICY,now:jetzt});
  assert.deepEqual(ergebnis.notify.map(x=>x.id),["rot"],"nur die Stoerung wird wiedervorgelegt");
  assert.equal(ergebnis.alarms.length,2,"offen bleiben beide");
});

test("renotifyStatuses ist Konfiguration, nicht fest verdrahtet",()=>{
  const jetzt=Date.now(),alt=jetzt-2*60*60*1000;
  const ergebnis=evaluateAlarms({
    signals:[{id:"gelb",name:"Gelb",status:"warning"}],
    memory:{gelb:{confirmed:"warning",candidate:null,streak:0,since:alt,lastNotifiedAt:alt}},
    policy:{...DEFAULT_POLICY,renotifyStatuses:["critical","warning"]},now:jetzt});
  assert.deepEqual(ergebnis.notify.map(x=>x.id),["gelb"],"wer Warnungen wiedervorlegen will, kann das einstellen");
});

test('auf dem Weg zur Erholung wird die alte Warnung nicht nachgemeldet', () => {
  // Der erste Versuch des Erstmess-Fixes benutzte streak als Zaehler fuer den
  // bestaetigten Zustand. streak zaehlt im Wechselfall aber die Messungen des
  // Kandidaten - ein Signal, das gerade von warning nach healthy wechselte,
  // meldete dadurch unterwegs seine alte Warnung nach. Gefunden vom SQL-Test.
  let memory = {}, now = 1_000_000;
  const messe = status => {
    const out = evaluateAlarms({ signals: [{ id: 's', name: 'S', status }], memory, now });
    memory = out.memory; now += MIN; return out;
  };
  messe('warning');                       // angelegt, nicht gemeldet
  const a = messe('healthy');             // Kandidat healthy, streak 1
  const b = messe('healthy');             // streak 2 - hier meldete es faelschlich
  assert.deepEqual(a.notify, [], 'unterwegs wird nichts gemeldet');
  assert.deepEqual(b.notify, [], 'auch nicht, wenn der Kandidat zweimal gemessen wurde');
  const c = messe('healthy');             // bestaetigt healthy
  assert.deepEqual(c.alarms, [], 'am Ende ist nichts mehr offen');
  assert.deepEqual(c.notify, []);
});
