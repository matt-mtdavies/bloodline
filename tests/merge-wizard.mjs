/*
 * Merge Wizard frontend test.
 *
 * Mocks all API calls so the test runs without a real Cloudflare D1 backend.
 * Exercises every wizard step:
 *   loading → intro → match (toggle) → confirm → merging → done
 * Also tests: join-only path, expired-invite error, and POST-failure recovery.
 *
 *   npm run dev           # start first (picks port 5173)
 *   BASE_URL=http://localhost:5173/ node tests/merge-wizard.mjs
 */
import { chromium } from 'playwright';

const _BASE = process.env.BASE_URL || 'http://localhost:5173/';
const BASE = _BASE.replace(/\?.*$/, '').replace(/\/$/, '');

const MY_TREE = {
  hasCompletedOnboarding: true,
  familyName: 'My Family',
  myPersonId: 'p_me',
  people: [
    { id: 'p_me', display_name: 'Matt Davies', gender: 'male', birth_date: '1985-04-12' },
    { id: 'p_mum', display_name: 'Janet Davies', gender: 'female' },
  ],
  relationships: [
    { id: 'r_1', type: 'parent', from_person: 'p_mum', to_person: 'p_me' },
  ],
  memories: [
    { id: 'm_1', person_id: 'p_me', text: 'Summer holiday 1995', votes: 2 },
  ],
  photos: [
    { id: 'ph_1', person_id: 'p_me', src: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' },
  ],
  documents: [],
};

// Target family — includes a near-duplicate of Matt Davies so the matcher fires.
const THEIR_TREE = {
  hasCompletedOnboarding: true,
  familyName: 'The Smiths',
  people: [
    { id: 'p_t1', display_name: 'John Smith', gender: 'male', birth_date: '1982-09-01' },
    { id: 'p_t2', display_name: 'Matt Davies', gender: 'male', birth_date: '1985-03-30' },
  ],
  relationships: [],
  memories: [],
  photos: [],
  documents: [],
};

const MERGE_GET_RESPONSE = {
  familyId: 'f_target',
  familyName: 'The Smiths',
  role: 'editor',
  fromEmail: 'john.smith@example.com',
  tree: THEIR_TREE,
};

const shot = (p) => `tests/screenshots/mw-${p}`;
let failed = false;
const errors = [];

const check = (cond, msg) => {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed = true;
    console.error(`  ✗ ${msg}`);
  }
};

