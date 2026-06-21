import { chromium } from 'playwright-core';
const shot = (p) => `tests/screenshots/${p}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 4 });
await page.goto('http://localhost:5173/?demo');
await page.waitForTimeout(3500);
// Tight crop around the current couple connector (top left area)
await page.screenshot({ path: shot('rings_current.png'), clip: { x: 60, y: 270, width: 200, height: 130 } });
// Tight crop around the former couple connector (mid-right)  
await page.screenshot({ path: shot('rings_former.png'), clip: { x: 230, y: 380, width: 200, height: 120 } });
console.log('done');
await browser.close();
