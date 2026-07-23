import { chromium } from 'playwright';
const PORT = process.env.PORT || 5191;
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
await pg.goto(`http://localhost:${PORT}/?demo`, { waitUntil: 'load' });
await pg.waitForSelector('canvas');
await pg.waitForTimeout(3000);
await pg.screenshot({ path: 'tests/screenshots/cam-00-initial.png' });

// Pan: drag empty space (top-left area, away from bubbles) up-left and release.
async function dragPath(x0, y0, dx, dy, steps = 14) {
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await pg.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await pg.waitForTimeout(12);
  }
  await pg.mouse.up();
}
// drag from empty upper area downward (should move tree down)
await dragPath(207, 250, 0, 220);
await pg.waitForTimeout(120);
await pg.screenshot({ path: 'tests/screenshots/cam-01-during-after-pan.png' });
await pg.waitForTimeout(1200);
await pg.screenshot({ path: 'tests/screenshots/cam-02-settled-after-pan.png' });

await br.close();
console.log('probe done');
