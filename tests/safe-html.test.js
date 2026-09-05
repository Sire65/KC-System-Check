import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { esc, sanitizeDeep } from '../js/safe-html.js';

test('esc neutralisiert alle HTML-wirksamen Zeichen', () => {
  assert.equal(esc('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('" onmouseover="x'), '&quot; onmouseover=&quot;x');
  assert.equal(esc("it's"), 'it&#39;s');
});

test('esc macht aus fehlenden Werten leeren Text statt "null"', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('sanitizeDeep entschärft verschachtelte Zeichenketten und lässt Zahlen unberührt', () => {
  const payload = {
    sales: [{ register_id: '<img src=x onerror=alert(1)>', amount_cents: 1250, sync_state: null }],
    heartbeats: [{ program_id: 'kc-marktkasse', error_count: 3, nested: { version: '<b>1</b>' } }],
    checked_at: '2026-09-05T10:00:00Z'
  };
  const safe = sanitizeDeep(payload);
  assert.equal(safe.sales[0].register_id, '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(safe.sales[0].amount_cents, 1250, 'Beträge müssen Zahlen bleiben');
  assert.equal(safe.sales[0].sync_state, null);
  assert.equal(safe.heartbeats[0].error_count, 3);
  assert.equal(safe.heartbeats[0].nested.version, '&lt;b&gt;1&lt;/b&gt;');
  assert.equal(safe.checked_at, '2026-09-05T10:00:00Z', 'Zeitstempel bleiben parsebar');
});

test('sanitizeDeep kann einzelne Felder roh lassen', () => {
  const safe = sanitizeDeep({ error: 'Leitstand HTTP 500 & Abbruch', detail: 'a & b' }, { keepRaw: ['error'] });
  assert.equal(safe.error, 'Leitstand HTTP 500 & Abbruch');
  assert.equal(safe.detail, 'a &amp; b');
});

test('sanitizeDeep bricht bei zu tiefer Verschachtelung kontrolliert ab', () => {
  let deep = 'x';
  for (let i = 0; i < 40; i++) deep = { deep };
  assert.doesNotThrow(() => sanitizeDeep(deep));
});

test('jede Fremddatenquelle läuft durch den Sanitizer', () => {
  const live = fs.readFileSync('js/adapters/live.js', 'utf8');
  const ops = fs.readFileSync('js/remote-operations.js', 'utf8');
  assert.match(live, /import\{sanitizeDeep\}from"\.\.\/safe-html\.js"/);
  assert.equal((live.match(/sanitizeDeep\(/g) || []).length, 3, 'runLive, History und Leitstand müssen entschärft werden');
  assert.match(ops, /paint\(sanitizeDeep\(await r\.json\(\)\)\)/);
});
