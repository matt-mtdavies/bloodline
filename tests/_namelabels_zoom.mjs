import { chromium } from 'playwright-core';
const br = await chromium.launch({ headless: true });
const pg = await br.newPage();
await pg.setViewportSize({ width: 390, height: 844 });
await pg.goto('http://localhost:5173/?demo');
await pg.waitForTimeout(3500);
// Crop to just the tree area around the focus
await pg.screenshot({ path: 'tests/screenshots/name-labels-zoom.png', clip: { x: 0, y: 280, width: 390, height: 420 } });
await br.close();
console.log('done');
