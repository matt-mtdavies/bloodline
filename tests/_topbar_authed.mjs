import { chromium } from 'playwright';
const br = await chromium.launch({ headless: true });
const pg = await br.newPage();
await pg.setViewportSize({ width: 390, height: 844 });
// Inject a fake user into App to simulate the authenticated + user state
await pg.goto('http://localhost:5174/?demo');
await pg.waitForTimeout(2000);

// Inject a fake "user" prop via React DevTools approach — simpler: patch the store
// and navigate to simulate an authed user showing in TopBar.
// Easier: evaluate JS to manually set a cookie and reload, or just inspect the demo topbar.
await pg.screenshot({ path: 'tests/screenshots/topbar-demo.png', clip: { x: 0, y: 0, width: 390, height: 200 } });

// Now simulate a user being present by injecting via window
await pg.evaluate(() => {
  // Force the TopBar to show in "user" mode by patching the React fiber
  // Find the TopBar root and inject a user prop — not easy without DevTools.
  // Instead let's check the DOM structure of the topbar actions.
  const bar = document.querySelector('.topbar__bar');
  const actions = document.querySelector('.topbar__actions');
  window.__topbar_info = {
    barDisplay: bar ? getComputedStyle(bar).display : 'NOT FOUND',
    actionsDisplay: actions ? getComputedStyle(actions).display : 'NOT FOUND',
    actionsWidth: actions ? actions.getBoundingClientRect().width : 'NOT FOUND',
    barWidth: bar ? bar.getBoundingClientRect().width : 'NOT FOUND',
    barJustify: bar ? getComputedStyle(bar).justifyContent : 'NOT FOUND',
  };
});
const info = await pg.evaluate(() => window.__topbar_info);
console.log('Topbar debug:', JSON.stringify(info, null, 2));

await br.close();
console.log('done');
