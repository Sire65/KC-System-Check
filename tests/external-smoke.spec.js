import{test,expect}from'@playwright/test';

const URL='http://127.0.0.1:4173/';

test.describe('Mobile 390x844',()=>{
  test.use({viewport:{width:390,height:844}});
  test('mobile shell loads and shows product title',async({page})=>{await page.goto(URL);await expect(page.getByText('KC System Check',{exact:true})).toBeVisible()});
  test('release version is rendered',async({page})=>{await page.goto(URL);await expect(page.locator('#appVersion')).toContainText(/^v\d+\.\d+\.\d+$/)});
  test('healthy hero exposes status and check action',async({page})=>{await page.goto(URL);await expect(page.locator('#healthValue')).toBeVisible();await expect(page.locator('#oneTouchBtn')).toBeVisible()});
  test('four primary gauges are present',async({page})=>{await page.goto(URL);await expect(page.locator('.gauge-card')).toHaveCount(4)});
  test('tabs remain horizontally accessible on mobile',async({page})=>{await page.goto(URL);const tabs=page.locator('.tabs');await expect(tabs).toBeVisible();expect(await tabs.evaluate(el=>el.scrollWidth>=el.clientWidth)).toBeTruthy()});
  test('settings button opens settings modal',async({page})=>{await page.goto(URL);await page.locator('#settingsBtn').click();await expect(page.locator('#settingsModal')).not.toHaveClass(/hidden/)});
});

test.describe('Desktop 1440x900',()=>{
  test.use({viewport:{width:1440,height:900}});
  test('desktop exposes additional overview KPIs',async({page})=>{await page.goto(URL);await expect(page.locator('#kcDesktopOverview')).toBeVisible();await expect(page.locator('.desktop-overview-card')).toHaveCount(5)});
  test('desktop exposes GitHub and mirror hero details',async({page})=>{await page.goto(URL);await expect(page.locator('#kcDesktopHeroExtra')).toBeVisible();await expect(page.locator('.desktop-hero-extra-row')).toHaveCount(2)});
  test('desktop keeps system list and response chart side by side',async({page})=>{await page.goto(URL);const systems=page.locator('#dashboard>.gauges+.card'),chart=page.locator('#dashboard>.gauges+.card+.card');await expect(systems).toBeVisible();await expect(chart).toBeVisible();const a=await systems.boundingBox(),b=await chart.boundingBox();expect(a).toBeTruthy();expect(b).toBeTruthy();expect(Math.abs(a.y-b.y)).toBeLessThan(8);expect(b.x).toBeGreaterThan(a.x+a.width-5)});
  test('desktop workspace uses substantially more horizontal space',async({page})=>{await page.goto(URL);const main=await page.locator('main').boundingBox();expect(main).toBeTruthy();expect(main.width).toBeGreaterThan(1100)});
});
