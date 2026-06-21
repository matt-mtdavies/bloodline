import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto('http://localhost:5173/?demo');
await page.waitForTimeout(3500);
await page.screenshot({ path: 'tests/screenshots/junction_after.png', clip: { x: 30, y: 220, width: 330, height: 400 } });
await browser.close();
console.log('done');
