import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto('http://localhost:5173/?demo');
await page.waitForTimeout(3000);
// Tree view — check topbar
await page.screenshot({ path: 'tests/screenshots/topbar_tree.png', clip: { x: 0, y: 0, width: 390, height: 200 } });
// Switch to list view
await page.click('button.pill--label');
await page.waitForTimeout(600);
await page.screenshot({ path: 'tests/screenshots/topbar_list.png', clip: { x: 0, y: 0, width: 390, height: 320 } });
console.log('done');
await browser.close();
