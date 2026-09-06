import { test, expect } from '@playwright/test';

const URL = 'http://127.0.0.1:4173/';
const LEITSTAND = {
  checked_at: new Date().toISOString(),
  heartbeats: [], flows: [], apps: [], communication: {}, backup: {},
  sales: [{ event_id: 'e1', register_id: 'Kasse 1', event_type: 'sale', amount_cents: 1990, occurred_at: new Date().toISOString() }],
  thresholds: {}
};

async function withApi(page, handler) {
  await page.route('**://*.supabase.co/**', handler);
}

test('Ohne Anmeldung bleibt der LIVE-Leitstand verschlossen', async ({ page }) => {
  let leitstandCalls = 0;
  await withApi(page, route => {
    if (route.request().url().includes('leitstand=1')) leitstandCalls++;
    return route.abort();
  });
  await page.goto(URL);
  await page.locator('[data-view="live"]').click();
  await expect(page.locator('#kcLiveGate')).toBeVisible();
  await expect(page.locator('#liveSales')).toBeHidden();
  // Ohne Anmeldung darf gar nicht erst gefragt werden.
  expect(leitstandCalls).toBe(0);
});

test('Ein nicht freigeschaltetes Konto sieht die Begründung des Servers', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kc-system-check-admin-jwt', 'test-token'));
  await withApi(page, route =>
    route.request().url().includes('leitstand=1')
      ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'leitstand_gesperrt', reason: 'kein_leitstand_zugang', hint: 'Konto ist nicht freigeschaltet.' }) })
      : route.abort()
  );
  await page.goto(URL);
  await page.locator('[data-view="live"]').click();
  await expect(page.locator('#kcLiveGate')).toBeVisible();
  await expect(page.locator('#kcLiveGateText')).toContainText('nicht freigeschaltet');
});

test('Angemeldet wird der Leitstand sichtbar, die Nutzeranmeldung wird mitgesendet', async ({ page }) => {
  let sentAuth = '';
  await page.addInitScript(() => sessionStorage.setItem('kc-system-check-admin-jwt', 'test-token'));
  await withApi(page, route => {
    const request = route.request();
    if (request.url().includes('leitstand=1')) {
      sentAuth = request.headers()['authorization'] || '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LEITSTAND) });
    }
    return route.abort();
  });
  await page.goto(URL);
  await page.locator('[data-view="live"]').click();
  await expect(page.locator('#kcLiveGate')).toBeHidden();
  await expect(page.locator('#liveSales')).toContainText('Kasse 1');
  expect(sentAuth).toBe('Bearer test-token');
});

test('Die Technik-Rolle sieht keine Kassenereignisse', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('kc-system-check-admin-jwt', 'test-token'));
  await withApi(page, route =>
    route.request().url().includes('leitstand=1')
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...LEITSTAND, sales: [], sales_hidden: true, viewer: { role: 'technik' } }) })
      : route.abort()
  );
  await page.goto(URL);
  await page.locator('[data-view="live"]').click();
  await expect(page.locator('#liveSales')).toContainText('Technik-Sicht aktiv');
  await expect(page.locator('#liveSales')).not.toContainText('19,90');
});
