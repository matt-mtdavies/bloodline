/*
 * Phase 1 smoke test. Headless Chromium (default) or WebKit boots the app and
 * verifies the magic actually runs — not just that it compiles.
 *
 *   npm run dev                  # in one shell
 *   npm run test:e2e             # in another (or it'll use BASE_URL) — Chromium
 *   npm run test:e2e:webkit      # same test, against WebKit instead
 *
 * WebKit is the same engine family as Safari/iOS — closer to catching engine-
 * specific rendering bugs (e.g. backdrop-filter under an overflow-clipped
 * ancestor) than Chromium alone, though it's Playwright's own Linux-built
 * WebKit, not Apple's actual Safari — a good proxy for CSS/rendering bugs, not
 * a substitute for a real-device check on anything iOS-specific (PWA/
 * standalone-mode behavior, safe-area insets, momentum scroll). Requires
 * `npm run browser:install:webkit` once (separate from the default
 * `browser:install`, since not every environment can download it — see
 * BROWSER_ENGINES below for the friendly error if it's missing).
 *
 * It fails on ANY console/page error, checks the canvas mounts, taps the centred
 * bubble to open the person sheet (exercising real canvas hit-testing), and
 * re-centres via the accessible list view. Screenshots land in tests/screenshots
 * so the look can be eyeballed.
 */
import { chromium, webkit } from 'playwright';

const BROWSER_ENGINES = { chromium, webkit };
const BROWSER_NAME = process.env.BROWSER || 'chromium';
const engine = BROWSER_ENGINES[BROWSER_NAME];
if (!engine) {
  console.error(`Unknown BROWSER "${BROWSER_NAME}" — expected one of: ${Object.keys(BROWSER_ENGINES).join(', ')}`);
  process.exit(1);
}

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

const browser = await engine.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 414, height: 896 }, // iPhone-ish portrait
  deviceScaleFactor: 2,
});
// Ignore failures to load EXTERNAL resources (e.g. the demo faces, which a
// locked-down sandbox blocks). A missing face is a handled state, not a bug.
// Real JS exceptions and same-origin errors still fail the test.
//
// Chromium and WebKit report the identical blocked-image situation with
// completely different console text — confirmed against a real CI run:
// Chromium says "Failed to load resource"/"net::ERR_...", WebKit instead
// says "Origin ... is not allowed by Access-Control-Allow-Origin" / "due to
// access control checks". Both patterns are matched so this filter behaves
// the same across engines rather than only ever having been tuned for one.
const isExternalResourceError = (t) =>
  /Failed to load resource|net::ERR_|ERR_CERT_|Access-Control-Allow-Origin|access control checks/.test(t);
page.on(
  'console',
  (m) => m.type() === 'error' && !isExternalResourceError(m.text()) && errors.push(m.text()),
);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

try {
  console.log(`Booting app… (${BROWSER_NAME})`);
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2800); // let the layout settle and faces fade in
  await page.screenshot({ path: shot('01-tree.png') });
  check(true, 'canvas mounted');

  const focus1 = (await page.textContent('.nameplate__name').catch(() => '')) || '';
  check(focus1.trim().length > 0, `names the focused person (${focus1.trim()})`);

  // Tap the active bubble → person card opens. Find the nameplate to locate
  // the active person on canvas, then click just below it where the bubble is.
  // Poll for `.nameplate` rather than a one-shot query: it can be mid-render
  // (it's driven by the same camera-settle animation as the initial 2.8s wait
  // above), and a one-shot miss used to silently fall back to a fixed
  // viewport-center guess — which can land on empty canvas between bubbles
  // and click nothing at all. A captured CI failure screenshot from the real
  // WebKit flake this guards against showed exactly that: the full tree
  // rendered, every face loaded, but no `.nameplate` pill visible above any
  // bubble and no dialog — consistent with both the original and retry click
  // landing on empty space rather than a face, not a slow dialog.
  const findNameplateRect = async () => {
    try {
      await page.waitForSelector('.nameplate', { timeout: 5000 });
    } catch {
      console.log('  ! .nameplate never appeared — falling back to a viewport-center guess for the click');
      return null;
    }
    return page.evaluate(() => {
      const np = document.querySelector('.nameplate');
      if (!np) return null;
      const r = np.getBoundingClientRect();
      return { cx: r.left + r.width / 2, bottom: r.bottom };
    });
  };
  // Real production crash (React error #310, "Rendered more hooks than
  // during the previous render"): HoverCard.jsx stays mounted for the whole
  // session with `personId` toggling between an id and null as the mouse
  // moves — a `useLayoutEffect` textually after an `if (!person) return
  // null` guard meant the hook was skipped on a null-person render and
  // called on the next truthy-person render, a hooks-order violation. Only
  // reproduces on a genuine hover TRANSITION (empty → bubble → empty →
  // bubble), not a single hover, so this exercises that exact sequence.
  const hoverRect = await findNameplateRect();
  if (hoverRect) {
    const hx = hoverRect.cx, hy = hoverRect.bottom + 60;
    await page.mouse.move(20, 20); // empty canvas — HoverCard's person is null
    await page.waitForTimeout(200);
    await page.mouse.move(hx, hy); // onto the active bubble — person becomes truthy
    await page.waitForTimeout(200);
    await page.mouse.move(20, 20); // off again
    await page.waitForTimeout(200);
    await page.mouse.move(hx, hy); // and back — the transition that used to crash
    await page.waitForTimeout(300);
  }
  check(errors.length === 0, 'hover transition (empty → bubble → empty → bubble) causes no console/page errors');

  const clickAtNameplate = async () => {
    const npRect = await findNameplateRect();
    const cx = npRect ? npRect.cx : page.viewportSize().width / 2;
    const cy = npRect ? npRect.bottom + 60 : (page.viewportSize().height + 120) / 2;
    await page.mouse.click(cx, cy);
    return { cx, cy };
  };
  // Real CI flake, seen a few times on WebKit specifically (never on
  // Chromium): the dialog occasionally doesn't appear within the original 5s
  // window, even though "canvas mounted" and "names the focused person" both
  // just succeeded. This guards against both a slow first render and a
  // missed/mistargeted click: a more generous wait, and if that's still not
  // enough, one retry tap — re-resolving the nameplate rect fresh rather than
  // reusing the first attempt's (possibly wrong) coordinates.
  let { cx: acx, cy: acy } = await clickAtNameplate();
  try {
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  } catch {
    ({ cx: acx, cy: acy } = await clickAtNameplate());
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  }
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

  // Re-centre deterministically through the accessible view. View mode lives
  // behind a small menu now (Tree/Chart/List), not a direct toggle button.
  await page.locator('[aria-label="Change how the family is shown"]').click();
  await page.locator('.viewmode-popover__option', { has: page.locator('.viewmode-popover__label', { hasText: 'List' }) }).click();
  await page.waitForSelector('.listview', { timeout: 5000 });
  await page.screenshot({ path: shot('03-list.png') });
  const firstRel = page.locator('.listview__group .person-row').first();
  const relName = (await firstRel.locator('.person-row__name').textContent()) || '';
  await firstRel.click();
  await page.locator('[aria-label="Change how the family is shown"]').click();
  await page.locator('.viewmode-popover__option', { has: page.locator('.viewmode-popover__label', { hasText: 'Tree' }) }).click();
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