async function runScenario(label, { inviteToken, mergeGetResponse, mergePostResponse, scenario }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
  });

  const isExternalResourceError = (t) => /Failed to load resource|net::ERR_|ERR_CERT_/.test(t);
  page.on('console', (m) => {
    if (m.type() === 'error' && !isExternalResourceError(m.text())) {
      errors.push(`[${label}] ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));

  // Mock auth — return a real user (not bypass), which puts authState → 'authed'.
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uid: 'u_testuser', email: 'test@example.com' }),
    }),
  );

  // Mock tree GET — returns a tree with people so the merge gate fires.
  await page.route((url) => url.href.includes('/api/tree'), async (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MY_TREE),
      });
    } else if (route.request().method() === 'PUT') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    } else {
      route.continue();
    }
  });

  // Mock /api/merge — GET and POST handled separately by method check.
  await page.route((url) => url.href.includes('/api/merge'), (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: mergeGetResponse?.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(mergeGetResponse?.body ?? MERGE_GET_RESPONSE),
      });
    } else if (route.request().method() === 'POST') {
      route.fulfill({
        status: mergePostResponse?.status || 200,
        contentType: 'application/json',
        body: JSON.stringify(mergePostResponse?.body ?? { ok: true, familyId: 'f_target' }),
      });
    } else {
      route.continue();
    }
  });

  try {
    await scenario(page, label);
  } catch (e) {
    failed = true;
    console.error(`  ✗ [${label}] threw: ${e.message}`);
    await page.screenshot({ path: shot(`99-failure-${label}.png`) }).catch(() => {});
  } finally {
    await browser.close();
  }
}

// ── Scenario 1: Full merge flow (match → confirm → done) ─────────────────────

console.log('\n── Scenario 1: full merge flow ──────────────────────────────────────────');

await runScenario('full-merge', {
  inviteToken: 'tok_test',
  scenario: async (page, label) => {
    // Clear localStorage so no stale demo data interferes.
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.clear());

    // Navigate with pending_invite in the URL — no ?demo flag.
    await page.goto(`${BASE}/?pending_invite=tok_test`, { waitUntil: 'load', timeout: 20000 });

    // Loading spinner should appear first.
    await page.waitForSelector('.mw__spinner', { timeout: 8000 });
    check(true, `[${label}] loading spinner shown`);

    // Then intro step.
    await page.waitForSelector('.mw__title', { timeout: 8000 });
    const introTitle = await page.textContent('.mw__title');
    check(introTitle?.includes('Two trees'), `[${label}] intro step rendered (title: "${introTitle?.trim()}")`);
    await page.screenshot({ path: shot('01-intro.png') });

    // Tree counts show correct numbers.
    const counts = await page.$$eval('.mw__tree-count', (els) => els.map((e) => e.textContent?.trim()));
    check(counts[0] === '2', `[${label}] my tree count = 2 (got "${counts[0]}")`);
    check(counts[1] === '2', `[${label}] their tree count = 2 (got "${counts[1]}")`);

    // "Review and merge" → match step.
    await page.locator('button', { hasText: 'Review and merge' }).click();
    await page.waitForSelector('.mw__matches', { timeout: 5000 });
    const matchTitle = await page.textContent('.mw__title');
    check(matchTitle?.includes('same person'), `[${label}] match step title (got "${matchTitle?.trim()}")`);
    await page.screenshot({ path: shot('02-match.png') });

    // Should find 1 suggested match (Matt Davies ↔ Matt Davies with close birth date).
    const matchRows = await page.$$('.mw__match');
    check(matchRows.length === 1, `[${label}] 1 suggested match found (got ${matchRows.length})`);

    // Toggle the match off then on again.
    const toggleBtn = page.locator('.mw__match-toggle');
    const beforeText = await toggleBtn.textContent();
    check(beforeText?.includes('Same'), `[${label}] match starts as "Same" (score ≥ 0.9)`);
    await toggleBtn.click();
    const afterOff = await toggleBtn.textContent();
    check(afterOff?.includes('Different'), `[${label}] toggle → "Different"`);
    await toggleBtn.click();
    const afterOn = await toggleBtn.textContent();
    check(afterOn?.includes('Same'), `[${label}] toggle → "Same" again`);
    await page.screenshot({ path: shot('02b-match-toggled.png') });

    // Janet Davies (only in mine) should appear in the "also adding" section.
    const chips = await page.$$('.mw__chip');
    const chipNames = await Promise.all(chips.map((c) => c.textContent()));
    check(chipNames.some((n) => n?.includes('Janet')), `[${label}] Janet Davies chip shown as addition (got: ${chipNames.join(', ')})`);

    // Back → intro.
    await page.locator('button', { hasText: 'Back' }).click();
    await page.waitForSelector('button', { hasText: 'Review and merge' });
    check(true, `[${label}] Back from match → intro`);

    // Forward again.
    await page.locator('button', { hasText: 'Review and merge' }).click();
    await page.waitForSelector('.mw__matches', { timeout: 5000 });
    await page.locator('button', { hasText: 'Confirm' }).click();

    // Confirm step.
    await page.waitForSelector('.mw__summary', { timeout: 5000 });
    const confirmTitle = await page.textContent('.mw__title');
    check(confirmTitle?.includes('Ready to merge'), `[${label}] confirm step (got "${confirmTitle?.trim()}")`);
    await page.screenshot({ path: shot('03-confirm.png') });

    // Summary rows should mention "1 person matched" and "1 person added".
    const summaryText = await page.textContent('.mw__summary');
    check(summaryText?.includes('matched'), `[${label}] summary shows matched count`);
    check(summaryText?.includes('added'), `[${label}] summary shows added count`);
    check(summaryText?.includes('memory'), `[${label}] summary shows memory carry-over`);
    check(summaryText?.includes('photo'), `[${label}] summary shows photo carry-over`);

    // Back → match step → confirm again.
    await page.locator('button', { hasText: 'Back' }).click();
    await page.waitForSelector('.mw__matches', { timeout: 5000 });
    check(true, `[${label}] Back from confirm → match (error cleared)`);
    await page.locator('button', { hasText: 'Confirm' }).click();
    await page.waitForSelector('.mw__summary', { timeout: 5000 });

    // Complete merge.
    await page.locator('button', { hasText: 'Complete merge' }).click();

    // Merging spinner.
    await page.waitForSelector('.mw__spinner', { timeout: 5000 });
    check(true, `[${label}] merging spinner shown`);

    // Done step.
    await page.waitForSelector('.mw__hero-icon--done', { timeout: 8000 });
    const doneTitle = await page.textContent('.mw__title');
    check(doneTitle?.includes("You're in"), `[${label}] done step (got "${doneTitle?.trim()}")`);
    await page.screenshot({ path: shot('04-done.png') });
  },
});

// ── Scenario 2: Join-only path ────────────────────────────────────────────────

console.log('\n── Scenario 2: skip – just join their tree ──────────────────────────────');

await runScenario('join-only', {
  scenario: async (page, label) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/?pending_invite=tok_join`, { waitUntil: 'load', timeout: 20000 });

    await page.waitForSelector('button', { hasText: 'Skip — just join their tree' }, { timeout: 10000 });
    await page.locator('button', { hasText: 'Skip — just join their tree' }).click();

    // Should go straight to merging (no match step).
    await page.waitForSelector('.mw__spinner', { timeout: 5000 });
    check(true, `[${label}] join-only skips to merging`);

    await page.waitForSelector('.mw__hero-icon--done', { timeout: 8000 });
    check(true, `[${label}] join-only done step shown`);
    await page.screenshot({ path: shot('05-join-done.png') });
  },
});

