import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const VERSION = JSON.parse(fs.readFileSync('version.json', 'utf8')).version;
const URL = 'http://127.0.0.1:4173/';

// Produktionsendpunkte werden blockiert: der Test darf keine echten Prüfläufe auslösen.
async function isolate(page, handler) {
  await page.route('**://*.supabase.co/**', handler || (route => route.abort()));
}

test('Ohne erreichbare Prüf-API zeigt der Leitstand kein Grün', async ({ page }) => {
  await isolate(page);
  await page.goto(URL);
  await expect(page.locator('.topbar h1')).toContainText('KC System Check');
  await expect(page.locator('#appVersion')).toHaveText(`v${VERSION}`);
  await expect(page.locator('#healthValue')).toHaveText('—');
  await expect(page.locator('#healthText')).toHaveText('Noch nicht geprüft');
  await expect(page.locator('#statusOrb')).not.toHaveAttribute('data-state', 'ok');
  await expect(page.locator('#coverageText')).toContainText('0%');
  await expect(page.locator('#metricHealth')).toHaveText('—');
});

test('Eingeschleustes HTML aus Fremddaten wird als Text angezeigt, nicht ausgeführt', async ({ page }) => {
  const payload = {
    checked_at: new Date().toISOString(),
    heartbeats: [{ program_id: '<img src=x onerror="window.__pwned=1">', instance_id: 'i1', version: '1.0', measured_at: new Date().toISOString() }],
    sales: [{ event_id: 'e1', register_id: '<img src=y onerror="window.__pwned=1">', event_type: 'sale', amount_cents: 500, occurred_at: new Date().toISOString() }],
    flows: [], apps: [], communication: {}, backup: {},
    thresholds: { heartbeat_warn_seconds: 90, heartbeat_critical_seconds: 180 }
  };
  await page.addInitScript(() => sessionStorage.setItem('kc-system-check-admin-jwt', 'test-token'));
  await isolate(page, route =>
    route.request().url().includes('leitstand=1')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
      : route.abort()
  );
  await page.goto(URL);
  await page.locator('[data-view="live"]').click();
  await expect(page.locator('#liveSales')).toContainText('onerror');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator('#livePrograms img, #liveSales img').count()).toBe(0);
});

test('Fernschutz fragt erst beim Öffnen des LIVE-Tabs nach', async ({ page }) => {
  let opsCalls = 0;
  await page.addInitScript(() => sessionStorage.setItem('kc-system-check-admin-jwt', 'test-token'));
  await isolate(page, route => {
    const req = route.request();
    // Der CORS-Preflight ist keine eigene Abfrage und wird nicht mitgezaehlt.
    if (req.method() !== 'OPTIONS' && req.url().includes('kc-live-operations-watch')) opsCalls++;
    return route.abort();
  });
  await page.goto(URL);
  await page.waitForTimeout(3000);
  const afterIdle = opsCalls;
  expect(afterIdle).toBeLessThanOrEqual(1);
  await page.locator('[data-view="live"]').click();
  await page.waitForTimeout(500);
  expect(opsCalls).toBeGreaterThan(afterIdle);
});

test('Der Startvorgang läuft genau einmal, nicht doppelt', async ({ page }) => {
  const startupCalls = [];
  await isolate(page, route => {
    const req = route.request();
    if (req.method() !== 'OPTIONS' && req.url().includes('history=1')) startupCalls.push(req.url());
    return route.abort();
  });
  await page.goto(URL);
  await page.waitForTimeout(4000);
  // Der Service Worker darf beim ersten Laden keinen Reload ausloesen: das
  // verdoppelt sonst jede Startabfrage und damit den Free-Tier-Verbrauch.
  expect(startupCalls.length).toBe(1);
});

test('Eine neue serverseitige Prüfung erscheint ohne App-Änderung', async ({ page }) => {
  const payload = {
    version: 'test', status: 'critical', health: 35, coverage: 100,
    checkedAt: new Date().toISOString(), duration_ms: 12, recorded: false,
    results: [
      { id: 'kc_core', name: 'KC Core · Supabase', kind: 'database', status: 'healthy', health: 100, latency: 42, detail: 'erreichbar' },
      { id: 'db_security', name: 'Datenbank-Sicherheitslage', kind: 'security', status: 'critical', health: 35, latency: 30, detail: '2 Tabelle(n) ohne RLS: kc_test, kc_demo' }
    ]
  };
  await isolate(page, route =>
    route.request().url().includes('/kc-system-check?') && route.request().url().includes('trigger=')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
      : route.abort()
  );
  await page.goto(URL);
  await page.locator('#oneTouchBtn').click();
  await expect(page.locator('#systemCards')).toContainText('Datenbank-Sicherheitslage');
  await expect(page.locator('#systemCards')).toContainText('ohne RLS');
  await expect(page.locator('#healthValue')).toHaveText('35');
});

test('Ein einzelner Ausreißer erzeugt keinen Alarm, der bestätigte schon', async ({ page }) => {
  const answer = status => ({
    version: 'test', status, health: status === 'critical' ? 35 : 100, coverage: 100,
    checkedAt: new Date().toISOString(), duration_ms: 10,
    results: [{ id: 'kc_core', name: 'KC Core · Supabase', kind: 'database', status, health: status === 'critical' ? 35 : 100, latency: 40, detail: 'Testlauf' }]
  });
  let next = 'healthy';
  await isolate(page, route =>
    route.request().url().includes('/kc-system-check?') && route.request().url().includes('trigger=')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer(next)) })
      : route.abort()
  );
  await page.goto(URL);

  await page.locator('#oneTouchBtn').click();
  await expect(page.locator('#kcAlarmState')).toContainText('Keine bestätigten Alarme');

  next = 'critical';
  await page.locator('#oneTouchBtn').click();
  await expect(page.locator('#kcAlarmState')).toContainText('Keine bestätigten Alarme');

  await page.locator('#oneTouchBtn').click();
  await expect(page.locator('#kcAlarmState')).toContainText('1 bestätigter Alarm');
});

test('Eine neue serverseitige Prüfung ist ab Werk aktiv und läuft mit', async ({ page }) => {
  const serverlauf = {
    checked_at: new Date().toISOString(), overall_status: 'warning', health: 92,
    results: [
      { id: 'kc_core', name: 'KC Core · Supabase', kind: 'database', status: 'healthy', health: 100, latency: 85, detail: 'erreichbar' },
      { id: 'key_lifetime', name: 'Schlüssel-Restlaufzeit', kind: 'security', status: 'healthy', health: 100, latency: null, detail: 'Kein Ablaufdatum' }
    ]
  };
  let laufUrl = '';
  await isolate(page, route => {
    const url = route.request().url();
    if (url.includes('history=1')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ history: [serverlauf], usage: {} }) });
    }
    if (url.includes('/kc-system-check?') && url.includes('trigger=')) {
      laufUrl = url;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'warning', health: 92, coverage: 100, results: serverlauf.results }) });
    }
    return route.abort();
  });
  await page.goto(URL);

  // Der Server kennt eine Prüfung, die die App nicht mitbringt: sie muss in der
  // Auswahl auftauchen und dort ab Werk aktiv sein.
  await page.locator('[data-view="systems"]').click();
  const kasten = page.locator('#systemSelectors input[data-system="key_lifetime"]');
  await expect(kasten).toBeChecked();

  await page.locator('[data-view="dashboard"]').click();
  await page.locator('#oneTouchBtn').click();
  await expect.poll(() => laufUrl).toContain('key_lifetime');
});
