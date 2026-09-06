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

test('der erste gemessene Zustand gilt sofort', () => {
  const out = run(['critical']);
  assert.equal(out.alarms.length, 1);
  assert.equal(out.alarms[0].status, 'critical');
  assert.equal(out.notify.length, 1, 'ein neuer Alarm wird gemeldet');
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
  let out = evaluateAlarms({ signals: sig('critical'), memory, now }); memory = out.memory;
  assert.equal(out.notify.length, 1);
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
