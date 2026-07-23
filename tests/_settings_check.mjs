import { chromium } from 'playwright';

const br = await chromium.launch({ headless: true });
const pg = await br.newPage();
await pg.setViewportSize({ width: 390, height: 844 });
await pg.goto('http://localhost:5173/?demo');
await pg.waitForTimeout(2000);

// Open settings via share/avatar button
const btn = pg.locator('.topbar__avatar-btn').first();
if (await btn.isVisible()) {
  await btn.click();
} else {
  await pg.locator('[aria-label="Family settings & sharing"]').click();
}
await pg.waitForTimeout(700);
await pg.screenshot({ path: 'tests/screenshots/settings-panel.png', fullPage: false });

await br.close();
console.log('done');