// ── Scenario 3: Expired invite (410) ─────────────────────────────────────────

console.log('\n── Scenario 3: expired invite error (410) ───────────────────────────────');

await runScenario('expired-invite', {
  mergeGetResponse: { status: 410, body: { error: 'Invite expired' } },
  scenario: async (page, label) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/?pending_invite=tok_expired`, { waitUntil: 'load', timeout: 20000 });

    await page.waitForSelector('.mw__title', { timeout: 10000 });
    const errTitle = await page.textContent('.mw__title');
    check(errTitle?.includes('Something went wrong'), `[${label}] error title shown (got "${errTitle?.trim()}")`);

    const errMsg = await page.textContent('.mw__sub');
    check(errMsg?.includes('expired'), `[${label}] expired message shown (got "${errMsg?.trim()}")`);
    await page.screenshot({ path: shot('06-expired.png') });
  },
});

// ── Scenario 4: POST failure → error on confirm step ─────────────────────────

console.log('\n── Scenario 4: POST failure → error recovery ────────────────────────────');

await runScenario('post-failure', {
  mergePostResponse: { status: 500, body: { error: 'Server error' } },
  scenario: async (page, label) => {
    await page.goto(`${BASE}/`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/?pending_invite=tok_fail`, { waitUntil: 'load', timeout: 20000 });

    await page.waitForSelector('button', { hasText: 'Review and merge' }, { timeout: 10000 });
    await page.locator('button', { hasText: 'Review and merge' }).click();
    await page.waitForSelector('.mw__matches', { timeout: 5000 });
    await page.locator('button', { hasText: 'Confirm' }).click();
    await page.waitForSelector('.mw__summary', { timeout: 5000 });
    await page.locator('button', { hasText: 'Complete merge' }).click();

    // After failure, should return to confirm step with inline error — NOT the full-screen error.
    await page.waitForSelector('.mw__error', { timeout: 8000 });
    const errText = await page.textContent('.mw__error');
    check(errText?.includes('went wrong'), `[${label}] inline error on confirm step (got "${errText?.trim()}")`);

    // Confirm step title must still be visible (not the generic error screen).
    const confirmTitle = await page.textContent('.mw__title');
    check(confirmTitle?.includes('Ready to merge'), `[${label}] still on confirm step after POST failure`);
    await page.screenshot({ path: shot('07-post-fail.png') });

    // Back clears the error and goes to match step.
    await page.locator('button', { hasText: 'Back' }).click();
    await page.waitForSelector('.mw__matches', { timeout: 5000 });
    const errorVisible = (await page.$$('.mw__error')).length;
    check(errorVisible === 0, `[${label}] error cleared after Back`);
    check(true, `[${label}] back from failed confirm → match step`);
    await page.screenshot({ path: shot('08-back-after-fail.png') });
  },
});

// ── Summary ───────────────────────────────────────────────────────────────────

const jsErrors = errors.filter((e) => !e.includes('api/merge') && !e.includes('api/auth'));
check(jsErrors.length === 0, `no unexpected JS errors${jsErrors.length ? ': ' + jsErrors.slice(0, 3).join(' | ') : ''}`);

console.log(failed ? '\nMERGE WIZARD TEST FAILED' : '\nMERGE WIZARD TEST PASSED');
process.exit(failed ? 1 : 0);
