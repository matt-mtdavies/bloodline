import { chromium } from 'playwright-core';
const br = await chromium.launch({ headless: true });
const pg = await br.newPage();
await pg.setViewportSize({ width: 390, height: 844 });
await pg.goto('http://localhost:5176/?demo');
await pg.waitForTimeout(2500);
await pg.screenshot({ path: 'tests/screenshots/topbar-check.png', clip: { x: 0, y: 0, width: 390, height: 140 } });
await br.close();
console.log('done');
