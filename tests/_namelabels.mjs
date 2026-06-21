import { chromium } from 'playwright-core';
const br = await chromium.launch({ headless: true });
const pg = await br.newPage();
await pg.setViewportSize({ width: 390, height: 844 });
await pg.goto('http://localhost:5173/?demo');
await pg.waitForTimeout(3500); // let physics + labels settle
await pg.screenshot({ path: 'tests/screenshots/name-labels.png' });
await br.close();
console.log('done');
