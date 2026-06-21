/**
 * Screenshots the install banner by forcing it to appear (bypassing the
 * beforeinstallprompt gate that only fires in real Chrome).
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

await page.route('**/api/auth/me', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bypass: true }) })
);

await page.goto('http://localhost:5173/?demo');
await page.waitForSelector('canvas', { timeout: 8000 });
await page.waitForTimeout(2000);

// Force-inject the install banner into the DOM for screenshot purposes
await page.evaluate(() => {
  // Clear any dismissed flag so the banner can appear
  localStorage.removeItem('bloodline:install-dismissed');
});

// Inject a fake beforeinstallprompt event via React — easier to just
// render the component directly with a test hook. Instead, inject via
// a style override to force-show a mock banner div:
await page.evaluate(() => {
  const el = document.createElement('div');
  el.className = 'install-banner';
  el.style.position = 'fixed';
  el.style.bottom = '96px';
  el.style.left = '50%';
  el.style.transform = 'translateX(-50%)';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.gap = '10px';
  el.style.background = '#fff';
  el.style.border = '1px solid #e8e2da';
  el.style.borderRadius = '20px';
  el.style.padding = '10px 12px 10px 10px';
  el.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)';
  el.style.zIndex = '9999';
  el.innerHTML = `
    <img src="/apple-touch-icon.png" alt="" width="44" height="44" style="border-radius:12px;flex-shrink:0">
    <div style="display:flex;flex-direction:column;min-width:0;flex:1">
      <span style="font-family:var(--display,serif);font-size:15px;font-weight:600;color:#2b2016;white-space:nowrap">Bloodline</span>
      <span style="font-size:12px;color:#8c7d72;white-space:nowrap">Save to your Home Screen</span>
    </div>
    <button style="background:#c2603a;color:#fff;border:none;border-radius:999px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer">Add</button>
    <button style="background:none;border:none;color:#c5b8ae;padding:4px;cursor:pointer;line-height:0">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  `;
  document.getElementById('root').appendChild(el);
});

await page.waitForTimeout(300);
await page.screenshot({ path: 'tests/screenshots/install-banner.png' });

// Now show the iOS sheet mock too
await page.evaluate(() => {
  const scrim = document.createElement('div');
  scrim.className = 'install-ios-scrim';
  scrim.innerHTML = `
    <div class="install-ios-sheet" style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 28px 40px;background:#f7f3ec;border-radius:24px 24px 0 0;width:100%">
      <div class="install-ios__handle" style="width:40px;height:4px;border-radius:2px;background:#e8e2da;margin-bottom:8px"></div>
      <img src="/apple-touch-icon.png" alt="Bloodline" width="64" height="64" style="border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,.12)">
      <h2 style="font-family:var(--display,serif);font-size:22px;font-weight:600;color:#2b2016;margin-top:4px">Add to Home Screen</h2>
      <p style="font-size:15px;color:#8c7d72;text-align:center;line-height:1.5;margin-bottom:8px">Get the full app experience — works offline and opens instantly.</p>
      <ol style="list-style:none;padding:0;margin:0;width:100%;display:flex;flex-direction:column;gap:14px">
        <li style="display:flex;align-items:center;gap:14px">
          <span style="width:28px;height:28px;border-radius:50%;background:#c2603a;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">1</span>
          <span style="font-size:15px;color:#2b2016;line-height:1.4">Tap the <svg width="18" height="20" viewBox="0 0 18 20" fill="none" style="display:inline-block;vertical-align:middle;margin:0 2px"><path d="M9 1v12M5 5l4-4 4 4" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 9v9a1 1 0 001 1h14a1 1 0 001-1V9" stroke="#007AFF" stroke-width="2" stroke-linecap="round"/></svg> Share button in Safari's toolbar</span>
        </li>
        <li style="display:flex;align-items:center;gap:14px">
          <span style="width:28px;height:28px;border-radius:50%;background:#c2603a;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">2</span>
          <span style="font-size:15px;color:#2b2016;line-height:1.4">Scroll down and tap <strong>Add to Home Screen</strong></span>
        </li>
        <li style="display:flex;align-items:center;gap:14px">
          <span style="width:28px;height:28px;border-radius:50%;background:#c2603a;color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0">3</span>
          <span style="font-size:15px;color:#2b2016;line-height:1.4">Tap <strong>Add</strong> in the top-right corner</span>
        </li>
      </ol>
      <button style="margin-top:20px;width:100%;padding:16px;font-size:16px;background:#c2603a;color:#fff;border:none;border-radius:999px;font-weight:600;cursor:pointer">Done</button>
    </div>
  `;
  document.getElementById('root').appendChild(scrim);
});

await page.waitForTimeout(300);
await page.screenshot({ path: 'tests/screenshots/install-ios-sheet.png' });

await browser.close();
console.log('done');
