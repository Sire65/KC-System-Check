import { test, expect } from '@playwright/test';
const URL = 'http://127.0.0.1:4173/';

// Produktionsendpunkte werden blockiert: der Test darf keine echten Prüfläufe auslösen.
async function isolate(page, handler) {
  await page.route('**://*.supabase.co/**', handler || (route => route.abort()));
}

test('Ohne erreichbare Prüf-API zeigt der Leitstand kein Grün', async ({ page }) => {
  await isolate(page);
  await page.goto(URL);
  await expect(page.locator('.topbar h1')).toContainText('KC System Check');
  await expect(page.locator('#appVersion')).toHaveText('v0.6.14');
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
