import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5191;
const br = await chromium.launch({ headless: true });
const pg = await br.newPage({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 });
const errors = [];
pg.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text()) && errors.push(m.text()));

await pg.goto(`http://localhost:${PORT}/?demo`, { waitUntil: 'load' });
await pg.waitForSelector('canvas');
await pg.waitForTimeout(2800);

// Measure the active nameplate screen position (proxy for where the tree sits).
const namePos = async () => pg.evaluate(() => {
  const el = document.querySelector('.nameplate');
  if (!el) return null;
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el.style.transform || '');
  return m ? { x: +m[1], y: +m[2] } : null;
});

const p0 = await namePos();
await pg.screenshot({ path: 'tests/screenshots/stress-00.png' });

// 1) PAN AND STAY: drag empty space far down-right, release without flick.
async function drag(x0, y0, dx, dy, steps, settle = 0) {
  await pg.mouse.move(x0, y0);
  await pg.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await pg.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await pg.waitForTimeout(10);
  }
  if (settle) await pg.waitForTimeout(settle); // hold still before release = no inertia
  await pg.mouse.up();
}
await drag(207, 230, 120, 160, 16, 140);
await pg.waitForTimeout(900);
const p1 = await namePos();
await pg.screenshot({ path: 'tests/screenshots/stress-01-panned.png' });

// 2) RECENTER button should now be visible; click it.
const recenterVisible = await pg.evaluate(() => {
  const b = document.querySelector('.recenter-btn');
  return b ? getComputedStyle(b).opacity : 'no-btn';
});
await pg.locator('.recenter-btn').click({ force: true });
await pg.waitForTimeout(1100);
const p2 = await namePos();
await pg.screenshot({ path: 'tests/screenshots/stress-02-recentered.png' });

// 3) DOUBLE-TAP empty to recenter after another pan.
await drag(207, 230, -130, 120, 16, 140);
await pg.waitForTimeout(700);
const p3 = await namePos();
await pg.mouse.dblclick(320, 240);
await pg.waitForTimeout(1100);
const p4 = await namePos();

// 4) WHEEL ZOOM around a point.
await pg.mouse.move(207, 448);
await pg.mouse.wheel(0, -400); // zoom in
await pg.waitForTimeout(600);
await pg.screenshot({ path: 'tests/screenshots/stress-04-zoomed.png' });
await pg.mouse.wheel(0, 800); // zoom back out
await pg.waitForTimeout(600);

console.log(JSON.stringify({
  initial: p0,
  afterPan: p1,
  panMovedBy: p0 && p1 ? { dx: +(p1.x - p0.x).toFixed(0), dy: +(p1.y - p0.y).toFixed(0) } : null,
  recenterOpacity: recenterVisible,
  afterRecenter: p2,
  recenterReturned: p0 && p2 ? (Math.abs(p2.x - p0.x) < 30 && Math.abs(p2.y - p0.y) < 30) : null,
  afterPan2: p3,
  afterDblTapRecenter: p4,
  dblTapReturned: p0 && p4 ? (Math.abs(p4.x - p0.x) < 40 && Math.abs(p4.y - p0.y) < 40) : null,
  errors,
}, null, 2));
await br.close();
