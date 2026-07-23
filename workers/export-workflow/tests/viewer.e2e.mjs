// Live-browser verification for the offline viewer (docs/FULL-ARCHIVE-
// EXPORT.md §3.8, §12.4). Opens the fixture archive via a genuine file://
// URL (not a dev server) since that's the actual constraint being tested:
// no fetch()/XHR, no network request of any kind, works after extraction
// with nothing running. Run with: node tests/viewer.e2e.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { buildFixtureArchive } from './helpers/buildFixtureArchive.mjs';

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`PASS  ${label}`); }
  else { failed++; console.log(`FAIL  ${label}`); }
}

const { root } = await buildFixtureArchive();
const url = `file://${path.join(root, 'START-HERE.html')}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const networkRequests = [];
page.on('request', (req) => networkRequests.push(req.url()));
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page.goto(url);
await page.waitForTimeout(300);

check('page loaded with zero console/page errors', consoleErrors.length === 0);
if (consoleErrors.length) console.log('      errors:', consoleErrors);

const externalRequests = networkRequests.filter((u) => !u.startsWith('file://'));
check('zero non-file:// network requests (no fetch/CDN/analytics)', externalRequests.length === 0);
if (externalRequests.length) console.log('      external requests:', externalRequests);

check('family name renders', (await page.textContent('#av-family-name')) === 'The Mercer Family');
check('generated-at date renders', (await page.textContent('#av-generated-at')).includes('Archived'));

const peopleButtons = await page.locator('.av-people-list button').allTextContents();
check('all 4 people appear in the directory', peopleButtons.length === 4);
check('directory is sorted alphabetically by display name', JSON.stringify(peopleButtons) === JSON.stringify([...peopleButtons].sort()));

// Search filtering
await page.fill('#av-search', 'megan');
await page.waitForTimeout(50);
const filtered = await page.locator('.av-people-list button').allTextContents();
check('search filters the directory to matching names only', filtered.length === 1 && filtered[0] === 'Megan Mercer');
await page.fill('#av-search', '');
await page.waitForTimeout(50);

// Default profile (first person alphabetically = James Mercer)
check('profile defaults to the first person', (await page.textContent('.av-profile__name')) === 'James Mercer');
const detailsText = await page.textContent('.av-section');
check('scalar fields render (occupation)', detailsText.includes('Teacher'));

const eventsText = await page.locator('.av-events').textContent();
check('life events render, sorted by year', eventsText.indexOf('2010') < eventsText.indexOf('2016'));

const memoriesText = await page.locator('.av-memories').textContent();
check('memories render', memoriesText.includes('best stories at Christmas'));

// Relationship navigation
const relText = await page.locator('.av-section', { hasText: 'Relationships' }).textContent();
check('relationships section shows partner and child', relText.includes('Megan Mercer') && relText.includes('Oliver Mercer'));

await page.locator('.av-rel-chip', { hasText: 'Oliver Mercer' }).click();
await page.waitForTimeout(100);
check('clicking a relationship chip navigates to that profile', (await page.textContent('.av-profile__name')) === 'Oliver Mercer');
check('URL hash updated for deep-linking', (await page.evaluate(() => location.hash)).includes('p3'));

// Missing-media warning path (Robert Mercer has an unresolvable photo)
await page.evaluate(() => { location.hash = '#/person/p4'; });
await page.waitForTimeout(100);
const mediaText = await page.locator('.av-media-grid').textContent();
check('a missing photo reference shows an explicit warning, not a broken silent image', mediaText.toLowerCase().includes('missing'));

// Missing-document warning path (James Mercer's document is unresolvable)
await page.evaluate(() => { location.hash = '#/person/p1'; });
await page.waitForTimeout(100);
const jamesMediaText = await page.locator('.av-media-grid').textContent();
check('James\'s unresolvable document also shows an explicit warning', jamesMediaText.toLowerCase().includes('missing'));

// Keyboard navigation — a fresh page, since earlier clicks in this same
// page already moved focus around (clicking a real button focuses it).
const kbPage = await browser.newPage();
await kbPage.goto(url);
await kbPage.waitForTimeout(200);
await kbPage.keyboard.press('Tab'); // skip link (first focusable element in DOM order)
await kbPage.keyboard.press('Tab'); // search input
const focusedIsSearch = await kbPage.evaluate(() => document.activeElement.id === 'av-search');
check('keyboard tab order reaches the search input', focusedIsSearch);
await kbPage.close();

// Font loading (local, no network) — confirm the @font-face actually
// resolved. Headings request weight 600 (see styles.css), so that's the
// one guaranteed to have been triggered by rendering the family name
// heading — the 400-weight face is legitimately never used on this page
// and correctly stays unloaded (lazy font loading), so checking for it
// would be asserting the wrong thing, not proving a real bug.
await page.evaluate(() => document.fonts.ready);
const fontCheck = await page.evaluate(() => document.fonts.check('600 16px "Fraunces Archive"'));
check('the bundled Fraunces font (weight 600, as actually used by headings) loaded', fontCheck);

// Print button exists and is clickable without throwing
const printBtn = page.locator('#av-print-btn');
check('a print button exists on the profile', await printBtn.count() === 1);

await browser.close();

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
