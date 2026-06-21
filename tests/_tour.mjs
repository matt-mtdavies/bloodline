import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5192;
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
await pg.goto(`http://localhost:${PORT}/?demo`, { waitUntil: 'load' });
await pg.waitForSelector('canvas');
await pg.waitForTimeout(2800);
const S = (n) => `tests/screenshots/tour-${n}.png`;

// Profile sheet — tap the active bubble.
const np = await pg.evaluate(() => {
  const el = document.querySelector('.nameplate');
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform || '');
  return m ? { x: +m[1], y: +m[2] } : null;
});
await pg.mouse.click(np.x, np.y + 60);
await pg.waitForTimeout(1100);
await pg.screenshot({ path: S('01-profile-top') });
// scroll the profile
await pg.evaluate(() => { const s = document.querySelector('.sheet, .profile, [role=dialog]'); if (s) s.scrollTop = 380; });
await pg.waitForTimeout(400);
await pg.screenshot({ path: S('02-profile-mid') });
await pg.keyboard.press('Escape');
await pg.waitForTimeout(500);

// Legend
await pg.locator('[aria-label^="Legend"]').click();
await pg.waitForTimeout(700);
await pg.screenshot({ path: S('03-legend') });
await pg.keyboard.press('Escape');
await pg.waitForTimeout(400);

// Settings
await pg.locator('[aria-label="Family settings"]').click();
await pg.waitForTimeout(700);
await pg.screenshot({ path: S('04-settings') });
await pg.keyboard.press('Escape');
await pg.waitForTimeout(400);

// List view
await pg.locator('[aria-label="Switch to list view"]').click();
await pg.waitForTimeout(700);
await pg.screenshot({ path: S('05-list') });

await br.close();
console.log('tour done');
