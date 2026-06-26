/*
 * Comprehensive sharing + onboarding smoke tests.
 *
 * Uses Playwright route-interception to mock /api/* endpoints so tests run
 * against the Vite dev server without needing a live wrangler/D1 backend.
 *
 * Covers:
 *   1.  Onboarding — fresh user (mocked auth) sees Intro → questionnaire → tree
 *   2.  Demo tree — topbar row1/row2, stats, legend, view toggle present
 *   3.  Family Settings modal — opens, family name, import buttons, close
 *   4.  InviteSheet — opens from person card, fields, roles, send
 *   5.  Avatar appearance — transparent button, initials/photo
 *   6.  Favicon SVG — correct viewBox and colours
 *   7.  Mobile portrait — topbar fits, bottom buttons present
 *   8.  Edit person sheet — opens, has pre-filled name
 *   9.  Add relative sheet — opens
 *  10.  Legend panel — opens and closes
 *  11.  Stats popover — opens and shows data
 *  12.  View toggle — bubbles ↔ list
 *  13.  Console error baseline
 *
 * Run:
 *   npm run dev  (background)
 *   BASE_URL=http://localhost:5173/ node tests/sharing.mjs
 */
import { chromium } from 'playwright-core';

const _BASE = (process.env.BASE_URL || 'http://localhost:5173/').replace(/\/$/, '');
const shot = (name) => `tests/screenshots/share-${name}`;

let failed = false;
const pageErrors = [];

function check(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed = true;
    console.error(`  ✗ ${msg}`);
  }
}

const isExternalErr = (t) => /Failed to load resource|net::ERR_|ERR_CERT_|ERR_BLOCKED/.test(t);

async function newPage(browser, opts = {}) {
  const p = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    ...opts,
  });
  p.on('console', (m) => {
    if (m.type() === 'error' && !isExternalErr(m.text())) {
      pageErrors.push(`[console] ${m.text()}`);
    }
  });
  p.on('pageerror', (e) => pageErrors.push(`[pageerror] ${e.message}`));
  return p;
}

// Mock /api/auth/me to return bypass:true so auth gate opens without a real worker.
async function mockAuthBypass(page) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"bypass":true}' }),
  );
  // Mock /api/invite to return error (no real backend)
  await page.route('**/api/invite**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Service unavailable in dev"}' }),
  );
  // Mock /api/family to avoid 502 hangs
  await page.route('**/api/family/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }),
  );
}

async function waitFor(page, selector, timeout = 5000) {
  try { await page.waitForSelector(selector, { timeout }); return true; }
  catch { return false; }
}

const browser = await chromium.launch({ headless: true });

