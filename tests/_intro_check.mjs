import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await page.route('**/api/auth/me', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bypass: true }) })
);
await page.goto('http://localhost:5173/');
await page.waitForSelector('.intro__skip', { timeout: 8000 });
await page.waitForTimeout(600);

// Force phase 3 (memory) via React state injection
await page.evaluate(() => {
  // Find the React fiber and set phase state — not reliable
  // Instead, wait for the natural PHASE_MS timers:
  // Phase 0 = 2800ms, Phase 1 = 5200ms, Phase 2 = 3800ms, Phase 3 (memory) starts here
  // We need to wait 2800+5200+3800 = 11800ms naturally, which is too slow.
  // So intercept: click skip to jump to phase 4 (LAST), then screenshot separately.
});

// Use Skip button → goes to phase 4, but we need phase 3.
// Use the real timers but speed them up: override setTimeout
await page.addInitScript(() => {
  // This runs before page scripts — won't work for speeding up existing timers.
});

// Simplest: screenshot at specific PHASE_MS timestamps manually
// Phase 0 starts at 0, ends at 2800. Phase 1 ends at 8000. Phase 2 ends at 11800.
// Phase 3 (memory) runs from 11800 to 15400.

// Fast forward: use page.clock if available, else just wait shorter since
// Playwright's clock control can fake timers.
// Phase timings in the app: [2800, 5200, 3800, 3600, null]
// We need to be at t > 11800 (after phases 0+1+2) but before t = 15400.

// Use fake timers via CDP
const cdp = await ctx.newCDPSession(page);
// Reload using fake time
await page.reload();
await page.waitForSelector('.intro__skip', { timeout: 8000 });

// Tick clock forward past phases 0+1+2 (2800+5200+3800 = 11800ms)
// to land in phase 3 (memory)
await cdp.send('Emulation.setVirtualTimePolicy', {
  policy: 'pauseIfNetworkFetchesPending',
  budget: 12000,
});

await page.waitForTimeout(1200); // let the phase settle after virtual time

await page.screenshot({ path: 'tests/screenshots/fix-memory.png' });
console.log('memory slide screenshot done');

// CTA slide — screenshot what was captured earlier (already confirmed good)
// Take fresh CTA screenshot by clicking Skip now
await page.click('.intro__skip');
await page.waitForTimeout(700);
await page.screenshot({ path: 'tests/screenshots/fix-cta.png' });
console.log('cta slide screenshot done');

await browser.close();
