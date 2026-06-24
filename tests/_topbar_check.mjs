import { chromium } from 'playwright-core';

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });

page.on('console', m => console.log('[browser]', m.text()));

await page.goto('http://localhost:5173/?demo', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

// Screenshot at mobile size
await page.screenshot({ path: 'tests/screenshots/topbar_mobile.png', fullPage: false });

// Desktop
await page.setViewportSize({ width: 1200, height: 800 });
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/screenshots/topbar_desktop.png', fullPage: false });

// Check the topbar elements
const topbar = await page.locator('.topbar').boundingBox();
const brand = await page.locator('.topbar__brand').boundingBox();
const actions = await page.locator('.topbar__actions').boundingBox();
const familyName = await page.locator('.topbar__familyname').boundingBox();

console.log('topbar:', topbar);
console.log('brand:', brand);
console.log('actions:', actions);
console.log('familyName:', familyName);

// Check computed styles
const barStyles = await page.locator('.topbar__bar').evaluate(el => {
  const s = getComputedStyle(el);
  return { display: s.display, flexDir: s.flexDirection, align: s.alignItems, justify: s.justifyContent };
});
console.log('topbar__bar styles:', barStyles);

const familyNameStyles = await page.locator('.topbar__familyname').evaluate(el => {
  const s = getComputedStyle(el);
  return { fontSize: s.fontSize, textTransform: s.textTransform, letterSpacing: s.letterSpacing };
});
console.log('familyName styles:', familyNameStyles);

await browser.close();
