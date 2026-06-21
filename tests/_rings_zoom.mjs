import { chromium } from 'playwright-core';
const shot = (p) => `tests/screenshots/${p}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 3 });
await page.goto('http://localhost:5173/?demo');
await page.waitForTimeout(3500);
// Crop to the center area where the tree is
await page.screenshot({ path: shot('rings_zoom.png'), clip: { x: 0, y: 160, width: 414, height: 400 } });
console.log('done');
await browser.close();