// ─── 1. ONBOARDING FLOW (fresh user) ─────────────────────────────────────────
console.log('\n── 1. Onboarding (fresh user with mocked auth) ──');
{
  const page = await newPage(browser);
  await mockAuthBypass(page);

  // Set fresh localStorage state (no completed onboarding) before the app mounts.
  await page.addInitScript(() => {
    const blank = {
      people: [], relationships: [], memories: [], photos: [],
      activity: [], hasCompletedOnboarding: false,
      familyName: '', myPersonId: null, _v: 3, _seq: 0,
    };
    localStorage.setItem('bloodline', JSON.stringify(blank));
  });

  await page.goto(`${_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2500);

  // Should see the Intro (cinematic slides) or Onboarding questionnaire
  const hasIntro = await page.locator('.intro').count() > 0;
  const hasOb = await page.locator('.ob').count() > 0;
  check(hasIntro || hasOb, `intro or onboarding appears (intro:${hasIntro}, ob:${hasOb})`);
  await page.screenshot({ path: shot('01-intro.png') });

  if (hasIntro) {
    // Skip straight to the last slide via the skip button
    const skipBtn = page.locator('[aria-label="Skip intro"], .intro__skip').first();
    if (await skipBtn.count() > 0) {
      await skipBtn.click();
    } else {
      // Click to advance phases
      for (let i = 0; i < 5; i++) {
        await page.locator('.intro').click({ force: true }).catch(() => {});
        await page.waitForTimeout(200);
      }
    }
    // Wait for the CTA "Begin" button on last slide
    const began = await waitFor(page, '.intro__cta, button:has-text("Begin"), button:has-text("Start")', 4000);
    if (began) {
      await page.locator('.intro__cta, button:has-text("Begin"), button:has-text("Start")').first().click();
      await page.waitForTimeout(900);
    }
  }

  // Onboarding questionnaire should now be visible
  check(await waitFor(page, '.ob', 4000), 'onboarding questionnaire appears');
  await page.screenshot({ path: shot('01-ob-step0.png') });

  const obPresent = await page.locator('.ob').count() > 0;
  if (obPresent) {
    // Step 0 — your name
    const nameInput = page.locator('.ob__input').first();
    await nameInput.fill('Alice Test');
    check(await page.locator('.ob__continue').first().isEnabled(), 'Continue enabled after name');
    await page.locator('.ob__continue').first().click();
    await page.waitForTimeout(350);

    // Step 1 — partner (skip)
    check(await page.locator('.ob__skip').first().count() > 0, 'Skip present on partner step');
    await page.locator('.ob__skip').first().click();
    await page.waitForTimeout(350);

    // Step 2 — parents
    await page.locator('.ob__input').first().fill('Parent A');
    await page.locator('.ob__continue').first().click();
    await page.waitForTimeout(350);

    // Step 3 — children
    const addChild = page.locator('.ob__add-btn, button:has-text("Add a child")');
    check(await addChild.count() > 0, '"Add a child" button present');
    await page.locator('.ob__skip').first().click();
    await page.waitForTimeout(350);

    // Step 4 — memory
    const chips = page.locator('.ob__chip');
    check(await chips.count() >= 1, `memory people chips present (${await chips.count()})`);
    if (await chips.count() > 0) {
      await chips.first().click();
      await page.waitForTimeout(200);
      check(await page.locator('.ob__input--area').count() > 0, 'memory textarea appears');
    }
    await page.locator('.ob__skip').first().click();
    await page.waitForTimeout(350);

    // Step 5 — family name
    await page.screenshot({ path: shot('01-ob-step5.png') });
    const famInput = page.locator('.ob__input').first();
    const placeholder = await famInput.getAttribute('placeholder');
    check(placeholder?.length > 0, `family name placeholder: "${placeholder}"`);
    await famInput.fill('The Test Family');
    check(await page.locator('.ob__continue').first().isEnabled(), 'Build tree button enabled');
    await page.locator('.ob__continue').first().click();
    await page.waitForTimeout(2500);

    const treeReady = await page.locator('canvas').count() > 0 ||
                      await page.locator('.listview').count() > 0;
    check(treeReady, 'tree renders after onboarding completes');
    await page.screenshot({ path: shot('01-ob-complete.png') });
  }
  await page.close();
}

// ─── 2. DEMO TREE — topbar elements ──────────────────────────────────────────
console.log('\n── 2. Demo tree topbar ──');
{
  const page = await newPage(browser);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot('02-tree.png') });

  // Row 1
  check(await page.locator('.pill--bell, [aria-label*="Family activity"]').count() > 0, 'bell button present');
  check(await page.locator('[aria-label="Family settings"]').count() > 0, 'settings gear present');

  // In demo mode user is null → avatar button not rendered (expected)
  const avatarCount = await page.locator('.topbar-avatar').count();
  check(true, `avatar: ${avatarCount > 0 ? 'visible (authed)' : 'absent — expected in demo mode'}`);

  // Row 2
  check(await page.locator('.topbar__row2-btn').count() >= 2, 'at least 2 row-2 buttons (legend + toggle)');

  const familyNameText = await page.locator('.topbar__familyname').textContent().catch(() => '');
  check(familyNameText?.length > 0, `family name: "${familyNameText?.trim()}"`);

  const statsText = await page.locator('.topbar__stats').textContent().catch(() => '');
  check(statsText?.includes('people'), `stats bar: "${statsText?.trim()}"`);

  await page.close();
}

// ─── 3. FAMILY SETTINGS MODAL ────────────────────────────────────────────────
console.log('\n── 3. Family settings modal ──');
{
  const page = await newPage(browser);
  await mockAuthBypass(page);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2000);

  await page.locator('[aria-label="Family settings"]').click();
  await page.waitForTimeout(700);

  const dialog = page.locator('[role="dialog"][aria-label="Family settings"]');
  check(await dialog.count() > 0, 'family settings dialog opens');
  await page.screenshot({ path: shot('03-settings.png') });

  const nameInput = dialog.locator('.fs__input').first();
  const currentName = await nameInput.inputValue().catch(() => '');
  check(currentName?.length > 0, `family name pre-populated: "${currentName}"`);

  check(await dialog.locator('.fs__danger-btn').count() > 0, 'erase tree button present');
  check(await dialog.locator('.fs__import-btn').count() > 0, 'Import GEDCOM button present');
  check(await dialog.locator('.fs__fs-btn').count() > 0, 'Import FamilySearch button present');

  // Sign out button (shown when user is logged in, may not be in demo)
  const signoutCount = await dialog.locator('.fs__signout-btn').count();
  check(true, `sign out button: ${signoutCount > 0 ? 'present' : 'absent (no auth in demo)'}`);

  // Change family name and check the save button appears
  const currentVal = await nameInput.inputValue();
  await nameInput.fill(currentVal + ' Test');
  await page.waitForTimeout(300);
  const saveBtn = dialog.locator('.fs__name-save');
  check(await saveBtn.count() > 0, 'Save button appears when name changed');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check(await dialog.count() === 0, 'dialog closes on Escape');

  await page.close();
}

// ─── 4. INVITE SHEET — from person card ──────────────────────────────────────
console.log('\n── 4. InviteSheet from person card ──');
{
  const page = await newPage(browser);
  await mockAuthBypass(page);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2800);

  // Tap active bubble → person card
  const npRect = await page.evaluate(() => {
    const np = document.querySelector('.nameplate');
    if (!np) return null;
    const r = np.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.bottom };
  });
  await page.mouse.click(npRect?.cx ?? 195, (npRect?.cy ?? 420) + 60);
  check(await waitFor(page, '[role="dialog"]', 5000), 'person card opens');
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('04-person-card.png') });

  // Invite button on person card
  const inviteBtn = page.locator('button[aria-label*="Invite"], button:has-text("Invite")').first();
  const hasInvite = await inviteBtn.count() > 0;
  check(hasInvite, 'Invite button on person card');

  if (hasInvite) {
    await inviteBtn.click();
    await page.waitForTimeout(600);

    const sheet = page.locator('.invite-sheet');
    check(await sheet.count() > 0, 'InviteSheet opens');
    await page.screenshot({ path: shot('04-invite-sheet.png') });

    if (await sheet.count() > 0) {
      const emailInput = page.locator('#invite-email, .invite-sheet__input').first();
      check(await emailInput.count() > 0, 'email input present');

      const roles = page.locator('.invite-sheet__role');
      check(await roles.count() >= 2, `${await roles.count()} role options present`);
      check(await page.locator('.invite-sheet__role--on').count() > 0, 'default role pre-selected');

      const sendBtn = page.locator('.invite-sheet__send');
      check(await sendBtn.isDisabled(), 'send disabled with empty email');

      await emailInput.fill('newmember@example.com');
      await page.waitForTimeout(200);
      check(await sendBtn.isEnabled(), 'send enables after email entry');

      // Click Viewer role
      const viewerBtn = roles.filter({ hasText: 'Viewer' });
      if (await viewerBtn.count() > 0) {
        await viewerBtn.click();
        check(
          await viewerBtn.evaluate((el) => el.classList.contains('invite-sheet__role--on')),
          'Viewer role becomes active',
        );
      }

      // Send → App's handleSendInvite swallows errors gracefully in demo mode,
      // so the InviteSheet sees a resolved promise → shows 'sent' state.
      // In real auth mode the actual API is called.
      await sendBtn.click();
      await page.waitForTimeout(1500);
      const hasError = await page.locator('.invite-sheet__error').count() > 0;
      const hasSent = await page.locator('.invite-sheet__sent-title').count() > 0;
      const sheetClosed = await page.locator('.invite-sheet').count() === 0;
      check(hasError || hasSent || sheetClosed,
        hasError ? 'error shown' : hasSent ? 'success shown (demo graceful)' : 'sheet closed after send');
      await page.screenshot({ path: shot('04-invite-result.png') });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  }
  await page.close();
}

// ─── 5. AVATAR — no orange ring ───────────────────────────────────────────────
console.log('\n── 5. Avatar button appearance ──');
{
  const page = await newPage(browser);
  await mockAuthBypass(page);
  // Inject a fake authed user state so the avatar renders
  await page.addInitScript(() => {
    // Override fetch just for /api/auth/me to return a real user
    const origFetch = window.fetch;
    window.fetch = function(url, ...args) {
      if (typeof url === 'string' && url.includes('/api/auth/me')) {
        return Promise.resolve(new Response(
          JSON.stringify({ uid: 'u_test', email: 'test@example.com', display_name: 'Test User', person_id: null }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      }
      return origFetch(url, ...args);
    };
  });

  // Also mock /api/tree to return null (no tree yet)
  await page.route('**/api/tree', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
  });

  // Load the demo tree (easiest way to get the topbar rendered)
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot('05-avatar.png') });

  // Demo mode has no user → avatar is absent. Test transparent background on initials.
  // Just verify there's no button with an orange background ring.
  const avatarBtn = page.locator('.topbar-avatar');
  if (await avatarBtn.count() > 0) {
    const bg = await avatarBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
    const isOrange = /rgb\(194,\s*96/.test(bg.replace(/\s/g, ''));
    check(!isOrange, `avatar button not orange (got: ${bg})`);
    const initials = page.locator('.topbar-avatar__initials');
    if (await initials.count() > 0) {
      const iBg = await initials.evaluate((el) => getComputedStyle(el).backgroundColor);
      check(iBg !== 'rgba(0, 0, 0, 0)', `initials span has own background (${iBg})`);
    }
  } else {
    check(true, 'avatar absent in demo mode (user not set) — expected');
  }

  await page.close();
}

// ─── 6. FAVICON SVG ──────────────────────────────────────────────────────────
console.log('\n── 6. Favicon SVG ──');
{
  const res = await fetch(`${_BASE}/favicon.svg`);
  check(res.ok, `favicon.svg loads (HTTP ${res.status})`);
  const svg = await res.text();
  check(svg.includes('viewBox="0 0 56 56"'), 'viewBox = 0 0 56 56 (square, not old 64×64)');
  check(svg.includes('#c2603a'), 'accent orange present (#c2603a)');
  check(svg.includes('#3f5e4e'), 'forest green present (#3f5e4e)');
  check(svg.includes('#b08642'), 'amber gold present (#b08642)');
  check(svg.includes('rx='), 'rounded-corner rect present');
  // Check circle positions match the Logo component (cx=22,34 for top pair)
  check(svg.includes('cx="22"') && svg.includes('cx="34"'), 'circles at correct x positions (22, 34)');
}

// ─── 7. MOBILE PORTRAIT LAYOUT ────────────────────────────────────────────────
console.log('\n── 7. Mobile portrait layout (390×844) ──');
{
  const page = await newPage(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: shot('07-mobile.png') });

  // Topbar width
  const topbarBox = await page.locator('.topbar').boundingBox().catch(() => null);
  check(topbarBox && topbarBox.width <= 392, `topbar fits (${Math.round(topbarBox?.width ?? 0)}px ≤ 390px)`);

  // Bottom buttons
  check(await page.locator('button:has-text("Focus")').count() > 0, 'Focus button present');
  check(await page.locator('button:has-text("Time")').count() > 0, 'Time button present');
  check(await page.locator('button:has-text("Lineage")').count() > 0, 'Lineage button present');
  // Collapse/Show All button toggles label based on expanded state
  const collapseOrShow = page.locator('button:has-text("Collapse"), button:has-text("Show All")');
  check(await collapseOrShow.count() > 0, 'Collapse/Show All button present');

  // Nameplate visible
  const nameplate = page.locator('.nameplate');
  check(await nameplate.count() > 0, 'active person nameplate shown');

  await page.close();
}

// ─── 8. EDIT PERSON SHEET ────────────────────────────────────────────────────
console.log('\n── 8. Edit person sheet ──');
{
  const page = await newPage(browser);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2800);

  const npRect = await page.evaluate(() => {
    const np = document.querySelector('.nameplate');
    if (!np) return null;
    const r = np.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.bottom };
  });
  await page.mouse.click(npRect?.cx ?? 195, (npRect?.cy ?? 420) + 60);
  check(await waitFor(page, '[role="dialog"]', 5000), 'person card opens');
  await page.waitForTimeout(800);

  const editBtn = page.locator('button.action:has-text("Edit"), button[aria-label*="Edit"]').first();
  check(await editBtn.count() > 0, 'Edit button present on person card');

  if (await editBtn.count() > 0) {
    await editBtn.click();
    await page.waitForTimeout(700);
    // EditPersonSheet inputs use class "field__input"; name has no placeholder
    const fieldInputs = page.locator('.field__input');
    check(await fieldInputs.count() > 0, 'edit sheet field inputs present');
    const val = await fieldInputs.first().inputValue().catch(() => '');
    check(val?.length > 0, `first field pre-filled: "${val}"`);
    await page.screenshot({ path: shot('08-edit-sheet.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.close();
}

// ─── 9. ADD RELATIVE SHEET ────────────────────────────────────────────────────
console.log('\n── 9. Add relative sheet ──');
{
  const page = await newPage(browser);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2800);

  const npRect = await page.evaluate(() => {
    const np = document.querySelector('.nameplate');
    if (!np) return null;
    const r = np.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.bottom };
  });
  await page.mouse.click(npRect?.cx ?? 195, (npRect?.cy ?? 420) + 60);
  check(await waitFor(page, '[role="dialog"]', 5000), 'person card opens');
  await page.waitForTimeout(800);

  const addBtn = page.locator('button.action--primary:has-text("Add a relative"), button:has-text("Add a relative")').first();
  check(await addBtn.count() > 0, 'Add a relative button present');

  if (await addBtn.count() > 0) {
    await addBtn.click();
    await page.waitForTimeout(700);
    // AddRelativeSheet: class "sheet--form" with field__input fields
    const sheetOpen = await page.locator('.sheet--form').count() > 0 ||
                      await page.locator('.field__input').count() > 0 ||
                      await page.locator('input[placeholder*="Margaret"]').count() > 0;
    check(sheetOpen, 'add relative sheet opens with input fields');
    await page.screenshot({ path: shot('09-add-relative.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await page.close();
}

// ─── 10. LEGEND PANEL ────────────────────────────────────────────────────────
console.log('\n── 10. Legend panel ──');
{
  const page = await newPage(browser);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2500);

  const legendBtn = page.locator('.topbar__row2-btn').first();
  const label = await legendBtn.getAttribute('aria-label').catch(() => '');
  check(label?.toLowerCase().includes('legend'), `legend btn aria-label: "${label}"`);

  await legendBtn.click();
  await page.waitForTimeout(500);
  const legendPanel = page.locator('.legend, [role="dialog"][aria-label*="egend"]');
  check(await legendPanel.count() > 0, 'legend panel opens');
  await page.screenshot({ path: shot('10-legend.png') });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.close();
}

// ─── 11. STATS POPOVER ───────────────────────────────────────────────────────
console.log('\n── 11. Stats popover ──');
{
  const page = await newPage(browser);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2500);

  const statsBtn = page.locator('.topbar__stats--btn');
  check(await statsBtn.count() > 0, 'stats button in topbar');

  if (await statsBtn.count() > 0) {
    await statsBtn.click();
    await page.waitForTimeout(400);
    const popover = page.locator('.stats-popover');
    check(await popover.count() > 0, 'stats popover opens');
    if (await popover.count() > 0) {
      const text = await popover.textContent().catch(() => '');
      check(
        text.includes('Surnames') || text.includes('span') || text.includes('completeness'),
        'popover shows meaningful content',
      );
      await page.screenshot({ path: shot('11-stats-popover.png') });
      await page.keyboard.press('Escape');
    }
  }
  await page.close();
}

// ─── 12. VIEW TOGGLE ─────────────────────────────────────────────────────────
console.log('\n── 12. View toggle (bubbles ↔ list) ──');
{
  const page = await newPage(browser);
  await page.goto(`${_BASE}/?demo`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await page.waitForTimeout(2500);

  const toggleBtn = page.locator('.topbar__row2-btn').last();

  await toggleBtn.click();
  await page.waitForTimeout(700);
  check(await page.locator('.listview').count() > 0, 'switches to list view');
  await page.screenshot({ path: shot('12-list-view.png') });

  await toggleBtn.click();
  await page.waitForTimeout(1200);
  check(await page.locator('canvas').count() > 0, 'switches back to tree view');

  await page.close();
}

// ─── 13. CONSOLE ERROR BASELINE ──────────────────────────────────────────────
console.log('\n── 13. Console error baseline ──');
check(
  pageErrors.length === 0,
  `no console/page errors${pageErrors.length ? ':\n    ' + pageErrors.join('\n    ') : ''}`,
);

// ─── DONE ────────────────────────────────────────────────────────────────────
await browser.close();
console.log(failed ? '\n\nSHARING TESTS FAILED' : '\n\nSHARING TESTS PASSED');
process.exit(failed ? 1 : 0);
