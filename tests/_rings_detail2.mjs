import { chromium } from 'playwright-core';
const shot = (p) => `tests/screenshots/${p}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 4 });
await page.goto('http://localhost:5173/?demo');
await page.waitForTimeout(3500);
// Wide shot of bottom half where the former couple (JD-RC dashed line) lives
await page.screenshot({ path: shot('rings_former2.png'), clip: { x: 200, y: 440, width: 200, height: 160 } });
await page.screenshot({ path: shot('rings_full_mid.png'), clip: { x: 50, y: 350, width: 320, height: 280 } });
console.log('done');
await browser.close();
