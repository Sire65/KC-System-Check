import{test,expect}from'@playwright/test';

const URL='http://127.0.0.1:4173/';

async function withPage(browser,viewport,fn){const context=await browser.newContext({viewport});const page=await context.newPage();try{await fn(page)}finally{await context.close()}}

async function expectOneTouchReaction(page){await page.locator('#oneTouchBtn').click();await expect(page.locator('#progressCard')).not.toHaveClass(/hidden/);await expect(page.locator('#currentStep')).not.toHaveText('',{timeout:15000});}

test('Mobile 390x844 shell, One Touch and settings',async({browser})=>withPage(browser,{width:390,height:844},async page=>{await page.goto(URL);await page.waitForLoadState('domcontentloaded');await expect(page.locator('.topbar h1')).toContainText('KC System Check');await expect(page.locator('#appVersion')).toContainText(/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,{timeout:15000});await expect(page.locator('#healthValue')).toBeVisible();await expect(page.locator('#oneTouchBtn')).toBeVisible();await expect(page.locator('.gauge-card')).toHaveCount(4);await expectOneTouchReaction(page);const tabs=page.locator('.tabs');await expect(tabs).toBeVisible();expect(await tabs.evaluate(el=>el.scrollWidth>=el.clientWidth)).toBeTruthy();await page.locator('#settingsBtn').click();await expect(page.locator('#settingsModal')).not.toHaveClass(/hidden/);await expect(page.locator('#kcServerAlarmSettings')).toBeVisible()}));

test('Desktop 1440x900 shell',async({browser})=>withPage(browser,{width:1440,height:900},async page=>{await page.goto(URL);await expect(page.locator('#kcDesktopOverview')).toBeAttached({timeout:15000});expect(await page.evaluate(()=>window.innerWidth)).toBe(1440);await expect(page.locator('#kcDesktopOverview')).toBeVisible();await expect(page.locator('.desktop-overview-card')).toHaveCount(5,{timeout:15000})}));

test('Desktop 1440x900 hero container',async({browser})=>withPage(browser,{width:1440,height:900},async page=>{const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(URL);await expect(page.locator('#kcDesktopHeroExtra')).toBeAttached({timeout:15000});expect(errors).toEqual([])}));

test('Desktop 1440x900 hero rows',async({browser})=>withPage(browser,{width:1440,height:900},async page=>{await page.goto(URL);await expect(page.locator('.desktop-hero-extra-row')).toHaveCount(2,{timeout:15000})}));

test('Desktop 1440x900 geometry',async({browser})=>withPage(browser,{width:1440,height:900},async page=>{await page.goto(URL);const systems=page.locator('#dashboard>.gauges+.card'),chart=page.locator('#dashboard>.gauges+.card+.card');await expect(systems).toBeVisible({timeout:15000});await expect(chart).toBeVisible({timeout:15000});const a=await systems.boundingBox(),b=await chart.boundingBox(),main=await page.locator('main').boundingBox();expect(a).toBeTruthy();expect(b).toBeTruthy();expect(main).toBeTruthy();expect(Math.abs(a.y-b.y)).toBeLessThan(16);expect(b.x).toBeGreaterThan(a.x+a.width-12);expect(main.width).toBeGreaterThanOrEqual(960)}));

test('Desktop 1440x900 One Touch reacts',async({browser})=>withPage(browser,{width:1440,height:900},async page=>{await page.goto(URL);await expect(page.locator('#kcDesktopOverview')).toBeAttached({timeout:15000});await expectOneTouchReaction(page)}));
