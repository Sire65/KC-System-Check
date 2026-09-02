import{test,expect}from'@playwright/test';

test.use({viewport:{width:390,height:844}});

test('mobile shell loads and shows product title',async({page})=>{await page.goto('http://127.0.0.1:4173/');await expect(page.getByText('KC System Check',{exact:true})).toBeVisible()});
test('release version is rendered',async({page})=>{await page.goto('http://127.0.0.1:4173/');await expect(page.locator('#appVersion')).toContainText(/^v\d+\.\d+\.\d+$/)});
test('healthy hero exposes status and check action',async({page})=>{await page.goto('http://127.0.0.1:4173/');await expect(page.locator('#healthValue')).toBeVisible();await expect(page.locator('#oneTouchBtn')).toBeVisible()});
test('four primary gauges are present',async({page})=>{await page.goto('http://127.0.0.1:4173/');await expect(page.locator('.gauge-card')).toHaveCount(4)});
test('tabs remain horizontally accessible on mobile',async({page})=>{await page.goto('http://127.0.0.1:4173/');const tabs=page.locator('.tabs');await expect(tabs).toBeVisible();expect(await tabs.evaluate(el=>el.scrollWidth>=el.clientWidth)).toBeTruthy()});
test('settings button opens settings modal',async({page})=>{await page.goto('http://127.0.0.1:4173/');await page.locator('#settingsBtn').click();await expect(page.locator('#settingsModal')).not.toHaveClass(/hidden/)});
