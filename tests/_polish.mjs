import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5193;
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await pg.goto(`http://localhost:${PORT}/?demo`, { waitUntil: 'load' });
await pg.waitForSelector('canvas');
await pg.waitForTimeout(2800);

// Open profile → see gallery placeholders (external imgs blocked here).
const np = await pg.evaluate(() => {
  const el = document.querySelector('.nameplate');
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform || '');
  return m ? { x: +m[1], y: +m[2] } : null;
});
await pg.mouse.click(np.x, np.y + 60);
await pg.waitForTimeout(1000);
await pg.evaluate(() => { const s = document.querySelector('.profile'); if (s) s.scrollTop = 250; });
await pg.waitForTimeout(700);
await pg.screenshot({ path: 'tests/screenshots/polish-gallery.png' });
const phCount = await pg.locator('.smartimg__ph').count();
await pg.keyboard.press('Escape');
await pg.waitForTimeout(500);

// Settings: open, then Escape should close it.
await pg.locator('[aria-label="Family settings"]').click();
await pg.waitForTimeout(600);
const settingsOpen = await pg.locator('.sheet-scrim').count();
await pg.keyboard.press('Escape');
await pg.waitForTimeout(500);
const settingsClosedAfterEsc = (await pg.locator('.sheet-scrim').count()) === 0;

// Reopen + scrim tap closes.
await pg.locator('[aria-label="Family settings"]').click();
await pg.waitForTimeout(500);
await pg.mouse.click(207, 90); // tap scrim area above sheet
await pg.waitForTimeout(500);
const settingsClosedAfterScrim = (await pg.locator('.sheet-scrim').count()) === 0;

console.log(JSON.stringify({
  galleryPlaceholders: phCount,
  settingsOpened: settingsOpen > 0,
  settingsClosedAfterEsc,
  settingsClosedAfterScrim,
  errors,
}, null, 2));
await br.close();
