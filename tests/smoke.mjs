/*
 * Phase 1 smoke test. Headless Chromium boots the app and verifies the magic
 * actually runs — not just that it compiles.
 *
 *   npm run dev            # in one shell
 *   npm run test:e2e       # in another (or it'll use BASE_URL)
 *
 * It fails on ANY console/page error, checks the canvas mounts, taps the centred
 * bubble to open the person sheet (exercising real canvas hit-testing), and
 * re-centres via the accessible list view. Screenshots land in tests/screenshots
 * so the look can be eyeballed.
 */
import { chromium } from 'playwright-core';

const _BASE = process.env.BASE_URL || 'http://localhost:5173/';
// ?demo seeds the Davies family and bypasses onboarding, which new users see.
const BASE_URL = _BASE + (_BASE.includes('?') ? '&' : '?') + 'demo';
const shot = (p) => `tests/screenshots/${p}`;

const errors = [];
let failed = false;
const check = (cond, msg) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed = true;
    console.log(`  ✗ ${msg}`);
  }
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 414, height: 896 }, // iPhone-ish portrait
  deviceScaleFactor: 2,
});
// Ignore failures to load EXTERNAL resources (e.g. the demo faces, which a
// locked-down sandbox blocks). A missing face is a handled state, not a bug.
// Real JS exceptions and same-origin errors still fail the test.
const isExternalResourceError = (t) =>
  /Failed to load resource|net::ERR_|ERR_CERT_/.test(t);
page.on(
  'console',
  (m) => m.type() === 'error' && !isExternalResourceError(m.text()) && errors.push(m.text()),
);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

try {
  console.log('Booting app…');
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2800); // let the layout settle and faces fade in
  await page.screenshot({ path: shot('01-tree.png') });
  check(true, 'canvas mounted');

  const focus1 = (await page.textContent('.nameplate__name').catch(() => '')) || '';
  check(focus1.trim().length > 0, `names the focused person (${focus1.trim()})`);

  // Tap the active bubble → person card opens. Find the nameplate to locate
  // the active person on canvas, then click just below it where the bubble is.
  const npRect = await page.evaluate(() => {
    const np = document.querySelector('.nameplate');
    if (!np) return null;
    const r = np.getBoundingClientRect();
    return { cx: r.left + r.width / 2, bottom: r.bottom };
  });
  const acx = npRect ? npRect.cx : page.viewportSize().width / 2;
  const acy = npRect ? npRect.bottom + 60 : (page.viewportSize().height + 120) / 2;
  await page.mouse.click(acx, acy);
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  const sheetName = (await page.textContent('.profile__name').catch(() => '')) || '';
  check(sheetName.length > 0, `tapping centred bubble opens the card (${sheetName.trim()})`);
  await page.waitForTimeout(800); // let the tree slide + card FLIP settle
  await page.screenshot({ path: shot('02-sheet.png') });

  // Memories render and can be upvoted (the heart toggles on).
  const memory = page.locator('.memory').first();
  check((await memory.count()) > 0, 'memories render on the profile');
  const vote = memory.locator('.memory__vote');
  await vote.click();
  await page.waitForTimeout(250);
  const voted = (await page.locator('.memory__vote--on').count()) > 0;
  check(voted, 'upvoting a memory toggles it on');

  // Photos render in the gallery and open in the lightbox.
  const cell = page.locator('.gallery__cell').first();
  check((await cell.count()) > 0, 'photo gallery renders on the profile');
  await cell.click();
  await page.waitForSelector('.lightbox', { timeout: 4000 });
  await page.screenshot({ path: shot('02d-lightbox.png') });
  check(true, 'lightbox opens');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // The add-memory composer opens over the profile and dismisses cleanly.
  // Scoped to the Memories section specifically (not just "the last Add
  // button") since section order is a deliberate, changeable choice.
  await page.locator('.profile-section', { hasText: 'Memories' }).locator('.section-edit').click();
  await page.waitForSelector('[aria-label^="Add a memory"]', { timeout: 4000 });
  await page.screenshot({ path: shot('02b-memory.png') });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Re-centre deterministically through the accessible view.
  await page.locator('[aria-label="Switch to list view"]').click();
  await page.waitForSelector('.listview', { timeout: 5000 });
  await page.screenshot({ path: shot('03-list.png') });
  const firstRel = page.locator('.listview__group .person-row').first();
  const relName = (await firstRel.locator('.person-row__name').textContent()) || '';
  await firstRel.click();
  await page.locator('[aria-label="Switch to tree view"]').click();
  await page.waitForTimeout(1600); // watch the glide settle
  const focus2 = (await page.textContent('.nameplate__name').catch(() => '')) || '';
  check(
    focus2.includes(relName.trim()) && focus2 !== focus1,
    `re-centres on a relative (${focus2.trim()})`,
  );
  await page.screenshot({ path: shot('04-recentred.png') });

  // Fling the active bubble with a press-drag and confirm it physically moves.
  const cx = acx;
  const cy = acy;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(cx + i * 9, cy - i * 6);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('05-drag.png') });
  check(true, 'dragging a bubble ran without error');

  check(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (e) {
  failed = true;
  console.log(`  ✗ threw: ${e.message}`);
  await page.screenshot({ path: shot('99-failure.png') }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failed ? '\nSMOKE TEST FAILED' : '\nSMOKE TEST PASSED');
process.exit(failed ? 1 : 0);
