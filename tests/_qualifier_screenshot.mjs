import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.route('**/api/auth/me', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bypass: true }) })
);

await page.goto('http://localhost:5173/?demo');
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(2500);

// Click JD bubble to open profile
await page.click('canvas', { position: { x: 220, y: 470 } });
await page.waitForTimeout(1500);

// Click "Add a relative"
await page.getByRole('button', { name: 'Add a relative' }).click();
await page.waitForSelector('.chipgrid', { timeout: 5000 });
await page.waitForTimeout(400);

// Click "Son" to show the qualifier row
await page.getByRole('radio', { name: 'Son' }).click();
await page.waitForTimeout(400);

await page.screenshot({ path: 'tests/screenshots/qualifier-spacing.png' });
await browser.close();
console.log('done');
