import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2.5 });
await page.goto('http://localhost:5173/?demo');
await page.waitForTimeout(3500);
// Full viewport screenshot
await page.screenshot({ path: 'tests/screenshots/junction_wide.png' });
await browser.close();
console.log('done');
