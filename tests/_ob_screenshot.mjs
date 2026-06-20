import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.route('**/api/auth/me', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bypass: true }) })
);
await page.goto('http://localhost:5173/');

// Wait for intro to be visible
await page.waitForSelector('.intro__skip', { timeout: 8000 });
await page.waitForTimeout(900); // let logo animate in
await page.screenshot({ path: 'tests/screenshots/intro-p0-new.png' });

// Skip to CTA (jump to last phase)
await page.click('.intro__skip');
await page.waitForTimeout(600);
await page.screenshot({ path: 'tests/screenshots/intro-p4-new.png' });

// Click Begin
await page.click('.intro__cta');
await page.waitForTimeout(800);

// Now on onboarding step 0 (You)
await page.waitForSelector('.ob__step', { timeout: 5000 });
await page.screenshot({ path: 'tests/screenshots/ob-s0.png' });
await page.waitForTimeout(800); // let icon animate

// Fill name and advance
await page.click('.ob__input');
await page.fill('.ob__input', 'Matthew Davies');
await page.waitForTimeout(200);
await page.click('.ob__continue');
await page.waitForTimeout(700);

// Step 1 (Partner)
await page.screenshot({ path: 'tests/screenshots/ob-s1.png' });
await page.click('.ob__skip');
await page.waitForTimeout(700);

// Step 2 (Parents)
await page.screenshot({ path: 'tests/screenshots/ob-s2.png' });
await page.click('.ob__continue');
await page.waitForTimeout(700);

// Step 3 (Children)
await page.screenshot({ path: 'tests/screenshots/ob-s3.png' });
await page.click('.ob__skip');
await page.waitForTimeout(700);

// Step 4 (Memory)
await page.screenshot({ path: 'tests/screenshots/ob-s4.png' });
await page.click('.ob__skip');
await page.waitForTimeout(700);

// Step 5 (Family Name)
await page.screenshot({ path: 'tests/screenshots/ob-s5.png' });

await browser.close();
console.log('done');
