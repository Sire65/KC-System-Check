import test from 'node:test';
import assert from 'node:assert/strict';
import { overallStatus, statusClass } from '../js/usage.js';

test('ohne jede Messung gibt es kein GRÜN', () => {
  assert.equal(overallStatus([]), 'unknown');
  assert.equal(overallStatus([{ status: 'not_configured' }, { status: 'unknown' }]), 'unknown');
});

test('eine einzige echte Messung genügt für eine Bewertung', () => {
  assert.equal(overallStatus([{ status: 'healthy' }]), 'ok');
  assert.equal(overallStatus([{ status: 'not_configured' }, { status: 'healthy' }]), 'ok');
});

test('Störungen schlagen Warnungen, Warnungen schlagen OK', () => {
  assert.equal(overallStatus([{ status: 'healthy' }, { status: 'warning' }]), 'warn');
  assert.equal(overallStatus([{ status: 'warning' }, { status: 'critical' }]), 'bad');
  assert.equal(overallStatus([{ status: 'unknown' }, { status: 'critical' }]), 'bad');
});

test('unbekannte Zustände werden grau, niemals grün', () => {
  assert.equal(statusClass('unknown'), 'idle');
  assert.equal(statusClass('not_configured'), 'idle');
  assert.equal(statusClass(undefined), 'idle');
  assert.equal(statusClass('healthy'), 'ok');
});
