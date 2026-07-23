import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
// Intercept /api/auth/me to return bypass so we get to the intro
await page.route('**/api/auth/me', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bypass: true }) })
);
await page.goto('http://localhost:5173/');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'tests/screenshots/intro-p0.png' });
await page.waitForTimeout(3500);
await page.screenshot({ path: 'tests/screenshots/intro-p1.png' });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tests/screenshots/intro-p1b.png' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'tests/screenshots/intro-p2.png' });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'tests/screenshots/intro-p3.png' });
await page.waitForTimeout(4200);
await page.screenshot({ path: 'tests/screenshots/intro-p4.png' });
await browser.close();
